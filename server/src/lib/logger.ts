import pino from 'pino'
import { env } from '../config/env.js'

/**
 * Structured logger. Sensitive fields are redacted at the serializer level so
 * passwords, tokens and cookies never reach log sinks.
 */
export const logger = pino({
  level: env.LOG_LEVEL ?? (env.isProd ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.token',
      '*.refreshToken',
      '*.idToken',
      '*.credential',
      '*.apiKey'
    ],
    censor: '[redacted]'
  },
  transport:
    !env.isProd
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined
})
