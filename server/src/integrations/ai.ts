import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'
import { env } from '../config/env.js'
import { AppError, unavailable } from '../lib/errors.js'

/*
 * AI provider abstraction. Only the server talks to the model; the API key
 * never leaves the backend. Providers return text/JSON plus token usage so the
 * caller can enforce limits and log cost metadata (never content).
 */

export interface AIUsage {
  inputTokens: number
  outputTokens: number
}

export interface AIJsonRequest<T> {
  system: string
  prompt: string
  /** JSON Schema sent to the model as a structured-output constraint. */
  jsonSchema: Record<string, unknown>
  /** Re-validated locally — the model's output is never trusted blindly. */
  validate: z.ZodType<T>
  maxTokens?: number
}

export interface AITextRequest {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens?: number
}

export interface AIProvider {
  name: string
  model: string
  generateJson<T>(req: AIJsonRequest<T>): Promise<{ data: T; usage: AIUsage }>
  generateText(req: AITextRequest): Promise<{ text: string; usage: AIUsage }>
}

function usageOf(message: { usage?: { input_tokens?: number; output_tokens?: number } }): AIUsage {
  return { inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 }
}

function textOf(content: Array<{ type: string }>): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  readonly model = env.aiModel
  private client = new Anthropic({
    apiKey: env.aiApiKey,
    baseURL: env.AI_BASE_URL || undefined,
    timeout: env.AI_TIMEOUT_MS,
    maxRetries: 1
  })

  private async send(params: {
    system: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    maxTokens?: number
    jsonSchema?: Record<string, unknown>
  }) {
    try {
      const message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: Math.min(params.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS, env.AI_MAX_OUTPUT_TOKENS),
        system: params.system,
        messages: params.messages,
        output_config: {
          effort: env.AI_EFFORT,
          ...(params.jsonSchema ? { format: { type: 'json_schema' as const, schema: params.jsonSchema } } : {})
        },
        // Server-side fallback: if the primary model declines on policy grounds,
        // the API retries on a suitable model within the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      })
      if (message.stop_reason === 'refusal') {
        throw new AppError(422, 'AI_REFUSED', 'The AI model declined this request.')
      }
      if (message.stop_reason === 'max_tokens') {
        throw new AppError(502, 'AI_TRUNCATED', 'The AI response was too long and was cut off. Try a smaller request.')
      }
      return message
    } catch (err) {
      if (err instanceof AppError) throw err
      if (err instanceof Anthropic.RateLimitError) throw new AppError(429, 'AI_RATE_LIMITED', 'The AI provider is busy. Try again shortly.')
      if (err instanceof Anthropic.AuthenticationError) throw unavailable('AI provider credentials are invalid.', 'AI_MISCONFIGURED')
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AppError(504, 'AI_TIMEOUT', 'The AI provider timed out.')
      if (err instanceof Anthropic.APIConnectionError) throw unavailable('Could not reach the AI provider.', 'AI_UNREACHABLE')
      if (err instanceof Anthropic.APIError) throw new AppError(502, 'AI_PROVIDER_ERROR', `AI provider error (${err.status ?? 'unknown'}).`)
      throw err
    }
  }

  async generateJson<T>(req: AIJsonRequest<T>) {
    const message = await this.send({ system: req.system, messages: [{ role: 'user', content: req.prompt }], maxTokens: req.maxTokens, jsonSchema: req.jsonSchema })
    let parsed: unknown
    try {
      parsed = JSON.parse(textOf(message.content))
    } catch {
      throw new AppError(502, 'AI_INVALID_OUTPUT', 'The AI returned malformed data.')
    }
    const result = req.validate.safeParse(parsed)
    if (!result.success) throw new AppError(502, 'AI_INVALID_OUTPUT', 'The AI returned data in an unexpected shape.')
    return { data: result.data, usage: usageOf(message) }
  }

  async generateText(req: AITextRequest) {
    const message = await this.send(req)
    return { text: textOf(message.content).trim(), usage: usageOf(message) }
  }
}

const provider: AIProvider | null = env.aiEnabled ? new AnthropicProvider() : null

export const getAIProvider = () => provider
