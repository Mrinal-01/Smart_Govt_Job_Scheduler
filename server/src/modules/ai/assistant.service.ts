import type { Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { addDays, dateKey } from '../../lib/dates.js'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { getAIProvider } from '../../integrations/ai.js'
import { MockTestAttempt, Question, taxonomyKey } from '../../models/index.js'
import { enqueueAnswering } from '../questions/answer.service.js'
import { serializeQuestion } from '../questions/question.service.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { getSettings } from '../settings/settings.service.js'
import { normalizeForHash } from '../documents/extraction/questionParser.js'
import { aiUsageToday, runAI } from './ai.usage.js'

type Oid = Types.ObjectId


const BASE_SYSTEM = `You are StudyOS's study coach for a student preparing for Indian competitive government exams.
Ground rules:
- Use ONLY the facts in the STUDENT DATA block. Never invent study history, scores, dates or topics.
- If the data needed to answer is missing or too thin, say so plainly and suggest what the student should record.
- Recommendations are advice; never claim to have changed the student's schedule or records.
- Be concise and practical. Use short headings and bullet points (Markdown).`

interface WorkspaceTopic {
  id: string
  name: string
  subjectId: string
  chapterId: string
  initialLearningDate: string | null
  revisions?: unknown[]
  nextRevisionDue?: string | null
  questionsAttempted?: number
  questionsCorrect?: number
  confidence?: number
  mistakeCount?: number
}

export async function explainWrongAnswer(userId: Oid, attemptId: Oid, questionId: string) {
  const attempt = await MockTestAttempt.findOne({ _id: attemptId, userId }).lean()
  if (!attempt) throw notFound('Attempt')
  if (attempt.status === 'in_progress') throw conflict('Finish the test before asking for explanations.', 'ATTEMPT_RUNNING')
  const q = attempt.questions.find((x) => String(x.questionId) === questionId)
  if (!q) throw notFound('Question in attempt')
  const r = (attempt.result as { questionResults?: Array<{ questionId: string; selected: string[] }> } | null)?.questionResults?.find(
    (x) => x.questionId === questionId
  )
  const known = q.answerVerified && q.correctAnswer?.length
  const how = q.answerSource === 'ai' ? ' (worked out by AI from the question; treat as very likely, not official)' : q.answerSource === 'document_key' ? ' (from the paper\'s answer key)' : ''
  const prompt = `Question (${q.subjectName ?? 'unknown subject'} / ${q.chapterName ?? 'unknown chapter'}):
${q.questionText}
Options:
${q.options.map((o) => `${o.label}. ${o.text}`).join('\n')}
My answer: ${r?.selected?.length ? r.selected.join(', ') : '(not answered)'}
${known ? `Correct answer: ${q.correctAnswer!.join(', ')}${how}` : 'The correct answer is NOT known.'}
${q.explanation ? `Source explanation: ${q.explanation}` : ''}

${known
    ? 'Explain step by step why the verified answer is correct and where my reasoning likely went wrong. Finish with one tip to avoid this mistake.'
    : 'Explain the concept being tested and how to approach it. Do NOT state which option is correct as fact; if you reason towards an answer, clearly label it as your unverified opinion.'}`
  const { text } = await runAI(userId, 'explain_wrong_answer', (p) =>
    p.generateText({ system: `${BASE_SYSTEM}\nYou are explaining a single exam question.`, messages: [{ role: 'user', content: prompt }], maxTokens: 3000 })
  )
  return { content: text, answerVerified: Boolean(known) }
}

export async function explainTopic(userId: Oid, topicId: string, focus?: string) {
  const cur = await loadCurriculum(userId)
  const topic = cur.topic(topicId)
  if (!topic) throw notFound('Topic')
  const chapter = cur.chapter(topic.chapterId)!
  const subject = cur.subject(topic.subjectId)!
  const prompt = `Explain the topic "${topic.name}" (chapter "${chapter.name}", subject "${subject.name}") for a competitive-exam student.
${topic.keyPoints.length ? `Key points I noted: ${topic.keyPoints.join('; ')}` : ''}
${topic.formulas.length ? `Formulas I noted: ${topic.formulas.join('; ')}` : ''}
${focus ? `I am specifically confused about: ${focus}` : ''}
Give: core idea, key rules/formulas, one worked example, common traps, and a 3-line recap.`
  const { text } = await runAI(userId, 'explain_topic', (p) =>
    p.generateText({ system: 'You are a precise, friendly tutor for Indian competitive exams. Use Markdown. Keep formulas and units exact.', messages: [{ role: 'user', content: prompt }], maxTokens: 4000 })
  )
  return { content: text, topic: { id: topic.id, name: topic.name, chapter: chapter.name, subject: subject.name } }
}

const generatedSchema = z.object({
  questions: z.array(
    z.object({
      questionText: z.string().min(5),
      options: z.array(z.string().min(1)).length(4),
      correctOption: z.enum(['A', 'B', 'C', 'D']),
      explanation: z.string(),
      difficulty: z.enum(['easy', 'medium', 'hard'])
    })
  )
})
const generatedJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionText', 'options', 'correctOption', 'explanation', 'difficulty'],
        properties: {
          questionText: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctOption: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          explanation: { type: 'string' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] }
        }
      }
    }
  }
}

