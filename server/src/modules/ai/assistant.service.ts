import type { Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { addDays, dateKey } from '../../lib/dates.js'
import { conflict, notFound, unprocessable } from '../../lib/errors.js'
import { getAIProvider } from '../../integrations/ai.js'
import { ExamMistake, MockTestAttempt, Question, StudyWorkspace } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { performanceSummary } from '../exams/attempt.service.js'
import { getHistory } from '../cycles/cycle.service.js'
import { getSettings } from '../settings/settings.service.js'
import { normalizeForHash } from '../documents/extraction/questionParser.js'
import { aiUsageToday, runAI } from './ai.usage.js'

type Oid = Types.ObjectId

export const ANALYSIS_MODES = ['weak_subjects', 'weak_chapters', 'revision_priorities', 'weekly_summary', 'plan_suggestions', 'chat'] as const
export type AnalysisMode = (typeof ANALYSIS_MODES)[number]

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

/** Compact, factual snapshot of the authenticated student's data. */
export async function buildStudentContext(userId: Oid) {
  const today = dateKey()
  const ws = await StudyWorkspace.findOne({ userId }).lean()
  const data = (ws?.data ?? {}) as Record<string, unknown>
  const subjects = (data.subjects as Array<{ id: string; name: string }>) ?? []
  const chapters = (data.chapters as Array<{ id: string; name: string; subjectId: string; topics: WorkspaceTopic[] }>) ?? []
  const logs = ((data.logs as Array<{ date: string; plannedMinutes: number; actualMinutes: number; sessionsPlanned: number; sessionsCompleted: number; revisionsCompleted: number; seed?: boolean }>) ?? []).filter(
    (l) => l.date >= addDays(today, -6) && l.date <= today
  )
  const topics = chapters.flatMap((c) => c.topics.map((t) => ({ ...t, chapterName: c.name })))
  const subjectFacts = subjects.map((s) => {
    const st = topics.filter((t) => t.subjectId === s.id)
    const attempted = st.reduce((a, t) => a + (t.questionsAttempted ?? 0), 0)
    const correct = st.reduce((a, t) => a + (t.questionsCorrect ?? 0), 0)
    return {
      subject: s.name,
      topicsTotal: st.length,
      topicsLearned: st.filter((t) => t.initialLearningDate).length,
      practiceAccuracyPct: attempted ? Math.round((correct / attempted) * 100) : null,
      practiceQuestions: attempted,
      revisionsLogged: st.reduce((a, t) => a + (t.revisions?.length ?? 0), 0),
      revisionsDueNow: st.filter((t) => t.nextRevisionDue && t.nextRevisionDue <= today).length
    }
  })
  const weakTopics = topics
    .filter((t) => t.initialLearningDate && (t.questionsAttempted ?? 0) >= 5)
    .map((t) => ({
      topic: t.name,
      chapter: t.chapterName,
      subject: subjects.find((s) => s.id === t.subjectId)?.name,
      accuracyPct: Math.round(((t.questionsCorrect ?? 0) / Math.max(1, t.questionsAttempted ?? 0)) * 100),
      mistakes: t.mistakeCount ?? 0,
      confidence: t.confidence ?? null,
      nextRevisionDue: t.nextRevisionDue ?? null
    }))
    .sort((a, b) => a.accuracyPct - b.accuracyPct)
    .slice(0, 12)
  const overdue = topics
    .filter((t) => t.nextRevisionDue && t.nextRevisionDue <= today)
    .sort((a, b) => (a.nextRevisionDue! < b.nextRevisionDue! ? -1 : 1))
    .slice(0, 15)
    .map((t) => ({ topic: t.name, chapter: t.chapterName, dueSince: t.nextRevisionDue, revisionsSoFar: t.revisions?.length ?? 0 }))

  const perf = await performanceSummary(userId)
  const cycles = await getHistory(userId, 7)
  const mistakes = await ExamMistake.aggregate([{ $match: { userId, status: { $ne: 'resolved' } } }, { $group: { _id: '$subjectName', n: { $sum: 1 } } }])
  const profile = (data.profile ?? {}) as { targetExam?: string; examDate?: string | null }
  const settings = (data.settings ?? {}) as { dailyTargetMinutes?: number; weeklyTargetMinutes?: number }

  return {
    today,
    targetExam: profile.targetExam ?? null,
    examDate: profile.examDate ?? null,
    dailyTargetMinutes: settings.dailyTargetMinutes ?? null,
    weeklyTargetMinutes: settings.weeklyTargetMinutes ?? null,
    subjects: subjectFacts,
    weakestPracticedTopics: weakTopics,
    overdueRevisions: overdue,
    last7Days: logs.map((l) => ({
      date: l.date,
      plannedMinutes: l.plannedMinutes,
      actualMinutes: l.actualMinutes,
      sessionsCompleted: `${l.sessionsCompleted}/${l.sessionsPlanned}`,
      revisions: l.revisionsCompleted,
      generatedDemoData: Boolean(l.seed)
    })),
    studyCyclesLast7Days: cycles.map((c) => ({ date: c.date, cycle: c.cycleNumber, status: c.status, revisionTopicsDone: `${c.topicsCompleted}/${c.topicsDue}` })),
    mockTests: { finishedAttempts: perf.attempts, subjects: perf.subjects, weakChapters: perf.weakChapters },
    unresolvedExamMistakesBySubject: Object.fromEntries(mistakes.map((m) => [m._id ?? 'Unassigned', m.n]))
  }
}

const MODE_PROMPTS: Record<AnalysisMode, string> = {
  weak_subjects: 'Identify my weakest subjects and explain why, citing the numbers. Then give 3 concrete actions per weak subject.',
  weak_chapters: 'Identify my weakest chapters/topics from the data, explain the evidence, and give a short fix plan for each.',
  revision_priorities: 'Rank what I should revise next (top 8), with the reason for each (overdue days, low accuracy, mistakes). Do not change any schedule.',
  weekly_summary: 'Summarise my last 7 days: time studied vs planned, consistency, cycles, revisions and test performance. End with 3 priorities for next week.',
  plan_suggestions: 'Suggest improvements to my study plan (time split per subject, revision load, test frequency) based on the data. Keep them realistic.',
  chat: ''
}

export async function analyze(userId: Oid, mode: AnalysisMode, message?: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  if (mode === 'chat' && !message?.trim()) throw unprocessable('Type a question first.', 'MESSAGE_REQUIRED')
  const context = await buildStudentContext(userId)
  const ask = mode === 'chat' ? message!.trim() : `${MODE_PROMPTS[mode]}${message?.trim() ? `\nAdditional note from me: ${message.trim()}` : ''}`
  const { text } = await runAI(userId, `assistant:${mode}`, (p) =>
    p.generateText({
      system: `${BASE_SYSTEM}\n\nSTUDENT DATA (JSON, authoritative):\n${JSON.stringify(context)}`,
      messages: [...history.slice(-8), { role: 'user', content: ask }],
      maxTokens: 4000
    })
  )
  return { content: text, mode }
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
  const prompt = `Question (${q.subjectName ?? 'unknown subject'} / ${q.chapterName ?? 'unknown chapter'}):
${q.questionText}
Options:
${q.options.map((o) => `${o.label}. ${o.text}`).join('\n')}
My answer: ${r?.selected?.length ? r.selected.join(', ') : '(not answered)'}
${known ? `Verified correct answer: ${q.correctAnswer!.join(', ')}` : 'The correct answer is NOT known/verified.'}
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
 * Generates original practice MCQs for a topic. They are saved to the bank as
 * origin "ai_generated", status "needs_review" — clearly labelled, never as
 * official previous-year questions, and only usable in tests once verified.
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
      validate: generatedSchema,
      maxTokens: 6000
    })
  )
  const saved = []
  let duplicates = 0
  for (const g of data.questions.slice(0, input.count)) {
    const options = g.options.map((text, i) => ({ label: ['A', 'B', 'C', 'D'][i], text: text.trim() }))
    try {
      saved.push(
        await Question.create({
          userId,
          origin: 'ai_generated',
          rawText: '',
          questionText: g.questionText.trim(),
          questionType: 'single_correct',
          options,
          correctAnswer: [g.correctOption],
          answerSource: 'ai_generated',
          explanation: g.explanation,
          subjectId: subject.id,
          subjectName: subject.name,
          chapterId: chapter.id,
          chapterName: chapter.name,
          topicId: topic.id,
          topicName: topic.name,
          difficulty: g.difficulty,
          status: 'needs_review',
          extractionConfidence: 1,
          flags: ['ai_generated', 'not_official_pyq'],
          contentHash: normalizeForHash(g.questionText, options)
        })
      )
    } catch (err) {
      if ((err as { code?: number }).code === 11000) duplicates += 1
      else throw err
    }
  }
  return { questions: saved, duplicates }
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
