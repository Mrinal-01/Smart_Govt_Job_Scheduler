import type { Types } from 'mongoose'
import { z } from 'zod'
import { runAI } from '../../ai/ai.usage.js'
import type { ParsedQuestion } from './questionParser.js'

/*
 * Optional AI refinement of low-confidence extractions. Guardrails:
 *  - the model only restructures text that exists in the PDF (option/question
 *    text must be found in the raw extraction, otherwise the AI result is rejected);
 *  - it is never asked for, and never allowed to set, a correct answer;
 *  - results are stored separately (aiStructured) and the question stays
 *    "needs_review" until the student verifies it.
 */

const BATCH = 12
const MAX_BATCHES = 4

const SYSTEM = `You restructure exam questions that were extracted from a PDF by a text parser.
Rules you must follow:
- Use ONLY text that appears in the provided raw extraction. Do not paraphrase, translate, correct or complete anything.
- Never invent options. If you cannot find options in the raw text, return an empty options array.
- Never state or guess which option is correct.
- Preserve mathematical notation, symbols, units, subscripts and superscripts exactly as written.
- Option labels must be uppercase letters A, B, C, D, E in order.
- questionType: single_correct, multiple_correct, numeric, true_false or unknown.
- subjectName: one of the provided subject names if the question clearly belongs to it, otherwise null.`

const outputSchema = z.object({
  questions: z.array(
    z.object({
      index: z.number().int(),
      questionText: z.string(),
      options: z.array(z.object({ label: z.string(), text: z.string() })),
      questionType: z.enum(['single_correct', 'multiple_correct', 'numeric', 'true_false', 'unknown']),
      subjectName: z.string().nullable()
    })
  )
})

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'questionText', 'options', 'questionType', 'subjectName'],
        properties: {
          index: { type: 'integer' },
          questionText: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'text'],
              properties: { label: { type: 'string' }, text: { type: 'string' } }
            }
          },
          questionType: { type: 'string', enum: ['single_correct', 'multiple_correct', 'numeric', 'true_false', 'unknown'] },
          subjectName: { type: ['string', 'null'] }
        }
      }
    }
  }
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')

function grounded(raw: string, candidate: { questionText: string; options: Array<{ text: string }> }) {
  const src = squash(raw)
  if (!candidate.options.every((o) => o.text.trim() && src.includes(squash(o.text)))) return false
  const words = candidate.questionText.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  if (!words.length) return false
  const found = words.filter((w) => src.includes(w.replace(/\s+/g, ''))).length
  return found / words.length >= 0.85
}

export interface AiRefinement {
  index: number
  questionText: string
  options: Array<{ label: string; text: string }>
  questionType: ParsedQuestion['questionType']
  subjectName: string | null
  raw: unknown
}

export async function refineWithAI(
  userId: Types.ObjectId,
  parsed: ParsedQuestion[],
  subjectNames: string[]
): Promise<{ refinements: Map<number, AiRefinement>; rejected: Set<number>; note: string | null }> {
  const candidates = parsed.map((q, index) => ({ q, index })).filter(({ q }) => q.confidence < 0.8)
  const refinements = new Map<number, AiRefinement>()
  const rejected = new Set<number>()
  if (!candidates.length) return { refinements, rejected, note: null }

  let note: string | null = null
  const batches = []
  for (let i = 0; i < candidates.length && batches.length < MAX_BATCHES; i += BATCH) batches.push(candidates.slice(i, i + BATCH))
  if (candidates.length > BATCH * MAX_BATCHES) note = `AI reviewed the first ${BATCH * MAX_BATCHES} low-confidence questions (cost limit).`

  for (const batch of batches) {
    const prompt = `Subjects: ${subjectNames.length ? subjectNames.join(', ') : '(none provided)'}

Restructure each raw extraction below. Return one entry per index.

${batch.map(({ q, index }) => `### index ${index}\n${q.rawText}`).join('\n\n')}`
    const { data } = await runAI(userId, 'pdf_structuring', (p) =>
      p.generateJson({ system: SYSTEM, prompt, jsonSchema, validate: outputSchema, maxTokens: 8000 })
    )
    for (const item of data.questions) {
      const target = batch.find((b) => b.index === item.index)
      if (!target) continue
      const options = item.options.map((o, i) => ({ label: ['A', 'B', 'C', 'D', 'E'][i] ?? o.label, text: o.text.trim() })).slice(0, 5)
      const candidate = { ...item, options }
      if (!grounded(target.q.rawText, candidate)) {
        rejected.add(item.index)
        continue
      }
      refinements.set(item.index, {
        index: item.index,
        questionText: item.questionText.trim(),
        options,
        questionType: item.questionType,
        subjectName: item.subjectName,
        raw: item
      })
    }
  }
  return { refinements, rejected, note }
}
