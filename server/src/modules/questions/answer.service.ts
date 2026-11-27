import { Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { ProcessingJob, Question, UploadedDocument, taxonomyKey } from '../../models/index.js'
import { runSystemAI } from '../ai/ai.usage.js'

/*
 * Background AI answering for the shared question hub.
 *
 * Questions without an answer key are solved by the model in small batches. An answer is
 * accepted ONLY when the model says the question is answerable, its labels are real option
 * labels of that question, the count matches the question type, and its confidence is at
 * least MIN_CONFIDENCE. Everything else goes to `needs_review` and never enters a test.
 * An AI error never marks a question ready — the job retries with backoff.
 *
 * Re-check mode (a student reported a wrong answer): solved again at higher effort; the
 * question returns to `ready` only if the model independently agrees with the stored answer.
 */

export const BATCH_SIZE = 5
export const MIN_CONFIDENCE = 0.75
const SWEEP_MS = 10 * 60_000
const RETRY_AFTER_FAILURE_MS = 6 * 3600_000
const RECHECK_EFFORT = 'xhigh' as const

type Oid = Types.ObjectId

const SYSTEM = `You are a meticulous examiner for Indian competitive government exams (RRB, SSC, banking, state PSC).
For every question, solve it yourself, carefully and step by step, before answering.
Rules:
- Answer only from your own working. Do not guess. If you are not sure, set a low confidence.
- Set answerable=false when the question cannot be answered as given: it refers to a figure, diagram, table, passage or graph that is not included; options are missing, duplicated or garbled; the statement is ambiguous or self-contradictory; or the text looks corrupted.
- For option questions, "labels" must contain only labels that appear in that question's options (e.g. "B"). single_correct and true_false take exactly one label; multiple_correct takes every correct label.
- For numeric questions, put the final number (digits, optional sign and decimal point, no units) in "numericAnswer" and leave "labels" empty.
- "confidence" is your honest probability (0 to 1) that your answer is correct.
- "explanation": 1-3 short sentences with the key step or fact that decides the answer.
- "subjectName": when candidate subjects are listed and the question has no subject, pick the one it belongs to, else null.
Return one result per question index, in any order.`

const resultSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      answerable: z.boolean(),
      labels: z.array(z.string()),
      numericAnswer: z.string().nullish(),
      confidence: z.number().min(0).max(1),
      explanation: z.string(),
      subjectName: z.string().nullish()
    })
  )
})
type AiResult = z.infer<typeof resultSchema>['results'][number]

const resultJsonSchema = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'answerable', 'labels', 'numericAnswer', 'confidence', 'explanation', 'subjectName'],
        properties: {
          index: { type: 'integer' },
          answerable: { type: 'boolean' },
          labels: { type: 'array', items: { type: 'string' } },
          numericAnswer: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          explanation: { type: 'string' },
          subjectName: { type: ['string', 'null'] }
        }
      }
    }
  }
}

type HubQuestion = {
  _id: Oid
  questionText: string
  questionType: string
  options: Array<{ label: string; text: string }>
  correctAnswer?: string[] | null
  subjectName?: string | null
  subjectKey?: string | null
  flags?: string[]
  documentId?: Oid | null
  aiStructured?: { generatorAnswer?: string[] } | null
}

