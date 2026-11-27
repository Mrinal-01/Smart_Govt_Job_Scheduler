import { addDays, dateKey } from '../../lib/dates.js'
import { ExamMistake, GateOverride, MockTestAttempt, RevisionAttempt, RevisionObligation, ScheduleVersion, StudySession, StudyWorkspace } from '../../models/index.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { weekStartOf, weeklyDueDate, type Oid } from './plan.context.js'
import { ensureWeekly, serializeMany } from './plan.revision.js'
import { prepare } from './plan.service.js'

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)

/* ------------------------------------------------------------------ */
/* Weekly review (Sunday Review integration)                           */
/* ------------------------------------------------------------------ */

export async function getWeekly(userId: Oid, weekStartInput?: string) {
  const ctx = await prepare(userId)
  const weekStart = weekStartOf(weekStartInput ?? ctx.today)
  const weekEnd = addDays(weekStart, 6)
  await ensureWeekly(ctx, weekStart)

  const [obligations, sessions, attempts, examMistakes, ws, mocks] = await Promise.all([
    RevisionObligation.find({ userId, type: 'weekly', weekStart }).sort({ subjectName: 1 }).lean(),
    StudySession.find({ userId, date: { $gte: weekStart, $lte: weekEnd } }).lean(),
    RevisionAttempt.find({ userId, completedDate: { $gte: weekStart, $lte: weekEnd } }).lean(),
    ExamMistake.find({ userId, status: { $ne: 'resolved' } }).sort({ lastSeenAt: -1 }).limit(20).lean(),
    StudyWorkspace.findOne({ userId }).select('data.chapters data.mistakes').lean(),
    MockTestAttempt.find({ userId, status: { $in: ['submitted', 'auto_submitted'] }, submittedAt: { $gte: new Date(`${addDays(weekStart, -1)}T00:00:00Z`) } })
      .select('testName submittedAt result')
      .lean()
  ])

  // Week's completed topics, grouped subject → chapter.
  const subjects = new Map<string, { subjectId: string; subjectName: string; chapters: Map<string, { chapterId: string; chapterName: string; topics: Map<string, { topicId: string; topicName: string; dates: string[] }> }> }>()
  for (const s of sessions.filter((x) => x.sessionType === 'learning' && x.status === 'completed')) {
    for (const t of s.completion?.topics ?? []) {
      if (t.completion !== 'completed') continue
      const subj = subjects.get(s.subjectId) ?? { subjectId: s.subjectId, subjectName: s.subjectName, chapters: new Map() }
      const ch = subj.chapters.get(t.chapterId) ?? { chapterId: t.chapterId, chapterName: t.chapterName, topics: new Map() }
      const tp = ch.topics.get(t.topicId) ?? { topicId: t.topicId, topicName: t.topicName, dates: [] }
      if (!tp.dates.includes(s.date)) tp.dates.push(s.date)
      ch.topics.set(t.topicId, tp)
      subj.chapters.set(t.chapterId, ch)
      subjects.set(s.subjectId, subj)
    }
  }
  const weekTopicIds = new Set(Array.from(subjects.values()).flatMap((s) => Array.from(s.chapters.values()).flatMap((c) => Array.from(c.topics.keys()))))

  const data = (ws?.data ?? {}) as {
    chapters?: Array<{ id: string; name: string; subjectId: string; topics?: Array<{ id: string; name: string; questionsAttempted?: number; questionsCorrect?: number; mistakeCount?: number }> }>
    mistakes?: Array<{ id: string; topicId: string; question: string; status: string; category?: string; date?: string }>
  }
  const weakTopics = (data.chapters ?? [])
    .flatMap((c) => (c.topics ?? []).map((t) => ({ ...t, chapterName: c.name, subjectId: c.subjectId })))
    .map((t) => ({
      topicId: t.id,
      topicName: t.name,
      chapterName: t.chapterName,
      subjectId: t.subjectId,
      accuracy: (t.questionsAttempted ?? 0) >= 5 ? pct(t.questionsCorrect ?? 0, t.questionsAttempted ?? 0) : null,
      mistakeCount: t.mistakeCount ?? 0,
      inThisWeek: weekTopicIds.has(t.id)
    }))
    .filter((t) => (t.accuracy !== null && t.accuracy < 60) || t.mistakeCount >= 2)
    .sort((a, b) => Number(b.inThisWeek) - Number(a.inThisWeek) || (a.accuracy ?? 100) - (b.accuracy ?? 100))
    .slice(0, 12)
  const lowConfidence = attempts.filter((a) => a.confidence <= 2).flatMap((a) => a.topicsRevised)

  const inWeek = (d: Date | null | undefined) => {
    if (!d) return false
    const k = dateKey(new Date(d), ctx.tz)
    return k >= weekStart && k <= weekEnd
  }
  const weekMocks = mocks.filter((m) => inWeek(m.submittedAt))
  const mockAcc = weekMocks.map((m) => (m.result as { accuracy?: number } | null)?.accuracy).filter((a): a is number => typeof a === 'number')

  const learning = sessions.filter((s) => s.sessionType === 'learning' && s.date <= ctx.today)
  const views = await serializeMany(obligations, ctx.today)
  return {
    weekStart,
    weekEnd,
    dueDate: weeklyDueDate(ctx, weekStart),
    today: ctx.today,
    obligations: views,
    progress: {
      total: views.length,
      completed: views.filter((o) => o.status === 'completed').length,
      inProgress: views.filter((o) => o.status === 'in_progress').length,
      pending: views.filter((o) => o.status === 'pending').length,
      topicsTotal: views.reduce((a, o) => a + o.topics.length, 0),
      topicsRevised: views.filter((o) => o.status === 'completed').reduce((a, o) => a + o.topics.length, 0)
    },
    topics: Array.from(subjects.values()).map((s) => ({
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      chapters: Array.from(s.chapters.values()).map((c) => ({ chapterId: c.chapterId, chapterName: c.chapterName, topics: Array.from(c.topics.values()) }))
    })),
    mistakes: {
      unresolvedMockMistakes: examMistakes.map((m) => ({ id: String(m._id), question: m.questionText, topicId: m.topicId, topicName: m.topicName, subjectName: m.subjectName, category: m.category, occurrences: m.occurrences, inThisWeek: weekTopicIds.has(m.topicId ?? '') })),
      unresolvedBankCount: (data.mistakes ?? []).filter((m) => m.status !== 'resolved').length,
      weekBankMistakes: (data.mistakes ?? []).filter((m) => m.status !== 'resolved' && weekTopicIds.has(m.topicId)).slice(0, 20)
    },
    weakTopics,
    lowConfidenceTopicIds: Array.from(new Set(lowConfidence)),
    mockTests: { count: weekMocks.length, averageAccuracy: mockAcc.length ? Math.round(mockAcc.reduce((a, b) => a + b, 0) / mockAcc.length) : null, tests: weekMocks.map((m) => ({ id: String(m._id), name: m.testName, submittedAt: m.submittedAt, accuracy: (m.result as { accuracy?: number } | null)?.accuracy ?? null })) },
    summary: {
      learningSessionsPlanned: learning.length,
      learningSessionsCompleted: learning.filter((s) => s.status === 'completed').length,
      skipped: learning.filter((s) => s.status === 'skipped').length,
      missed: learning.filter((s) => s.status === 'missed').length,
      learningMinutes: learning.filter((s) => s.status === 'completed').reduce((a, s) => a + s.actualMinutes, 0),
      revisionMinutes: attempts.reduce((a, r) => a + r.actualMinutes, 0),
      revisionsCompleted: { same_day: attempts.filter((a) => a.type === 'same_day').length, next_day: attempts.filter((a) => a.type === 'next_day').length, weekly: attempts.filter((a) => a.type === 'weekly').length },
      revisionAccuracy: pct(attempts.reduce((a, r) => a + r.questionsCorrect, 0), attempts.reduce((a, r) => a + r.questionsAttempted, 0))
    }
  }
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

type Bucket = { total: number; completed: number; open: number; overdue: number; bypassed: number; completionRate: number | null }
const emptyBucket = (): Bucket => ({ total: 0, completed: 0, open: 0, overdue: 0, bypassed: 0, completionRate: null })

/**
 * Learning and revision are measured separately: revision minutes never count as learning,
 * and a bypassed (overridden) revision is open, never completed.
 */
export async function getAnalytics(userId: Oid, days: number) {
  const ctx = await prepare(userId)
  const from = addDays(ctx.today, -(days - 1))
  const to = ctx.today
  const [sessions, obligations, attempts, overrides, scheduleOverrides, allLearning] = await Promise.all([
    StudySession.find({ userId, date: { $gte: from, $lte: to } }).lean(),
    RevisionObligation.find({ userId, dueDate: { $gte: from, $lte: to } }).lean(),
    RevisionAttempt.find({ userId, completedDate: { $gte: from, $lte: to } }).lean(),
    GateOverride.find({ userId, sessionDate: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).lean(),
    ScheduleVersion.find({ userId, override: true, publishedAt: { $gte: new Date(`${from}T00:00:00Z`) } }).select('version overrideReason publishedAt').lean(),
    StudySession.find({ userId, sessionType: 'learning', status: 'completed' }).select('completion.topics').lean()
  ])
  const cur = await loadCurriculum(userId)

  const byType = (s: { sessionType: string }, t: string) => s.sessionType === t
  const learning = sessions.filter((s) => byType(s, 'learning'))
  const completedLearning = learning.filter((s) => s.status === 'completed')
  const time = {
    plannedLearningMinutes: learning.reduce((a, s) => a + s.plannedMinutes, 0),
    actualLearningMinutes: completedLearning.reduce((a, s) => a + s.actualMinutes, 0),
    plannedRevisionMinutes: obligations.reduce((a, o) => a + o.plannedMinutes, 0),
    actualRevisionMinutes: attempts.reduce((a, r) => a + r.actualMinutes, 0),
    practiceMinutes: sessions.filter((s) => byType(s, 'practice') && s.status === 'completed').reduce((a, s) => a + s.actualMinutes, 0),
    mockTestMinutes: sessions.filter((s) => byType(s, 'mock_test') && s.status === 'completed').reduce((a, s) => a + s.actualMinutes, 0),
    scheduledRevisionSessionMinutes: sessions.filter((s) => byType(s, 'revision') && s.status === 'completed').reduce((a, s) => a + s.actualMinutes, 0)
  }

  const revisions: Record<'same_day' | 'next_day' | 'weekly', Bucket> = { same_day: emptyBucket(), next_day: emptyBucket(), weekly: emptyBucket() }
  for (const o of obligations) {
    const b = revisions[o.type as keyof typeof revisions]
    b.total += 1
    if (o.status === 'completed') b.completed += 1
    else {
      b.open += 1
      if (o.dueDate < ctx.today) b.overdue += 1
      if ((o.bypassedBy ?? []).length) b.bypassed += 1
    }
  }
  for (const b of Object.values(revisions)) b.completionRate = pct(b.completed, b.total)

  const subjectsMap = new Map<string, { subjectId: string; subjectName: string; plannedSessions: number; completedSessions: number; skipped: number; missed: number; learningMinutes: number; revisionMinutes: number; revisionsDue: number; revisionsCompleted: number }>()
  const subj = (id: string, name: string) => {
    if (!subjectsMap.has(id)) subjectsMap.set(id, { subjectId: id, subjectName: name, plannedSessions: 0, completedSessions: 0, skipped: 0, missed: 0, learningMinutes: 0, revisionMinutes: 0, revisionsDue: 0, revisionsCompleted: 0 })
    return subjectsMap.get(id)!
  }
  for (const s of learning) {
    const row = subj(s.subjectId, s.subjectName)
    if (s.date < ctx.today || s.status !== 'scheduled') row.plannedSessions += 1
    if (s.status === 'completed') {
      row.completedSessions += 1
      row.learningMinutes += s.actualMinutes
    }
    if (s.status === 'skipped') row.skipped += 1
    if (s.status === 'missed') row.missed += 1
  }
  for (const o of obligations) {
    const row = subj(o.subjectId, o.subjectName)
    row.revisionsDue += 1
    if (o.status === 'completed') row.revisionsCompleted += 1
  }
  for (const a of attempts) {
    const row = subjectsMap.get(a.subjectId)
    if (row) row.revisionMinutes += a.actualMinutes
  }

  const learnedTopics = new Set(allLearning.flatMap((s) => (s.completion?.topics ?? []).filter((t) => t.completion === 'completed').map((t) => t.topicId)))
  const allAttempts = await RevisionAttempt.find({ userId }).select('topicsRevised').lean()
  const revisedTopics = new Set(allAttempts.flatMap((a) => a.topicsRevised))
  const chapters = cur.chapters
    .map((c) => ({
      chapterId: c.id,
      chapterName: c.name,
      subjectId: c.subjectId,
      subjectName: cur.subject(c.subjectId)?.name ?? '',
      topicsTotal: c.topics.length,
      topicsLearned: c.topics.filter((t) => learnedTopics.has(t.id)).length,
      topicsRevised: c.topics.filter((t) => revisedTopics.has(t.id)).length
    }))
    .filter((c) => c.topicsLearned > 0 || c.topicsRevised > 0)

  const learnQ = completedLearning.reduce((a, s) => a + (s.completion?.questionsAttempted ?? 0), 0)
  const learnC = completedLearning.reduce((a, s) => a + (s.completion?.questionsCorrect ?? 0), 0)
  const revQ = attempts.reduce((a, r) => a + r.questionsAttempted, 0)
  const revC = attempts.reduce((a, r) => a + r.questionsCorrect, 0)

  const daily = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    daily.push({
      date: d,
      learningMinutes: completedLearning.filter((s) => s.date === d).reduce((a, s) => a + s.actualMinutes, 0),
      revisionMinutes: attempts.filter((r) => r.completedDate === d).reduce((a, r) => a + r.actualMinutes, 0)
    })
  }

  const pastLearning = learning.filter((s) => s.date < ctx.today || s.status !== 'scheduled')
  return {
    range: { from, to, days },
    time,
    revisions,
    overdueRevisions: obligations.filter((o) => o.status !== 'completed' && o.dueDate < ctx.today).length,
    sessions: {
      planned: pastLearning.length,
      completed: completedLearning.length,
      skipped: sessions.filter((s) => s.status === 'skipped').length,
      missed: sessions.filter((s) => s.status === 'missed').length,
      completionRate: pct(completedLearning.length, pastLearning.length)
    },
    overrides: {
      gate: overrides.length,
      schedule: scheduleOverrides.length,
      recent: overrides.slice(0, 10).map((o) => ({ id: String(o._id), date: o.sessionDate, subjectName: o.subjectName, reason: o.reason, originalState: o.originalState, obligations: o.obligationIds.length, createdAt: o.createdAt }))
    },
    subjects: Array.from(subjectsMap.values()).map((s) => ({ ...s, completionRate: pct(s.completedSessions, s.plannedSessions), revisionCompletionRate: pct(s.revisionsCompleted, s.revisionsDue) })),
    chapters,
    performance: {
      learningQuestions: learnQ,
      learningAccuracy: pct(learnC, learnQ),
      revisionQuestions: revQ,
      revisionAccuracy: pct(revC, revQ),
      averageRevisionConfidence: attempts.length ? Math.round((attempts.reduce((a, r) => a + r.confidence, 0) / attempts.length) * 10) / 10 : null
    },
    daily
  }
}
