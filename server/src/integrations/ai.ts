import type { z } from 'zod'
import { env } from '../config/env.js'
import { AppError, unavailable } from '../lib/errors.js'

/*
 * AI provider: OpenAI Responses API over plain HTTPS (no SDK dependency).
 *
 *   POST {AI_BASE_URL}/responses   Authorization: Bearer <key>
 *   body: { model, instructions, input, max_output_tokens, reasoning: { effort },
 *           text: { format: { type: 'json_schema', name, strict: true, schema } } }
 *   reply: { status, output: [{ type: 'message', content: [{ type: 'output_text' | 'refusal', … }] }], usage }
 *
 * Docs: https://developers.openai.com/api/docs/guides/structured-outputs
 *       https://developers.openai.com/api/docs/guides/reasoning
 *       https://developers.openai.com/api/docs/models
 *
 * Only the server talks to the model; the API key never leaves the backend. With
 * AI_PROVIDER=none (or no key) every AI feature reports "not configured" and the
 * rest of the app keeps working.
 */

export interface AIUsage {
  inputTokens: number
  outputTokens: number
}

export type AIEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

interface CallOptions {
  /** Overrides AI_MODEL for this call (e.g. the answer-solving model). */
  model?: string
  effort?: AIEffort
  maxTokens?: number
}

export interface AIJsonRequest<T> extends CallOptions {
  system: string
  prompt: string
  /** JSON Schema for the structured output; converted to OpenAI strict mode automatically. */
  jsonSchema: Record<string, unknown>
  schemaName?: string
  /** Re-validated locally — the model's output is never trusted blindly. */
  validate: z.ZodType<T>
}

export interface AITextRequest extends CallOptions {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface AIProvider {
  name: string
  model: string
  generateJson<T>(req: AIJsonRequest<T>): Promise<{ data: T; usage: AIUsage }>
  generateText(req: AITextRequest): Promise<{ text: string; usage: AIUsage }>
}

/**
 * OpenAI strict mode needs every object to list all properties as required and set
 * additionalProperties: false. Optional properties become nullable instead.
 */
export function toStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSchema)
  if (!schema || typeof schema !== 'object') return schema
  const s = { ...(schema as Record<string, unknown>) }
  for (const key of ['items', 'anyOf', 'oneOf', '$defs', 'definitions']) {
    if (s[key] && typeof s[key] === 'object') {
      s[key] = Array.isArray(s[key])
        ? (s[key] as unknown[]).map(toStrictSchema)
        : key === 'items'
          ? toStrictSchema(s[key])
          : Object.fromEntries(Object.entries(s[key] as Record<string, unknown>).map(([k, v]) => [k, toStrictSchema(v)]))
    }
  }
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, unknown>
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : [])
    s.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => {
        const strict = toStrictSchema(v) as Record<string, unknown>
        if (required.has(k)) return [k, strict]
        // optional → required but nullable
        const t = strict.type
        if (typeof t === 'string') return [k, { ...strict, type: [t, 'null'] }]
        if (Array.isArray(t)) return [k, { ...strict, type: t.includes('null') ? t : [...t, 'null'] }]
        return [k, { anyOf: [strict, { type: 'null' }] }]
      })
    )
    s.required = Object.keys(props)
    s.additionalProperties = false
  }
  return s
}

/**
 * Drops null values the strict schema introduced, so local zod `.optional()` validation still passes.
 * Consequence for callers: write optional fields as `.nullish()` / `.optional()`, never `.nullable()` alone.
 */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, stripNulls(v)])
    )
  }
  return value
}

interface ResponsesReply {
  status?: string
  incomplete_details?: { reason?: string } | null
  error?: { message?: string } | null
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

class OpenAIProvider implements AIProvider {
  readonly name = 'openai'
  readonly model = env.aiModel

  private async send(body: Record<string, unknown>): Promise<{ text: string; usage: AIUsage }> {
    let res: Response
    try {
      res = await fetch(`${env.aiBaseUrl}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.aiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.AI_TIMEOUT_MS)
      })
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') throw new AppError(504, 'AI_TIMEOUT', 'The AI provider timed out.')
      throw unavailable('Could not reach the AI provider.', 'AI_UNREACHABLE')
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw unavailable('AI provider credentials are invalid.', 'AI_MISCONFIGURED')
      if (res.status === 429) throw new AppError(429, 'AI_RATE_LIMITED', 'The AI provider is busy. Try again shortly.')
      if (res.status === 400 || res.status === 404) throw new AppError(502, 'AI_BAD_REQUEST', `The AI provider rejected the request (${res.status}). Check AI_MODEL.`)
      throw new AppError(502, 'AI_PROVIDER_ERROR', `AI provider error (${res.status}).`)
    }
    const data = (await res.json()) as ResponsesReply
    if (data.status === 'incomplete') {
      throw new AppError(502, 'AI_TRUNCATED', data.incomplete_details?.reason === 'max_output_tokens' ? 'The AI response was cut off. Try a shorter request.' : 'The AI response was incomplete.')
    }
    if (data.status === 'failed') throw new AppError(502, 'AI_PROVIDER_ERROR', data.error?.message ?? 'The AI request failed.')
    const parts = (data.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
    if (parts.some((p) => p.type === 'refusal')) throw new AppError(422, 'AI_REFUSED', 'The AI model declined this request.')
    const text = parts
      .filter((p) => p.type === 'output_text')
      .map((p) => p.text ?? '')
      .join('')
    return { text, usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 } }
  }

  private base(opts: CallOptions) {
    return {
      model: opts.model ?? this.model,
      max_output_tokens: Math.min(opts.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS, env.AI_MAX_OUTPUT_TOKENS),
      reasoning: { effort: opts.effort ?? env.AI_EFFORT }
    }
  }

  async generateJson<T>(req: AIJsonRequest<T>) {
    const { text, usage } = await this.send({
      ...this.base(req),
      instructions: req.system,
      input: req.prompt,
      text: { format: { type: 'json_schema', name: req.schemaName ?? 'result', strict: true, schema: toStrictSchema(req.jsonSchema) } }
    })
    let parsed: unknown
    try {
      parsed = stripNulls(JSON.parse(text))
    } catch {
      throw new AppError(502, 'AI_INVALID_OUTPUT', 'The AI returned malformed data.')
    }
    const result = req.validate.safeParse(parsed)
    if (!result.success) throw new AppError(502, 'AI_INVALID_OUTPUT', 'The AI returned data in an unexpected shape.')
    return { data: result.data, usage }
  }

  async generateText(req: AITextRequest) {
    const { text, usage } = await this.send({
      ...this.base(req),
      instructions: req.system,
      input: req.messages.map((m) => ({ role: m.role, content: m.content }))
    })
    return { text: text.trim(), usage }
  }
}

const provider: AIProvider | null = env.aiEnabled ? new OpenAIProvider() : null

export const getAIProvider = () => provider
