import 'dotenv/config'
import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number.parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: int(4000, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/studyos'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool(false),
  SERVE_CLIENT_DIST: z.string().optional(),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),

  JWT_ACCESS_SECRET: z.string().optional(),
  FILE_SIGNING_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL_SECONDS: int(900, 60, 3600),
  REFRESH_TOKEN_TTL_DAYS: int(30, 1, 180),
  COOKIE_SECURE: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),


  STORAGE_DIR: z.string().default('./storage/private'),
  MAX_UPLOAD_MB: int(20, 1, 200),
  MAX_PDF_PAGES: int(200, 1, 2000),
  OCR_PROVIDER: z.enum(['auto', 'tesseract', 'none']).default('auto'),
  OCR_LANG: z.string().default('eng'),

  /* AI (OpenAI Responses API). Leave AI_PROVIDER=none until you have a key. */
  AI_PROVIDER: z.enum(['none', 'openai']).default('none'),
  OPENAI_API_KEY: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  /** Model for the study assistant and explanations. */
  AI_MODEL: z.string().optional(),
  /** Model that works out answers for uploaded questions without an answer key. */
  AI_ANSWER_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_TIMEOUT_MS: int(120000, 1000, 600000),
  /** Per-student requests per day (assistant, explanations). */
  AI_DAILY_REQUEST_LIMIT: int(40, 0, 100000),
  /** Server-wide background calls per day (answering uploaded questions). */
  AI_BACKGROUND_DAILY_LIMIT: int(2000, 0, 1000000),
  AI_MAX_OUTPUT_TOKENS: int(8000, 256, 32000),
  AI_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_ANSWER_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('high'),

  /* Phone + OTP authentication */
  PHONE_ALLOWED_COUNTRY_CODES: z.string().default('91'),
  OTP_SECRET: z.string().optional(),
  SMS_DRIVER: z.enum(['console', 'twilio', 'disabled']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  SCHEDULE_MAX_CHANGES: int(3, 0, 100),
  SCHEDULE_WINDOW_DAYS: int(7, 1, 90)
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.issues)
  process.exit(1)
}
const raw = parsed.data

function secret(name: string, value: string | undefined): string {
  if (value && value.length >= 32) return value
  if (raw.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error(`${name} must be set to at least 32 characters in production.`)
    process.exit(1)
  }
  if (value) return value.padEnd(32, '_')
  // Development/test: an ephemeral secret. Access tokens and signed file URLs
  // stop working after a restart; refresh sessions (stored server-side) do not.
  return crypto.randomBytes(48).toString('hex')
}

const aiKey = raw.OPENAI_API_KEY || raw.AI_API_KEY

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: secret('JWT_ACCESS_SECRET', raw.JWT_ACCESS_SECRET),
  fileSigningSecret: secret('FILE_SIGNING_SECRET', raw.FILE_SIGNING_SECRET),
  otpSecret: secret('OTP_SECRET', raw.OTP_SECRET),
  phoneCountryCodes: raw.PHONE_ALLOWED_COUNTRY_CODES.split(',')
    .map((s) => s.trim().replace(/^\+/, ''))
    .filter((s) => /^[1-9]\d{0,2}$/.test(s)),
  cookieSecure: raw.COOKIE_SECURE === undefined ? raw.NODE_ENV === 'production' : raw.COOKIE_SECURE === 'true',
  storageDir: path.resolve(raw.STORAGE_DIR),
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  aiApiKey: aiKey,
  // Defaults follow OpenAI's model-selection guide: GPT-6.2 Sol for most workflows.
  aiModel: raw.AI_MODEL || 'gpt-6.2-sol',
  aiAnswerModel: raw.AI_ANSWER_MODEL || raw.AI_MODEL || 'gpt-6.2-sol',
  aiBaseUrl: (raw.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  aiEnabled: raw.AI_PROVIDER === 'openai' && Boolean(aiKey)
}

export type Env = typeof env
