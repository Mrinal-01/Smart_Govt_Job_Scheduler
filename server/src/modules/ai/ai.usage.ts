import type { Types } from 'mongoose'
import { env } from '../../config/env.js'
import { dateKey } from '../../lib/dates.js'
import { AppError, tooMany, unavailable } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { getAIProvider, type AIProvider, type AIUsage } from '../../integrations/ai.js'
import { AIUsageLog } from '../../models/index.js'
import { getSettings } from '../settings/settings.service.js'

export async function aiUsageToday(userId: Types.ObjectId) {
  const used = await AIUsageLog.countDocuments({ userId, date: dateKey() })
  return { used, limit: env.AI_DAILY_REQUEST_LIMIT, remaining: Math.max(0, env.AI_DAILY_REQUEST_LIMIT - used) }
}

/** Returns the provider if AI may be used for this user right now, else throws a clear error. */
export async function requireAI(userId: Types.ObjectId): Promise<AIProvider> {
  const provider = getAIProvider()
  if (!provider) throw unavailable('AI features are not configured on this server (set AI_PROVIDER and an API key).', 'AI_NOT_CONFIGURED')
  const settings = await getSettings(userId)
  if (settings.ai?.enabled === false) throw new AppError(403, 'AI_DISABLED_BY_USER', 'AI features are turned off in your settings.')
  const usage = await aiUsageToday(userId)
  if (usage.remaining <= 0) throw tooMany(`Daily AI limit reached (${usage.limit} requests). It resets at midnight.`, 'AI_DAILY_LIMIT', usage)
  return provider
}

/**
 * Wraps one AI call with limit checks and usage logging. Only metadata is
 * logged (feature, model, token counts, latency) — never prompts or outputs.
 */
export async function runAI<T extends { usage: AIUsage }>(
  userId: Types.ObjectId,
  feature: string,
  call: (provider: AIProvider) => Promise<T>
): Promise<T> {
  const provider = await requireAI(userId)
  const started = Date.now()
  try {
    const result = await call(provider)
    await AIUsageLog.create({
      userId,
      date: dateKey(),
      feature,
      provider: provider.name,
      model: provider.model,
      status: 'success',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - started
    })
    return result
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'AI_ERROR'
    await AIUsageLog.create({ userId, date: dateKey(), feature, provider: provider.name, model: provider.model, status: 'error', latencyMs: Date.now() - started, errorCode: code })
    logger.warn({ feature, code }, 'AI call failed')
    throw err
  }
}

/**
 * Background AI work that is not a student's own request (answering questions in the shared
 * question hub). Counted against AI_BACKGROUND_DAILY_LIMIT, never against a student's limit.
 * Returns null when AI is not configured so callers can retry later.
 */
export async function runSystemAI<T extends { usage: AIUsage }>(feature: string, call: (provider: AIProvider) => Promise<T>): Promise<T | null> {
  const provider = getAIProvider()
  if (!provider) return null
  const used = await AIUsageLog.countDocuments({ userId: null, date: dateKey() })
  if (used >= env.AI_BACKGROUND_DAILY_LIMIT) throw tooMany('Background AI limit reached for today.', 'AI_BACKGROUND_LIMIT')
  const started = Date.now()
  try {
    const result = await call(provider)
    await AIUsageLog.create({ userId: null, date: dateKey(), feature, provider: provider.name, model: provider.model, status: 'success', inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, latencyMs: Date.now() - started })
    return result
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'AI_ERROR'
    await AIUsageLog.create({ userId: null, date: dateKey(), feature, provider: provider.name, model: provider.model, status: 'error', latencyMs: Date.now() - started, errorCode: code })
    logger.warn({ feature, code }, 'Background AI call failed')
    throw err
  }
}
