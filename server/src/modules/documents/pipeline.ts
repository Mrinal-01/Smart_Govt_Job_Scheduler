import type { Types } from 'mongoose'
import { logger } from '../../lib/logger.js'
import { AppError } from '../../lib/errors.js'
import { storage } from '../../integrations/storage.js'
import { getAIProvider } from '../../integrations/ai.js'
import { Question, UploadedDocument, taxonomyKey } from '../../models/index.js'
import { enqueueAnswering } from '../questions/answer.service.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { getSettings } from '../settings/settings.service.js'
import { notify } from '../notifications/notification.routes.js'
import { extractPdfText } from './extraction/pdfText.js'
import { getOcrProvider } from './extraction/ocr.js'
import { normalizeForHash, parseQuestions } from './extraction/questionParser.js'
import { refineWithAI, type AiRefinement } from './extraction/aiStructurer.js'

const MIN_TEXT_CHARS = 25
/** Flags that keep a question out of tests until a person or an AI re-check clears them. */
const BLOCKING_FLAGS = ['low_confidence', 'reported', 'recheck_disagrees', 'ai_unanswerable', 'ai_low_confidence', 'ai_answer_invalid', 'incomplete', 'generator_disagrees', 'needs_subject']

async function setProgress(id: Types.ObjectId, stage: string, progress: number) {
  await UploadedDocument.updateOne({ _id: id }, { $set: { stage, progress } })
}

/**
 * Full server-side processing of one uploaded PDF:
 * text extraction → OCR fallback for scanned pages → deterministic parsing →
 * optional AI structuring → deduplicated insert into the shared question hub → background
 * AI answering of questions that came without an answer key.
 */
