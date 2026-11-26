import type { Types } from 'mongoose'
import { logger } from '../../lib/logger.js'
import { AppError } from '../../lib/errors.js'
import { storage } from '../../integrations/storage.js'
import { getAIProvider } from '../../integrations/ai.js'
import { Question, UploadedDocument } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { getSettings } from '../settings/settings.service.js'
import { notify } from '../notifications/notification.routes.js'
import { extractPdfText } from './extraction/pdfText.js'
import { getOcrProvider } from './extraction/ocr.js'
import { normalizeForHash, parseQuestions } from './extraction/questionParser.js'
import { refineWithAI, type AiRefinement } from './extraction/aiStructurer.js'

const MIN_TEXT_CHARS = 25

async function setProgress(id: Types.ObjectId, stage: string, progress: number) {
  await UploadedDocument.updateOne({ _id: id }, { $set: { stage, progress } })
}

/**
 * Full server-side processing of one uploaded PDF:
 * text extraction → OCR fallback for scanned pages → deterministic parsing →
 * optional AI structuring → deduplicated insert into the owner's question bank.
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

  // 5. Save (deduplicated per owner by normalized content hash)
  await setProgress(doc._id, 'saving questions', 90)
  const singleSubject = intentSubjects.length === 1 ? intentSubjects[0] : null
  let inserted = 0
  let duplicates = 0
  let needsReview = 0
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
    if (!subject) flags.push('needs_subject')
    const answer = q.answer && q.answer.every((a) => options.some((o) => o.label === a)) ? q.answer : null
    const confident = q.confidence >= 0.8 && !imagePages.has(q.pageNumber)
    const status = confident ? 'extracted' : 'needs_review'
    if (status === 'needs_review') needsReview += 1
    try {
      await Question.create({
        userId,
        origin: 'pdf',
        documentId: doc._id,
        source: { documentId: doc._id, pageNumber: q.pageNumber, questionNumber: q.number },
        rawText: q.rawText,
        questionText,
        questionType,
        options,
        correctAnswer: answer,
        answerSource: answer ? 'document_key' : null,
        explanation: q.explanation,
        subjectId: subject?.id ?? null,
        subjectName: subject?.name ?? null,
        difficulty: 'unknown',
        status,
        extractionConfidence: q.confidence,
        flags,
        aiStructured: ai ? ai.raw : null,
        contentHash: normalizeForHash(questionText, options)
      })
      inserted += 1
    } catch (err) {
      if ((err as { code?: number }).code === 11000) duplicates += 1
      else throw err
    }
  }

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
    message: failedForOcr ? 'OCR is required for this scanned PDF.' : `${inserted} new question(s), ${duplicates} duplicate(s), ${needsReview} need review.`,
    link: `/tests/documents/${doc._id}`
  })
}
