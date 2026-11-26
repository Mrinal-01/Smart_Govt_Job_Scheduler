import { describe, expect, it } from 'vitest'
import { normalizeForHash, parseQuestions } from '../src/modules/documents/extraction/questionParser.js'

const page = (text: string, pageNumber = 1) => ({ pageNumber, text })

describe('question parser', () => {
  it('splits numbered questions with (a)-(d) options and keeps source page/number', () => {
    const r = parseQuestions([
      page(`Physics Practice Set
1. What is the SI unit of force?
(a) Joule (b) Newton (c) Watt (d) Pascal
2. The acceleration due to gravity on Earth is about
(a) 9.8 m/s^2
(b) 98 m/s^2
(c) 0.98 m/s^2
(d) 980 m/s^2`),
      page(`3. Which of the following is a vector quantity?
A. Speed B. Mass C. Velocity D. Time`, 2)
    ])
    expect(r.questions).toHaveLength(3)
    const [q1, q2, q3] = r.questions
    expect(q1.questionText).toBe('What is the SI unit of force?')
    expect(q1.options).toEqual([
      { label: 'A', text: 'Joule' },
      { label: 'B', text: 'Newton' },
      { label: 'C', text: 'Watt' },
      { label: 'D', text: 'Pascal' }
    ])
    expect(q1.questionType).toBe('single_correct')
    expect(q1.answer).toBeNull() // never invented
    expect(q2.options[0].text).toBe('9.8 m/s^2') // notation preserved
    expect(q3.pageNumber).toBe(2)
    expect(q3.number).toBe('3')
    expect(q3.options.map((o) => o.text)).toEqual(['Speed', 'Mass', 'Velocity', 'Time'])
    expect(q1.confidence).toBe(1)
    expect(r.answerKeyFound).toBe(false)
  })

  it('reads answers only from an answer key section in the document', () => {
    const r = parseQuestions([
      page(`Q1. 2 + 2 = ?
(A) 3 (B) 4 (C) 5 (D) 6
Q2. Capital of India?
(A) Mumbai (B) Delhi (C) Kolkata (D) Chennai
Answer Key
1. (b) 2. (b)`)
    ])
    expect(r.answerKeyFound).toBe(true)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].answer).toEqual(['B'])
    expect(r.questions[0].flags).toContain('answer_from_document_key')
    // answer key lines are not glued to the last question
    expect(r.questions[1].options[3].text).toBe('Chennai')
  })

  it('reads inline "Ans:" lines and explanations', () => {
    const r = parseQuestions([
      page(`1. Speed of light in vacuum is approximately
(a) 3 x 10^8 m/s (b) 3 x 10^6 m/s (c) 3 x 10^5 km/h (d) 300 m/s
Ans: (a)
Explanation: c = 299,792,458 m/s.`)
    ])
    expect(r.questions[0].answer).toEqual(['A'])
    expect(r.questions[0].explanation).toBe('c = 299,792,458 m/s.')
    expect(r.questions[0].options).toHaveLength(4)
  })

  it('handles numeric option labels (1)-(4) and statement lists without splitting questions', () => {
    const r = parseQuestions([
      page(`1. Consider the following statements:
1. Iron is a metal.
2. Oxygen is a metal.
Which of the above is correct?
(1) Only 1
(2) Only 2
(3) Both
(4) Neither
2. Next question here?
(a) yes (b) no`)
    ])
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].questionText).toContain('Oxygen is a metal.')
    expect(r.questions[0].options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(r.questions[0].options[0].text).toBe('Only 1')
  })

  it('flags uncertain extractions for review instead of guessing', () => {
    const r = parseQuestions([page(`1. Explain Newton's third law with an example.\n2. Short?\n(a) x (b) y`)])
    expect(r.questions[0].options).toEqual([])
    expect(r.questions[0].flags).toContain('no_options_detected')
    expect(r.questions[0].confidence).toBeLessThan(0.8)
    expect(r.questions[1].flags).toContain('fewer_than_4_options')
  })

  it('ignores page-number noise and drops answer labels that are not options', () => {
    const r = parseQuestions([
      page(`1. Pick one
(a) red (b) blue
Page 1 of 3
Answer Key
1. (d) 2. (a)`)
    ])
    expect(r.questions[0].options[1].text).toBe('blue')
    expect(r.questions[0].answer).toBeNull()
    expect(r.questions[0].flags).toContain('answer_label_not_in_options')
  })

  it('produces the same hash regardless of whitespace/case/option order', () => {
    const a = normalizeForHash('What is  2+2?', [{ text: '4' }, { text: '5' }])
    const b = normalizeForHash('what is 2+2?', [{ text: '5' }, { text: '4' }])
    expect(a).toBe(b)
  })
})
