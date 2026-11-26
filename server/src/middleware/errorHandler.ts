import type { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}` } })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message)
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `File is larger than the ${env.MAX_UPLOAD_MB} MB limit.` : `Upload rejected: ${err.message}`
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: `UPLOAD_${err.code}`, message } })
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const issues = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }))
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: issues[0]?.message ?? 'Invalid data', details: { issues } } })
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } })
  }
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists.' } })
  }
  const e = err as { type?: string; status?: number }
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } })
  }
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body.' } })
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error')
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
}
