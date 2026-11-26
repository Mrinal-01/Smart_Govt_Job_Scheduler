import { describe, expect, it } from 'vitest'
import { outcomeFor, scoreAttempt } from '../src/modules/exams/scoring.js'
import { apportion } from '../src/modules/exams/selection.service.js'

const q = (id: string, correct: string[] | null, extra: Record<string, unknown> = {}) => ({
  questionId: id,
  questionType: 'single_correct',
  correctAnswer: correct,
  answerVerified: correct !== null,
  subjectId: 's1',
  subjectName: 'Maths',
  chapterId: 'c1',
  chapterName: 'Percentage',
  difficulty: 'easy',
  ...extra
})

describe('scoring', () => {
  it('scores correct, incorrect, unanswered and unscored with negative marking', () => {
    const r = scoreAttempt({
      questions: [q('1', ['A']), q('2', ['B']), q('3', ['C']), q('4', null), q('5', null, { chapterId: 'c2', chapterName: 'Ratio' })],
      answers: new Map([
        ['1', ['A']],
        ['2', ['A']],
        ['4', ['D']]
      ]),
      marksPerQuestion: 2,
      negativeMarks: 0.5,
      timeTakenSeconds: 120
    })
    expect(r).toMatchObject({ totalQuestions: 5, attempted: 3, correct: 1, incorrect: 1, unanswered: 1, unscored: 2, unscoredAttempted: 1, marks: 1.5, maxMarks: 6, accuracy: 50, scoringComplete: false })
    expect(r.byChapter.find((c) => c.key === 'c2')).toMatchObject({ total: 1, unscored: 1, accuracy: null })
    expect(r.bySubject[0]).toMatchObject({ total: 5, correct: 1, incorrect: 1 })
  })

  it('handles multiple-correct and numeric answers exactly', () => {
    expect(outcomeFor(q('1', ['A', 'C'], { questionType: 'multiple_correct' }), ['C', 'A'])).toBe('correct')
    expect(outcomeFor(q('1', ['A', 'C'], { questionType: 'multiple_correct' }), ['A'])).toBe('incorrect')
    expect(outcomeFor(q('1', ['42'], { questionType: 'numeric' }), ['42.0'])).toBe('correct')
    expect(outcomeFor(q('1', ['42'], { questionType: 'numeric' }), ['41'])).toBe('incorrect')
    expect(outcomeFor(q('1', ['A'], { answerVerified: false }), ['B'])).toBe('unscored')
  })

  it('apportions difficulty counts exactly', () => {
    expect(apportion(10, { easy: 30, medium: 50, hard: 20 })).toEqual({ easy: 3, medium: 5, hard: 2 })
    const odd = apportion(7, { easy: 34, medium: 33, hard: 33 })
    expect(odd.easy + odd.medium + odd.hard).toBe(7)
  })
})
