import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { badRequest } from './errors.js'

export interface ValidationIssue {
  path: string
  message: string
}

export function formatIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
}

/** Parse `value` with `schema` or throw a 400 with field-level issues. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = formatIssues(result.error)
    throw badRequest(issues[0]?.message ?? 'Invalid request', { issues }, 'VALIDATION_ERROR')
  }
  return result.data
}

/** Express middleware form — replaces req.body with the parsed (stripped) data. */
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parse(schema, req.body)
      next()
    } catch (err) {
      next(err)
    }
  }
}

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id')
