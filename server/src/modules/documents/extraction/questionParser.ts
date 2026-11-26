import { sha256 } from '../../../lib/crypto.js'

/*
 * Deterministic question parser.
 * Input: per-page text. Output: question candidates with page/number source
 * references, options, an answer ONLY when the document itself states it
 * (answer-key section or inline "Ans:"), a confidence score and review flags.
 * Text is kept verbatim apart from whitespace normalisation so mathematical
 * notation, symbols and units are preserved.
 */

export type ParsedType = 'single_correct' | 'multiple_correct' | 'numeric' | 'true_false' | 'unknown'

export interface ParsedQuestion {
  number: string
  pageNumber: number
  rawText: string
  questionText: string
  options: Array<{ label: string; text: string }>
  questionType: ParsedType
  answer: string[] | null
  explanation: string | null
  confidence: number
  flags: string[]
}

export interface ParseResult {
  questions: ParsedQuestion[]
  answerKey: Record<string, string[]>
  answerKeyFound: boolean
}

interface Line {
  text: string
  page: number
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']
const NOISE = [/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i, /^\d{1,4}$/, /^-+\s*\d+\s*-+$/]
const KEY_HEADING = /^(answer\s*keys?|answers?|key\s*answers?|answer\s*sheet|solutions?)\s*[:\-–]?\s*$/i
const Q_PREFIXED = /^Q(?:uestion)?\s*\.?\s*(?:No\.?\s*)?(\d{1,3})\s*[.):\-]?\s+(.*)$/i
const Q_PLAIN = /^(\d{1,3})\s*[.):]\s+(.*)$/
const NUMERIC_OPTION_LINE = /^\(?([1-5])\)\s+/
const INLINE_ANSWER = /^(?:ans(?:wer)?|correct\s*(?:answer|option))\s*[:.\-–]?\s*(?:option\s*)?\(?([A-Ea-e1-5])\)?(?:\s*(?:,|and|&)\s*\(?([A-Ea-e1-5])\)?)*\s*$/i
const EXPLANATION = /^(?:explanation|solution|sol)\s*[:.\-–]\s*(.*)$/i

const collapse = (s: string) => s.replace(/[ \t]+/g, ' ').trim()
const toLetter = (label: string) => (/^[1-5]$/.test(label) ? LETTERS[Number(label) - 1] : label.toUpperCase())

function parseAnswerKey(text: string): Record<string, string[]> {
  const key: Record<string, string[]> = {}
  const letter = /(?:^|[\s,;|])(?:Q\.?\s*)?(\d{1,3})\s*[.):\-–]?\s*\(?([A-Ea-e])\)?(?=[\s,;|.]|$)/g
  const numeric = /(?:^|[\s,;|])(?:Q\.?\s*)?(\d{1,3})\s*[.):\-–]?\s*\(([1-5])\)/g
  for (const re of [letter, numeric]) {
    for (const m of text.matchAll(re)) {
      if (!key[m[1]]) key[m[1]] = [toLetter(m[2])]
    }
  }
  return Object.keys(key).length >= 2 ? key : {}
}

interface Marker {
  index: number
  end: number
  label: string
  style: string
}

function findMarkers(text: string, numeric: boolean): Marker[] {
  const re = numeric ? /(^|\s)\(([1-5])\)\s+/g : /(^|\s)(\(([A-Ea-e])\)|([A-Ea-e])[.)])\s+/g
  const out: Marker[] = []
  for (const m of text.matchAll(re)) {
    const lead = m[1].length
    const raw = numeric ? m[2] : (m[3] ?? m[4])
    const style = numeric ? '(n)' : m[3] ? `(${raw === raw.toLowerCase() ? 'a' : 'A'})` : `${raw === raw.toLowerCase() ? 'a' : 'A'}${m[2].slice(-1)}`
    out.push({ index: (m.index ?? 0) + lead, end: (m.index ?? 0) + m[0].length, label: toLetter(raw), style })
  }
  return out
}

/** Picks the longest in-order A, B, C… run of markers sharing one style. */
function optionRun(markers: Marker[]): Marker[] {
  let best: Marker[] = []
  markers.forEach((start, i) => {
    if (start.label !== 'A') return
    const run = [start]
    for (let j = i + 1; j < markers.length && run.length < LETTERS.length; j += 1) {
      const m = markers[j]
      if (m.style === start.style && m.label === LETTERS[run.length]) run.push(m)
    }
    if (run.length > best.length) best = run
  })
  return best.length >= 2 ? best : []
}

function splitOptions(text: string) {
  for (const numeric of [false, true]) {
    const run = optionRun(findMarkers(text, numeric))
    if (run.length) {
      const options = run.map((m, i) => ({
        label: m.label,
        text: collapse(text.slice(m.end, i + 1 < run.length ? run[i + 1].index : text.length).replace(/\n+/g, ' '))
      }))
      return { stem: text.slice(0, run[0].index).trim(), options }
    }
  }
  return { stem: text.trim(), options: [] as Array<{ label: string; text: string }> }
}

function classify(stem: string, options: Array<{ text: string }>): ParsedType {
  if (options.length === 2 && options.every((o) => /^(true|false)\.?$/i.test(o.text))) return 'true_false'
  if (options.length >= 2) {
    return /\b(select|choose|mark|tick)\s+(all|one or more|two|the correct (options|statements))\b|more than one (option|answer) (is|may be|can be) correct/i.test(
      stem
    )
      ? 'multiple_correct'
      : 'single_correct'
  }
  if (/(numerical|integer|numeric)\s+(value|answer|type)|answer\s+(in|to the nearest)\b/i.test(stem)) return 'numeric'
  return 'unknown'
}

