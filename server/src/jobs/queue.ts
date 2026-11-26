import type { Types } from 'mongoose'
import { logger } from '../lib/logger.js'
import { ProcessingJob, UploadedDocument } from '../models/index.js'
import { processDocument } from '../modules/documents/pipeline.js'

/*
 * Durable job queue backed by MongoDB (no Redis required for local/dev).
 * Jobs survive restarts; a stale "running" job is re-queued. The interface
 * (enqueue / worker) mirrors BullMQ so it can be swapped when Redis is added.
 */

const POLL_MS = 1500
const STALE_MS = 10 * 60_000
let timer: NodeJS.Timeout | null = null
let busy = false

export async function enqueueDocumentJob(userId: Types.ObjectId, documentId: Types.ObjectId) {
  await UploadedDocument.updateOne({ _id: documentId }, { $set: { status: 'queued', stage: 'queued', progress: 0, error: null } })
  return ProcessingJob.create({ type: 'process_document', userId, documentId, status: 'queued' })
}

async function claimNext() {
  return ProcessingJob.findOneAndUpdate(
    { status: 'queued', runAfter: { $lte: new Date() } },
    { $set: { status: 'running', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  )
}

async function runJob(job: NonNullable<Awaited<ReturnType<typeof claimNext>>>) {
  try {
    await processDocument(job.documentId)
    await ProcessingJob.updateOne({ _id: job._id }, { $set: { status: 'completed', finishedAt: new Date(), lastError: null } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, jobId: String(job._id) }, 'Document job failed')
    const final = job.attempts >= job.maxAttempts
    await ProcessingJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: final ? 'failed' : 'queued',
          lastError: message.slice(0, 500),
          runAfter: new Date(Date.now() + 5000 * 2 ** job.attempts),
          finishedAt: final ? new Date() : null
        }
      }
    )
    await UploadedDocument.updateOne(
      { _id: job.documentId },
      final
        ? { $set: { status: 'failed', stage: 'failed', error: 'Processing failed. You can try “Reprocess”.' } }
        : { $set: { status: 'queued', stage: `retrying (attempt ${job.attempts + 1})` } }
    )
  }
}

/** Processes every runnable job now (used by tests and the worker tick). */
export async function runPendingJobs(limit = 50) {
  let processed = 0
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNext()
    if (!job) break
    await runJob(job)
    processed += 1
  }
  return processed
}

export function startJobWorker() {
  void ProcessingJob.updateMany(
    { status: 'running', lockedAt: { $lt: new Date(Date.now() - STALE_MS) } },
    { $set: { status: 'queued', lockedAt: null } }
  ).then((r) => r.modifiedCount && logger.warn({ count: r.modifiedCount }, 'Re-queued stale jobs'))
  timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      await runPendingJobs(5)
    } catch (err) {
      logger.error({ err }, 'Job worker tick failed')
    } finally {
      busy = false
    }
  }, POLL_MS)
}

export function stopJobWorker() {
  if (timer) clearInterval(timer)
  timer = null
}