export async function processDocument(documentId: Types.ObjectId) {
  const doc = await UploadedDocument.findById(documentId)
  if (!doc) throw new Error('Document not found')
  const userId = doc.userId
  await UploadedDocument.updateOne({ _id: doc._id }, { $set: { status: 'processing', stage: 'reading', progress: 5, error: null } })

  const data = await storage.read(doc.storageKey)

  // 1. Text layer
  const pages = await extractPdfText(data, (n, total) => {
    void setProgress(doc._id, `extracting page ${n}/${total}`, 5 + Math.round((n / total) * 45))
  })

  // 2. OCR fallback for pages without a usable text layer
  const ocr = getOcrProvider()
  const ocrAvailable = await ocr.available()
  const pageInfo: Array<{ pageNumber: number; method: 'text' | 'ocr' | 'ocr_unavailable' | 'empty'; chars: number }> = []
  for (const page of pages) {
    const chars = page.text.replace(/\s/g, '').length
    if (chars >= MIN_TEXT_CHARS) {
      pageInfo.push({ pageNumber: page.pageNumber, method: 'text', chars })
      continue
    }
    if (!ocrAvailable) {
      pageInfo.push({ pageNumber: page.pageNumber, method: 'ocr_unavailable', chars })
      continue
    }
    await setProgress(doc._id, `OCR page ${page.pageNumber}/${pages.length}`, 50 + Math.round((page.pageNumber / pages.length) * 15))
    try {
      page.text = await ocr.recognizePage(storage.absolutePath(doc.storageKey), page.pageNumber)
      const ocrChars = page.text.replace(/\s/g, '').length
      pageInfo.push({ pageNumber: page.pageNumber, method: ocrChars ? 'ocr' : 'empty', chars: ocrChars })
    } catch (err) {
      logger.warn({ err, page: page.pageNumber }, 'OCR failed for page')
      pageInfo.push({ pageNumber: page.pageNumber, method: 'empty', chars: 0 })
    }
  }
  const textPages = pageInfo.filter((p) => p.method === 'text').length
  const ocrPages = pageInfo.filter((p) => p.method === 'ocr').length
  const ocrUnavailablePages = pageInfo.filter((p) => p.method === 'ocr_unavailable').length

  // 3. Deterministic parse
  await setProgress(doc._id, 'detecting questions', 68)
  const parsed = parseQuestions(pages.filter((p, i) => pageInfo[i].method === 'text' || pageInfo[i].method === 'ocr'))
  const imagePages = new Set(pages.filter((p) => p.hasImages).map((p) => p.pageNumber))

  // 4. Optional AI structuring of low-confidence questions
  const cur = await loadCurriculum(userId)
  const intentSubjects = (doc.intent?.subjectIds ?? []).map((id) => cur.subject(id)).filter(Boolean) as Array<{ id: string; name: string }>
  const subjectPool = intentSubjects.length ? intentSubjects : cur.subjects
  let aiUsed = false
  let aiNote: string | null = null
  let refinements = new Map<number, AiRefinement>()
  let rejected = new Set<number>()
  const settings = await getSettings(userId)
  if (getAIProvider() && settings.ai?.enabled !== false && parsed.questions.some((q) => q.confidence < 0.8)) {
    await setProgress(doc._id, 'AI structuring', 78)
    try {
      const r = await refineWithAI(userId, parsed.questions, subjectPool.map((s) => s.name))
      refinements = r.refinements
      rejected = r.rejected
      aiUsed = r.refinements.size > 0 || r.rejected.size > 0
      aiNote = r.note
    } catch (err) {
      aiNote = `AI structuring skipped: ${err instanceof AppError ? err.message : 'provider error'}`
      logger.warn({ err }, 'AI structuring failed; continuing with parser output')
    }
  } else if (!getAIProvider()) {
    aiNote = 'AI structuring is not configured; questions were extracted by the rule-based parser only.'
  }

  // 5. Save into the shared hub (deduplicated across all students by normalized content hash)
  await setProgress(doc._id, 'saving questions', 90)
  const singleSubject = intentSubjects.length === 1 ? intentSubjects[0] : null
  let inserted = 0
  let duplicates = 0
  let needsReview = 0
  let answersFilled = 0
  const toAnswer: Types.ObjectId[] = []
  for (const [index, q] of parsed.questions.entries()) {
    const ai = refinements.get(index)
    const flags = [...q.flags]
    if (imagePages.has(q.pageNumber)) flags.push('page_has_images')
    if (rejected.has(index)) flags.push('ai_output_rejected_not_grounded')
    if (ai) flags.push('ai_structured')
    const questionText = ai?.questionText || q.questionText
    const options = ai ? ai.options : q.options
    const questionType = ai?.questionType ?? q.questionType
    let subject = singleSubject
    if (!subject && ai?.subjectName) {
      const match = subjectPool.find((s) => s.name.toLowerCase() === ai.subjectName!.toLowerCase())
      if (match) {
        subject = match
        flags.push('subject_suggested_by_ai')
      }
    }
    // With several subjects chosen, the AI answering step can still assign one from the upload's list.
    if (!subject) flags.push('needs_subject')
    const answer = q.answer && q.answer.every((a) => options.some((o) => o.label === a)) ? q.answer : null
    const confident = q.confidence >= 0.8
    if (!confident) flags.push('low_confidence')
    // ready: trusted key + clean extraction + subject; pending_answer: clean but no key (AI solves it);
    // needs_review: unclear extraction, or a key without a subject.
    const status = !confident ? 'needs_review' : answer ? (subject ? 'ready' : 'needs_review') : 'pending_answer'
    if (status === 'needs_review') needsReview += 1
    const contentHash = normalizeForHash(questionText, options)
    try {
      const created = await Question.create({
        uploadedBy: userId,
        origin: 'pdf',
        documentId: doc._id,
        source: { documentId: doc._id, pageNumber: q.pageNumber, questionNumber: q.number },
        rawText: q.rawText,
        questionText,
        questionType,
        options,
        correctAnswer: answer,
        answerSource: answer ? 'document_key' : null,
        answeredAt: answer ? new Date() : null,
        explanation: q.explanation,
        subjectName: subject?.name ?? null,
        subjectKey: taxonomyKey(subject?.name),
        difficulty: 'unknown',
        status,
        extractionConfidence: q.confidence,
        flags,
        aiStructured: ai ? ai.raw : null,
        contentHash
      })
      inserted += 1
      if (status === 'pending_answer') toAnswer.push(created._id)
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err
      duplicates += 1
      // Same question already in the hub: remember this PDF had it, and let this PDF's answer key
      // fill a missing answer (an answer key beats an AI answer that is still pending).
      await Question.updateOne({ contentHash }, { $addToSet: { alsoInDocuments: doc._id } })
      if (answer && confident) {
        const filled = await Question.updateOne(
          { contentHash, status: { $in: ['pending_answer', 'needs_review'] }, correctAnswer: null },
          {
            $set: {
              correctAnswer: answer,
              answerSource: 'document_key',
              answeredAt: new Date(),
              status: 'ready',
              'aiCheck.state': 'done',
              ...(subject ? { subjectName: subject.name, subjectKey: taxonomyKey(subject.name) } : {})
            }
          }
        )
        // A question that still lacks a subject stays out of tests.
        await Question.updateOne({ contentHash, status: 'ready', subjectKey: null }, { $set: { status: 'needs_review' } })
        answersFilled += filled.modifiedCount
      }
      // A single-subject upload can supply the subject an earlier multi-subject upload lacked;
      // an answered question that was held back only for its subject then becomes ready.
      if (subject) {
        await Question.updateOne({ contentHash, subjectKey: null }, { $set: { subjectName: subject.name, subjectKey: taxonomyKey(subject.name) }, $pull: { flags: 'needs_subject' } })
        await Question.updateOne(
          { contentHash, status: 'needs_review', correctAnswer: { $ne: null }, subjectKey: { $ne: null }, flags: { $nin: BLOCKING_FLAGS } },
          { $set: { status: 'ready' } }
        )
      }
    }
  }
  const pendingAnswer = toAnswer.length
  await enqueueAnswering(toAnswer)

  const failedForOcr = parsed.questions.length === 0 && ocrUnavailablePages > 0 && textPages === 0
  await UploadedDocument.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: failedForOcr ? 'failed' : 'completed',
        stage: failedForOcr ? 'needs OCR' : 'done',
        progress: 100,
        error: failedForOcr
          ? 'This PDF looks scanned (no text layer) and OCR is not installed on this server. Install poppler-utils and tesseract-ocr, then choose “Reprocess”.'
          : null,
        pages: pageInfo,
        stats: {
          questionsFound: parsed.questions.length,
          inserted,
          duplicates,
          needsReview,
          pendingAnswer,
          answersFilled,
          textPages,
          ocrPages,
          ocrUnavailablePages,
          answerKeyFound: parsed.answerKeyFound
        },
        aiUsed,
        aiNote,
        processedAt: new Date()
      }
    }
  )
  await notify(userId, {
    type: failedForOcr ? 'document_failed' : 'document_processed',
    title: failedForOcr ? `Could not read “${doc.originalName}”` : `“${doc.originalName}” processed`,
    message: failedForOcr
      ? 'OCR is required for this scanned PDF.'
      : `${inserted} new question(s) added to the hub, ${duplicates} already there, ${pendingAnswer} waiting for an AI answer, ${needsReview} need review.`,
    link: `/tests/documents/${doc._id}`
  })
}