/** Pure validation of one AI result against the question — exported so it can be checked in isolation. */
export function judgeAnswer(q: Pick<HubQuestion, 'questionType' | 'options'>, r: AiResult): { ok: true; answer: string[]; questionType: string } | { ok: false; reason: string } {
  if (!r.answerable) return { ok: false, reason: 'ai_unanswerable' }
  if (!(r.confidence >= MIN_CONFIDENCE)) return { ok: false, reason: 'ai_low_confidence' }
  if (q.questionType === 'numeric') {
    const raw = (r.numericAnswer ?? '').trim()
    if (!/^[-+]?\d+(\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) return { ok: false, reason: 'ai_answer_invalid' }
    return { ok: true, answer: [String(Number(raw))], questionType: 'numeric' }
  }
  const labels = Array.from(new Set(r.labels.map((l) => l.trim().toUpperCase()).filter(Boolean))).sort()
  if (!labels.length) return { ok: false, reason: 'ai_answer_invalid' }
  if (!labels.every((l) => q.options.some((o) => o.label === l))) return { ok: false, reason: 'ai_answer_invalid' }
  let type = q.questionType
  // The parser could not tell the type, but the options exist: one confident label settles it.
  if (type === 'unknown') {
    if (q.options.length < 2) return { ok: false, reason: 'ai_answer_invalid' }
    type = labels.length === 1 ? 'single_correct' : 'multiple_correct'
  }
  if ((type === 'single_correct' || type === 'true_false') && labels.length !== 1) return { ok: false, reason: 'ai_answer_invalid' }
  return { ok: true, answer: labels, questionType: type }
}

const sameAnswer = (a: string[] | null | undefined, b: string[]) =>
  Array.isArray(a) && a.length === b.length && [...a].map((x) => x.toUpperCase()).sort().every((x, i) => x === [...b].sort()[i])

function promptFor(questions: HubQuestion[], candidates: Map<string, string[]>) {
  return questions
    .map((q, index) => {
      const cand = !q.subjectKey ? candidates.get(String(q.documentId ?? '')) ?? [] : []
      return [
        `### index ${index}`,
        `type: ${q.questionType}`,
        q.subjectName ? `subject: ${q.subjectName}` : cand.length ? `candidate subjects: ${cand.join(', ')}` : 'subject: unknown',
        q.flags?.includes('page_has_images') ? 'note: the source page contained images; if the question depends on one, it is not answerable' : '',
        `question: ${q.questionText}`,
        q.options.length ? `options:\n${q.options.map((o) => `${o.label}. ${o.text}`).join('\n')}` : 'options: (none)'
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

/**
 * Solves one batch. Returns 'ai_unavailable' when AI is not configured (the questions stay
 * pending and are picked up by the sweeper once a key is added). Throws on AI errors.
 */
export async function answerBatch(ids: Oid[], recheck: boolean): Promise<'done' | 'ai_unavailable' | 'nothing'> {
  const questions = (await Question.find(
    recheck ? { _id: { $in: ids }, status: 'needs_review', 'aiCheck.recheck': true } : { _id: { $in: ids }, status: 'pending_answer' }
  ).lean()) as unknown as HubQuestion[]
  if (!questions.length) return 'nothing'

  const docIds = Array.from(new Set(questions.filter((q) => !q.subjectKey && q.documentId).map((q) => String(q.documentId))))
  const docs = docIds.length ? await UploadedDocument.find({ _id: { $in: docIds } }).select('intent.subjectNames').lean() : []
  const candidates = new Map(docs.map((d) => [String(d._id), (d.intent?.subjectNames ?? []) as string[]]))

  const reply = await runSystemAI(recheck ? 'question_recheck' : 'question_answer', (p) =>
    p.generateJson({
      system: SYSTEM,
      prompt: `${recheck ? 'Solve these questions independently and carefully; a student believes the stored answer may be wrong.\n\n' : ''}${promptFor(questions, candidates)}`,
      jsonSchema: resultJsonSchema,
      schemaName: 'question_answers',
      validate: resultSchema,
      model: env.aiAnswerModel,
      effort: recheck ? RECHECK_EFFORT : env.AI_ANSWER_EFFORT,
      maxTokens: 6000
    })
  )
  if (!reply) return 'ai_unavailable'

  const now = new Date()
  const byIndex = new Map(reply.data.results.map((r) => [r.index, r]))
  for (const [index, q] of questions.entries()) {
    const r = byIndex.get(index)
    if (!r) {
      // The model skipped it: try again later rather than guessing.
      await Question.updateOne({ _id: q._id }, { $set: { 'aiCheck.state': 'failed', 'aiCheck.nextTryAt': new Date(Date.now() + RETRY_AFTER_FAILURE_MS), 'aiCheck.note': 'No result returned', 'aiCheck.lastRunAt': now } })
      continue
    }
    const verdict = judgeAnswer(q, r)
    let subjectName = q.subjectName ?? null
    if (!q.subjectKey && r.subjectName) {
      const cand = candidates.get(String(q.documentId ?? '')) ?? []
      const match = cand.find((c) => taxonomyKey(c) === taxonomyKey(r.subjectName))
      if (match) subjectName = match
    }
    const subjectKey = taxonomyKey(subjectName)
    const base = { 'aiCheck.state': 'done', 'aiCheck.recheck': false, 'aiCheck.lastRunAt': now, 'aiCheck.note': r.explanation.slice(0, 1000), subjectName, subjectKey }

    if (recheck) {
      const agrees = verdict.ok && sameAnswer(q.correctAnswer, verdict.answer)
      await Question.updateOne(
        { _id: q._id, status: 'needs_review', 'aiCheck.recheck': true },
        agrees
          ? // One $set of the whole flag list: $addToSet + $pull on the same path in one update is a MongoDB conflict.
            { $set: { ...base, status: subjectKey ? 'ready' : 'needs_review', flags: [...(q.flags ?? []).filter((f) => !['reported', 'recheck_disagrees'].includes(f)), 'recheck_confirmed'] } }
          : {
              $set: {
                ...base,
                'aiCheck.note': `Re-check did not confirm the stored answer${verdict.ok ? ` (AI: ${verdict.answer.join(', ')})` : ''}. ${r.explanation}`.slice(0, 1000),
                flags: [...(q.flags ?? []).filter((f) => !['recheck_confirmed', 'recheck_disagrees'].includes(f)), 'recheck_disagrees']
              }
            }
      )
      continue
    }
    if (!verdict.ok) {
      await Question.updateOne({ _id: q._id, status: 'pending_answer' }, { $set: { ...base, status: 'needs_review' }, $addToSet: { flags: verdict.reason } })
      continue
    }
    // AI-generated practice question: the independent solve must agree with the generator.
    const generator = q.aiStructured?.generatorAnswer
    if (generator?.length && !sameAnswer(generator, verdict.answer)) {
      await Question.updateOne({ _id: q._id, status: 'pending_answer' }, { $set: { ...base, status: 'needs_review' }, $addToSet: { flags: 'generator_disagrees' } })
      continue
    }
    await Question.updateOne(
      { _id: q._id, status: 'pending_answer' },
      {
        $set: {
          ...base,
          status: subjectKey ? 'ready' : 'needs_review',
          questionType: verdict.questionType,
          correctAnswer: verdict.answer,
          answerSource: 'ai',
          answerConfidence: r.confidence,
          answerExplanation: r.explanation.slice(0, 4000),
          answerModel: env.aiAnswerModel,
          answeredAt: now
        },
        ...(subjectKey ? { $pull: { flags: 'needs_subject' } } : { $addToSet: { flags: 'needs_subject' } })
      }
    )
  }
  return 'done'
}

/* ------------------------------------------------------------------ */
/* Queueing                                                            */
/* ------------------------------------------------------------------ */

/** Queues questions for answering (or re-checking) in batches. Idempotent per question. */
export async function enqueueAnswering(ids: Oid[], recheck = false) {
  if (!ids.length || !env.aiEnabled) return 0
  // Claim only questions that are not already queued.
  const claimable = await Question.find({ _id: { $in: ids }, 'aiCheck.state': { $ne: 'queued' } }).select('_id').lean()
  const claimed = claimable.map((q) => q._id)
  if (!claimed.length) return 0
  await Question.updateMany({ _id: { $in: claimed } }, { $set: { 'aiCheck.state': 'queued', 'aiCheck.recheck': recheck } })
  for (let i = 0; i < claimed.length; i += BATCH_SIZE) {
    await ProcessingJob.create({ type: 'answer_questions', questionIds: claimed.slice(i, i + BATCH_SIZE), recheck, status: 'queued', maxAttempts: 4 })
  }
  return claimed.length
}

/** Job body used by the queue worker. */
export async function runAnswerJob(job: { questionIds: Oid[]; recheck?: boolean | null }) {
  const outcome = await answerBatch(job.questionIds, Boolean(job.recheck))
  if (outcome === 'ai_unavailable') {
    // Not an error: release the questions so the sweeper requeues them when AI is configured.
    await Question.updateMany({ _id: { $in: job.questionIds }, 'aiCheck.state': 'queued' }, { $set: { 'aiCheck.state': null } })
  }
  return outcome
}

/** After the last retry of a failed job, park its questions for a later sweep (never mark them ready). */
export async function parkFailedQuestions(ids: Oid[], message: string) {
  await Question.updateMany(
    { _id: { $in: ids }, 'aiCheck.state': 'queued' },
    { $set: { 'aiCheck.state': 'failed', 'aiCheck.nextTryAt': new Date(Date.now() + RETRY_AFTER_FAILURE_MS), 'aiCheck.note': message.slice(0, 1000) }, $inc: { 'aiCheck.attempts': 1 } }
  )
}

/**
 * Periodically queues every question still waiting for an answer (or a re-check). This is
 * what makes the hub answer itself once OPENAI_API_KEY is added, without any manual step.
 */
export async function sweepPendingAnswers(limit = 200) {
  if (!env.aiEnabled) return 0
  const now = new Date()
  const due = { $or: [{ 'aiCheck.state': null }, { 'aiCheck.state': { $exists: false } }, { 'aiCheck.state': 'failed', 'aiCheck.nextTryAt': { $lte: now } }] }
  const fresh = await Question.find({ status: 'pending_answer', ...due }).select('_id').limit(limit).lean()
  const rechecks = await Question.find({ status: 'needs_review', 'aiCheck.recheck': true, ...due }).select('_id').limit(limit).lean()
  const a = await enqueueAnswering(fresh.map((q) => q._id), false)
  const b = await enqueueAnswering(rechecks.map((q) => q._id), true)
  if (a + b) logger.info({ answering: a, rechecking: b }, 'Queued hub questions for AI')
  return a + b
}

let sweeper: NodeJS.Timeout | null = null
export function startAnswerSweeper() {
  if (!env.aiEnabled || sweeper) return
  const tick = () => void sweepPendingAnswers().catch((err) => logger.warn({ err: err instanceof AppError ? err.code : err }, 'Answer sweep failed'))
  setTimeout(tick, 5_000)
  sweeper = setInterval(tick, SWEEP_MS)
}
export function stopAnswerSweeper() {
  if (sweeper) clearInterval(sweeper)
  sweeper = null
}