export function normalizeForHash(questionText: string, options: Array<{ text: string }>) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[“”"']/g, '').trim()
  return sha256(`${norm(questionText)}||${options.map((o) => norm(o.text)).sort().join('|')}`)
}

export function parseQuestions(pages: Array<{ pageNumber: number; text: string }>): ParseResult {
  const lines: Line[] = pages.flatMap((p) =>
    p.text
      .split('\n')
      .map((t) => ({ text: collapse(t), page: p.pageNumber }))
      .filter((l) => l.text && !NOISE.some((re) => re.test(l.text)))
  )

  // 1. Answer key section (from its heading to the end of the document).
  const keyStart = lines.findIndex((l) => KEY_HEADING.test(l.text))
  let answerKey: Record<string, string[]> = {}
  let body = lines
  if (keyStart >= 0) {
    answerKey = parseAnswerKey(lines.slice(keyStart + 1).map((l) => l.text).join('\n'))
    if (Object.keys(answerKey).length) body = lines.slice(0, keyStart)
  }

  // 2. Segment into question blocks.
  interface Block {
    number: string
    page: number
    lines: string[]
    numericOptions: number
  }
  const blocks: Block[] = []
  let current: Block | null = null
  let last = 0
  const hasOptions = (b: Block) => optionRun(findMarkers(b.lines.join('\n'), false)).length >= 2 || b.numericOptions >= 2

  for (const line of body) {
    const numOpt = line.text.match(NUMERIC_OPTION_LINE)
    // "(1) …" / "1) …" lines are options (not new questions) when they continue a numeric
    // option run, or when the question stem so far ends with "?" or ":".
    if (
      current &&
      numOpt &&
      Number(numOpt[1]) === current.numericOptions + 1 &&
      (current.numericOptions > 0 || /[?:]\s*$/.test(current.lines.join(' ')))
    ) {
      current.numericOptions += 1
      current.lines.push(line.text.replace(NUMERIC_OPTION_LINE, `(${numOpt[1]}) `))
      continue
    }
    const prefixed = line.text.match(Q_PREFIXED)
    const m = prefixed ?? line.text.match(Q_PLAIN)
    if (m) {
      const n = Number(m[1])
      // "Consider the following statements: 1. … 2. …" — plain numbered lines belong to
      // the current question until its options appear.
      const inStatementList =
        !prefixed && current !== null && !hasOptions(current) && /(following|these|given)\s+(statements|pairs|items|points)|:\s*$/i.test(current.lines[0])
      const isNext = !inStatementList && (!current || n === last + 1 || (n === 1 && hasOptions(current)))
      if (isNext) {
        current = { number: String(n), page: line.page, lines: [m[2]], numericOptions: 0 }
        blocks.push(current)
        last = n
        continue
      }
    }
    if (current) current.lines.push(line.text)
  }

  // 3. Build question records.
  const questions = blocks.map((block): ParsedQuestion => {
    const flags: string[] = []
    let inlineAnswer: string[] | null = null
    const explanationLines: string[] = []
    const content: string[] = []
    let inExplanation = false
    for (const text of block.lines) {
      const ans = text.match(INLINE_ANSWER)
      if (ans) {
        inlineAnswer = Array.from(text.matchAll(/\(?([A-Ea-e1-5])\)?(?=\s*(?:,|and|&|$))/g)).map((x) => toLetter(x[1]))
        continue
      }
      const exp = text.match(EXPLANATION)
      if (exp) {
        inExplanation = true
        if (exp[1]) explanationLines.push(exp[1])
        continue
      }
      ;(inExplanation ? explanationLines : content).push(text)
    }
    const rawText = [`${block.number}. ${block.lines.join('\n')}`].join('')
    const { stem, options } = splitOptions(content.join('\n'))
    const questionType = classify(stem, options)

    let confidence = 1
    if (!options.length && questionType !== 'numeric') {
      confidence -= 0.5
      flags.push('no_options_detected')
    }
    if (questionType === 'single_correct' && options.length < 4) {
      confidence -= 0.15
      flags.push('fewer_than_4_options')
    }
    if (stem.length < 12) {
      confidence -= 0.3
      flags.push('short_question_text')
    }
    if (options.some((o) => !o.text)) {
      confidence -= 0.3
      flags.push('empty_option')
    }

    let answer: string[] | null = (inlineAnswer as string[] | null) ?? answerKey[block.number] ?? null
    if (answer && options.length && !answer.every((a) => options.some((o) => o.label === a))) {
      flags.push('answer_label_not_in_options')
      answer = null
    }
    if (answer) flags.push(inlineAnswer ? 'answer_from_document_inline' : 'answer_from_document_key')

    return {
      number: block.number,
      pageNumber: block.page,
      rawText,
      questionText: stem || content.join('\n').trim(),
      options,
      questionType,
      answer,
      explanation: explanationLines.length ? explanationLines.join('\n') : null,
      confidence: Math.max(0, Math.round(confidence * 100) / 100),
      flags
    }
  })

  return { questions: questions.filter((q) => q.questionText.length > 0), answerKey, answerKeyFound: Object.keys(answerKey).length > 0 }
}
