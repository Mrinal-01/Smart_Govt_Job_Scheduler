import type { NextFunction, Request, RequestHandler, Response } from 'express'

export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') => new AppError(400, code, message, details)
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, code, message)
export const forbidden = (message = 'You do not have access to this resource', code = 'FORBIDDEN') => new AppError(403, code, message)
/** Ownership failures deliberately return 404 so resource existence is not leaked. */
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`)
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) => new AppError(409, code, message, details)
export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) => new AppError(422, code, message, details)
export const tooMany = (message: string, code = 'RATE_LIMITED', details?: unknown) => new AppError(429, code, message, details)
export const unavailable = (message: string, code = 'SERVICE_UNAVAILABLE', details?: unknown) => new AppError(503, code, message, details)

/** Wraps an async route handler so rejections reach the error middleware. */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req as T, res, next).catch(next)
  }
}
