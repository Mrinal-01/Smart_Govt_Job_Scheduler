import { Router } from 'express'
import multer from 'multer'
import { Types } from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { sha256 } from '../../lib/crypto.js'
import { AppError, asyncHandler, badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { MockTest, ProcessingJob, Question, UploadedDocument } from '../../models/index.js'
import { signFileUrl, storage, storageKeyFor, verifyFileSignature } from '../../integrations/storage.js'
import { enqueueDocumentJob } from '../../jobs/queue.js'
import { loadCurriculum } from '../workspace/curriculum.service.js'
import { countPages, PdfError } from './extraction/pdfText.js'

export const documentRouter = Router()
export const fileRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(new AppError(415, 'UNSUPPORTED_FILE', 'Only PDF files can be uploaded.'))
    }
    cb(null, true)
  }
})

const MOCK_TYPES = ['full_mixed', 'sectional', 'subject_full', 'chapter', 'topic'] as const

function serialize(doc: Record<string, unknown>) {
  const { storageKey: _s, sha256: _h, ...rest } = doc
  return rest
}

documentRouter.use(requireAuth)

documentRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const file = req.file
    if (!file) throw badRequest('Attach a PDF file in the "file" field.')
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(415, 'UNSUPPORTED_FILE', 'This file is not a valid PDF.')

    const intent = parse(
      z.object({
        mockType: z.enum(MOCK_TYPES).optional(),
        subjectIds: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : []))
      }),
      req.body
    )
    // The hub files questions by subject, so the uploader says which subject(s) the PDF covers.
    if (!intent.subjectIds.length) throw unprocessable('Choose the subject(s) this question paper covers.', 'SUBJECT_REQUIRED')
    const cur = await loadCurriculum(userId)
    for (const id of intent.subjectIds) if (!cur.subject(id)) throw unprocessable('Unknown subject selected', 'UNKNOWN_SUBJECT')
    const subjectNames = intent.subjectIds.map((id) => cur.subject(id)!.name)

    const hash = sha256(file.buffer)
    const existing = await UploadedDocument.findOne({ userId, sha256: hash }).lean()
    if (existing) {
      return res.status(200).json({ document: serialize(existing), duplicate: true, message: 'You already uploaded this PDF. Showing the existing document.' })
    }

    let pageCount: number
    try {
      pageCount = await countPages(file.buffer)
    } catch (err) {
      if (err instanceof PdfError) throw unprocessable(err.message, err.code)
      throw err
    }
    if (pageCount > env.MAX_PDF_PAGES) throw unprocessable(`PDF has ${pageCount} pages; the limit is ${env.MAX_PDF_PAGES}.`, 'PDF_TOO_MANY_PAGES')

    const id = new Types.ObjectId()
    const storageKey = storageKeyFor(String(userId), String(id))
    await storage.put(storageKey, file.buffer)
    let doc
    try {
      doc = await UploadedDocument.create({
        _id: id,
        userId,
        originalName: file.originalname.replace(/[^\w.\- ()]+/g, '_').slice(0, 200) || 'document.pdf',
        storageKey,
        sizeBytes: file.size,
        sha256: hash,
        pageCount,
        intent: { mockType: intent.mockType ?? null, subjectIds: intent.subjectIds, subjectNames }
      })
    } catch (err) {
      await storage.remove(storageKey)
      if ((err as { code?: number }).code === 11000) throw conflict('This PDF was uploaded at the same time already.', 'DUPLICATE_DOCUMENT')
      throw err
    }
    await enqueueDocumentJob(userId, doc._id)
    const fresh = await UploadedDocument.findById(doc._id).lean()
    res.status(201).json({ document: serialize(fresh!), duplicate: false })
  })
)

documentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const docs = await UploadedDocument.find({ userId }).sort({ createdAt: -1 }).limit(100).lean()
    res.json({ documents: docs.map(serialize) })
  })
)

async function ownedDoc(userId: Types.ObjectId, id: unknown) {
  const doc = await UploadedDocument.findOne({ _id: parse(objectId, id), userId })
  if (!doc) throw notFound('Document')
  return doc
}

documentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const doc = await ownedDoc(userId, req.params.id)
    const counts = await Question.aggregate([
      { $match: { $or: [{ documentId: doc._id }, { alsoInDocuments: doc._id }] } },
      { $group: { _id: '$status', n: { $sum: 1 } } }
    ])
    res.json({ document: serialize(doc.toObject()), questionCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])) })
  })
)

documentRouter.post(
  '/:id/reprocess',
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const doc = await ownedDoc(userId, req.params.id)
    if (['queued', 'processing'].includes(doc.status)) throw conflict('This document is already being processed.', 'ALREADY_PROCESSING')
    await ProcessingJob.deleteMany({ documentId: doc._id, status: { $in: ['queued', 'failed'] } })
    await enqueueDocumentJob(userId, doc._id)
    res.status(202).json({ document: serialize((await UploadedDocument.findById(doc._id).lean())!) })
  })
)

documentRouter.post(
  '/:id/file-url',
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const doc = await ownedDoc(userId, req.params.id)
    res.json(signFileUrl(String(doc._id), String(doc.userId)))
  })
)

/**
 * Deletes the stored PDF. Its questions that are not ready (and not used in any test) are
 * removed from the hub; ready questions stay — other students may already rely on them.
 */
documentRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const doc = await ownedDoc(userId, req.params.id)
    if (['queued', 'processing'].includes(doc.status)) throw conflict('Wait for processing to finish before deleting.', 'ALREADY_PROCESSING')
    const candidates = await Question.find({ uploadedBy: userId, documentId: doc._id, status: { $ne: 'ready' } }).select('_id').lean()
    const used = new Set((await MockTest.find({ questionIds: { $in: candidates.map((c) => c._id) } }).select('questionIds').lean()).flatMap((t) => t.questionIds.map(String)))
    const removable = candidates.filter((c) => !used.has(String(c._id))).map((c) => c._id)
    const removed = await Question.deleteMany({ _id: { $in: removable } })
    await Question.updateMany({ alsoInDocuments: doc._id }, { $pull: { alsoInDocuments: doc._id } })
    await ProcessingJob.deleteMany({ documentId: doc._id })
    await storage.remove(doc.storageKey)
    await UploadedDocument.deleteOne({ _id: doc._id })
    res.json({ deletedQuestions: removed.deletedCount })
  })
)

/* ------------------------------------------------------------------ */
/* Signed, short-lived private file delivery                           */
/* ------------------------------------------------------------------ */

fileRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parse(objectId, req.params.id)
    const q = parse(z.object({ exp: z.coerce.number().int(), sig: z.string().min(10).max(100) }), req.query)
    const doc = await UploadedDocument.findById(id).lean()
    if (!doc || !verifyFileSignature(String(doc._id), String(doc.userId), q.exp, q.sig)) {
      throw new AppError(403, 'INVALID_SIGNATURE', 'This file link is invalid or has expired.')
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName.replace(/"/g, '')}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // Only restrict who may frame it; a stricter CSP can stop browsers' built-in PDF viewers.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
    storage.stream(doc.storageKey).on('error', () => res.destroy()).pipe(res)
  })
)
