import type { Types } from 'mongoose'
import { z } from 'zod'
import { AppError, conflict, notFound } from '../../lib/errors.js'
import { StudyWorkspace } from '../../models/index.js'

/** Mirrors STATE_VERSION in src/data/seed.ts (client). */
export const SUPPORTED_SCHEMA_VERSIONS = [3]
const MAX_BYTES = 7.5 * 1024 * 1024

/**
 * Structural validation of the legacy StudyState. The client owns the detailed
 * shape; the server guarantees the parts other services depend on.
 */
export const workspaceDataSchema = z.looseObject({
  version: z.number().int(),
  profile: z.looseObject({ name: z.string().max(120) }),
  settings: z.looseObject({ revisionIntervals: z.array(z.number().int().min(0).max(400)).max(20) }),
  subjects: z.array(z.looseObject({ id: z.string().min(1).max(120), name: z.string().min(1).max(120) })).max(50),
  chapters: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(160),
        subjectId: z.string().min(1).max(120),
        name: z.string().min(1).max(200),
        topics: z.array(z.looseObject({ id: z.string().min(1).max(240), name: z.string().min(1).max(240), chapterId: z.string(), subjectId: z.string() })).max(500)
      })
    )
    .max(1000),
  schedule: z.array(z.looseObject({ id: z.string(), weekday: z.number().int().min(0).max(6), subjectId: z.string() })).max(500),
  sessions: z.record(z.string(), z.unknown()),
  logs: z.array(z.unknown()).max(5000),
  mistakes: z.array(z.unknown()).max(20000),
  questions: z.array(z.unknown()).max(20000),
  mockTests: z.array(z.unknown()).max(2000),
  attempts: z.array(z.unknown()).max(5000),
  aiMessages: z.array(z.unknown()).max(5000)
})

export type WorkspaceData = z.infer<typeof workspaceDataSchema>

function measure(data: unknown) {
  const size = Buffer.byteLength(JSON.stringify(data))
  if (size > MAX_BYTES) throw new AppError(413, 'WORKSPACE_TOO_LARGE', 'Your study workspace is too large to sync. Export a backup and trim old history.')
  return size
}

function assertVersion(v: number) {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(v)) {
    throw new AppError(422, 'WORKSPACE_VERSION_UNSUPPORTED', `Workspace schema version ${v} is not supported by this server.`)
  }
}

export async function getWorkspace(userId: Types.ObjectId) {
  const ws = await StudyWorkspace.findOne({ userId }).lean()
  if (!ws) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'No workspace yet')
  return { revision: ws.revision, schemaVersion: ws.schemaVersion, origin: ws.origin, updatedAt: ws.updatedAt, data: ws.data }
}

export async function createWorkspace(userId: Types.ObjectId, origin: 'import' | 'demo' | 'fresh', data: WorkspaceData) {
  assertVersion(data.version)
  const sizeBytes = measure(data)
  try {
    const ws = await StudyWorkspace.create({ userId, origin, schemaVersion: data.version, data, sizeBytes, revision: 1 })
    return { revision: ws.revision, schemaVersion: ws.schemaVersion, origin: ws.origin, updatedAt: ws.updatedAt }
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('A workspace already exists for this account.', 'WORKSPACE_EXISTS')
    throw err
  }
}

/** Optimistic concurrency: the write only applies if the client saw the latest revision. */
export async function saveWorkspace(userId: Types.ObjectId, baseRevision: number, data: WorkspaceData) {
  assertVersion(data.version)
  const sizeBytes = measure(data)
  const updated = await StudyWorkspace.findOneAndUpdate(
    { userId, revision: baseRevision },
    { $set: { data, schemaVersion: data.version, sizeBytes }, $inc: { revision: 1 } },
    { new: true, projection: { revision: 1, updatedAt: 1 } }
  ).lean()
  if (!updated) {
    const current = await StudyWorkspace.findOne({ userId }).select('revision').lean()
    if (!current) throw notFound('Workspace')
    throw conflict('Your data changed in another tab or device. Reload to get the latest version.', 'WORKSPACE_CONFLICT', {
      currentRevision: current.revision
    })
  }
  return { revision: updated.revision, updatedAt: updated.updatedAt }
}

export async function deleteWorkspace(userId: Types.ObjectId) {
  await StudyWorkspace.deleteOne({ userId })
}
