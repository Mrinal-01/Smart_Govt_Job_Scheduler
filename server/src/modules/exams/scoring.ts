/*
 * Pure scoring. A question whose correct answer is unknown/unverified is
 * "unscored": it is never counted as wrong and is excluded from marks,
 * maximum marks and accuracy.
 */

export type Outcome = 'correct' | 'incorrect' | 'unanswered' | 'unscored'

export interface ScoringQuestion {
  questionId: string
  questionType: string
  correctAnswer: string[] | null
  answerVerified: boolean
  subjectId?: string | null
  subjectName?: string | null
  chapterId?: string | null
  chapterName?: string | null
  difficulty?: string | null
}

export interface Breakdown {
  key: string
  name: string
  total: number
  scored: number
  correct: number
  incorrect: number
  unanswered: number
  unscored: number
  accuracy: number | null
}

export interface ScoreResult {
  totalQuestions: number
  attempted: number
  correct: number
  incorrect: number
  unanswered: number
  unscored: number
  unscoredAttempted: number
  marks: number
  maxMarks: number
  accuracy: number | null
  scoringComplete: boolean
  timeTakenSeconds: number
  bySubject: Breakdown[]
  byChapter: Breakdown[]
  byDifficulty: Breakdown[]
  questionResults: Array<{ questionId: string; outcome: Outcome; selected: string[] }>
}

function sameAnswer(type: string, selected: string[], correct: string[]) {
  if (type === 'numeric') {
    const a = Number(selected[0])
    const b = Number(correct[0])
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9
  }
  const s = [...new Set(selected.map((x) => x.toUpperCase()))].sort()
  const c = [...new Set(correct.map((x) => x.toUpperCase()))].sort()
  return s.length === c.length && s.every((x, i) => x === c[i])
}

export function outcomeFor(q: ScoringQuestion, selected: string[]): Outcome {
  if (!q.answerVerified || !q.correctAnswer?.length) return 'unscored'
  if (!selected.length) return 'unanswered'
  return sameAnswer(q.questionType, selected, q.correctAnswer) ? 'correct' : 'incorrect'
}

function group(rows: Array<{ q: ScoringQuestion; outcome: Outcome }>, keyOf: (q: ScoringQuestion) => [string, string]): Breakdown[] {
  const map = new Map<string, Breakdown>()
  for (const { q, outcome } of rows) {
    const [key, name] = keyOf(q)
    const b = map.get(key) ?? { key, name, total: 0, scored: 0, correct: 0, incorrect: 0, unanswered: 0, unscored: 0, accuracy: null }
    b.total += 1
    if (outcome !== 'unscored') b.scored += 1
    b[outcome] += 1
    map.set(key, b)
  }
  return Array.from(map.values()).map((b) => ({
    ...b,
    accuracy: b.correct + b.incorrect ? Math.round((b.correct / (b.correct + b.incorrect)) * 100) : null
  }))
}

export function scoreAttempt(input: {
  questions: ScoringQuestion[]
  answers: Map<string, string[]>
  marksPerQuestion: number
  negativeMarks: number
  timeTakenSeconds: number
}): ScoreResult {
  const rows = input.questions.map((q) => {
    const selected = input.answers.get(q.questionId) ?? []
    return { q, selected, outcome: outcomeFor(q, selected) }
  })
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length
  const correct = count('correct')
  const incorrect = count('incorrect')
  const unscored = count('unscored')
  const scored = rows.length - unscored
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    totalQuestions: rows.length,
    attempted: rows.filter((r) => r.selected.length).length,
    correct,
    incorrect,
    unanswered: count('unanswered'),
    unscored,
    unscoredAttempted: rows.filter((r) => r.outcome === 'unscored' && r.selected.length).length,
    marks: round2(correct * input.marksPerQuestion - incorrect * input.negativeMarks),
    maxMarks: round2(scored * input.marksPerQuestion),
    accuracy: correct + incorrect ? Math.round((correct / (correct + incorrect)) * 100) : null,
    scoringComplete: unscored === 0,
    timeTakenSeconds: input.timeTakenSeconds,
    bySubject: group(rows, (q) => [q.subjectId ?? 'none', q.subjectName ?? 'Unassigned']),
    byChapter: group(rows, (q) => [q.chapterId ?? 'none', q.chapterName ?? 'No chapter']),
    byDifficulty: group(rows, (q) => [q.difficulty ?? 'unknown', q.difficulty ?? 'unknown']),
    questionResults: rows.map((r) => ({ questionId: r.q.questionId, outcome: r.outcome, selected: r.selected }))
  }
}