/**
 * Generates original practice MCQs for a topic into the shared question hub (origin
 * "ai_generated", flagged not_official_pyq). The generator's own answer is NOT trusted on its
 * own: each question is solved again independently by the answering step and becomes ready
 * only when that solve is confident and agrees with the generator.
 */
export async function generatePractice(userId: Oid, input: { topicId: string; count: number; difficulty: 'easy' | 'medium' | 'hard' | 'mixed' }) {
  const cur = await loadCurriculum(userId)
  const topic = cur.topic(input.topicId)
  if (!topic) throw notFound('Topic')
  const chapter = cur.chapter(topic.chapterId)!
  const subject = cur.subject(topic.subjectId)!
  const { data } = await runAI(userId, 'generate_practice', (p) =>
    p.generateJson({
      system:
        'You write ORIGINAL multiple-choice practice questions for Indian competitive exams (SSC/RRB style). Never copy or claim questions are from real previous-year papers. Each question has exactly 4 options and one correct option. Keep units and notation exact.',
      prompt: `Write ${input.count} ${input.difficulty === 'mixed' ? 'mixed-difficulty' : input.difficulty} questions on "${topic.name}" (chapter "${chapter.name}", subject "${subject.name}"). Include a short explanation for each.`,
      jsonSchema: generatedJsonSchema,
      schemaName: 'practice_questions',
      validate: generatedSchema,
      maxTokens: 6000
    })
  )
  const saved = []
  let duplicates = 0
  for (const g of data.questions.slice(0, input.count)) {
    const options = g.options.map((text, i) => ({ label: ['A', 'B', 'C', 'D'][i], text: text.trim() }))
    try {
      const q = await Question.create({
        uploadedBy: userId,
        origin: 'ai_generated',
        rawText: '',
        questionText: g.questionText.trim(),
        questionType: 'single_correct',
        options,
        correctAnswer: null,
        explanation: g.explanation,
        subjectName: subject.name,
        subjectKey: taxonomyKey(subject.name),
        chapterName: chapter.name,
        chapterKey: taxonomyKey(chapter.name),
        topicName: topic.name,
        topicKey: taxonomyKey(topic.name),
        difficulty: g.difficulty,
        status: 'pending_answer',
        extractionConfidence: 1,
        flags: ['ai_generated', 'not_official_pyq'],
        aiStructured: { generatorAnswer: [g.correctOption] },
        contentHash: normalizeForHash(g.questionText, options)
      })
      saved.push(q)
    } catch (err) {
      if ((err as { code?: number }).code === 11000) duplicates += 1
      else throw err
    }
  }
  await enqueueAnswering(saved.map((q) => q._id))
  return { questions: saved.map((q) => serializeQuestion(q.toObject() as never, userId)), duplicates }
}

export async function aiStatus(userId: Oid) {
  const provider = getAIProvider()
  const settings = await getSettings(userId)
  return {
    configured: Boolean(provider),
    provider: provider?.name ?? null,
    model: provider?.model ?? null,
    enabledForUser: settings.ai?.enabled !== false,
    usage: await aiUsageToday(userId),
    dailyLimit: env.AI_DAILY_REQUEST_LIMIT
  }
}
