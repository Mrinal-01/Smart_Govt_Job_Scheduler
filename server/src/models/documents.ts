import mongoose, { Schema } from 'mongoose'

const uploadedDocumentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    /** Path relative to STORAGE_DIR. Never exposed to clients. */
    storageKey: { type: String, required: true },
    mimeType: { type: String, default: 'application/pdf' },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    pageCount: { type: Number, default: 0 },
    intent: {
      mockType: { type: String, default: null },
      /** Subjects chosen at upload (ids in the uploader's curriculum, names for the shared hub). */
      subjectIds: { type: [String], default: [] },
      subjectNames: { type: [String], default: [] }
    },
    status: { type: String, enum: ['uploaded', 'queued', 'processing', 'completed', 'failed'], default: 'uploaded' },
    stage: { type: String, default: 'uploaded' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    error: { type: String, default: null },
    pages: {
      type: [{ pageNumber: Number, method: { type: String, enum: ['text', 'ocr', 'ocr_unavailable', 'empty'] }, chars: Number, _id: false }],
      default: []
    },
    stats: {
      questionsFound: { type: Number, default: 0 },
      inserted: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      needsReview: { type: Number, default: 0 },
      /** Questions with no answer key, handed to background AI answering. */
      pendingAnswer: { type: Number, default: 0 },
      /** Duplicates whose missing answer this PDF's answer key filled in. */
      answersFilled: { type: Number, default: 0 },
      textPages: { type: Number, default: 0 },
      ocrPages: { type: Number, default: 0 },
      ocrUnavailablePages: { type: Number, default: 0 },
      answerKeyFound: { type: Boolean, default: false }
    },
    aiUsed: { type: Boolean, default: false },
    aiNote: { type: String, default: null },
    processedAt: { type: Date, default: null }
  },
  { timestamps: true }
)
/** The same file uploaded twice by the same user maps to one document. */
uploadedDocumentSchema.index({ userId: 1, sha256: 1 }, { unique: true })
uploadedDocumentSchema.index({ userId: 1, createdAt: -1 })
export const UploadedDocument = mongoose.model('UploadedDocument', uploadedDocumentSchema)

/* ------------------------------------------------------------------ */
/* ProcessingJob — Mongo-backed job queue (Redis/BullMQ-compatible API) */
/* ------------------------------------------------------------------ */

const processingJobSchema = new Schema(
  {
    type: { type: String, enum: ['process_document', 'answer_questions'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    documentId: { type: Schema.Types.ObjectId, ref: 'UploadedDocument', default: null },
    /** answer_questions: the hub questions to solve in one AI call. */
    questionIds: { type: [Schema.Types.ObjectId], ref: 'Question', default: [] },
    /** answer_questions: re-check reported answers instead of answering fresh ones. */
    recheck: { type: Boolean, default: false },
    note: { type: String, default: null },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    runAfter: { type: Date, default: () => new Date() },
    lockedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    finishedAt: { type: Date, default: null }
  },
  { timestamps: true }
)
processingJobSchema.index({ status: 1, runAfter: 1 })
processingJobSchema.index({ documentId: 1 })
export const ProcessingJob = mongoose.model('ProcessingJob', processingJobSchema)
