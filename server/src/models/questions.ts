import mongoose, { Schema } from 'mongoose'

export const QUESTION_TYPES = ['single_correct', 'multiple_correct', 'numeric', 'true_false', 'unknown'] as const
export const QUESTION_STATUSES = ['extracted', 'needs_review', 'verified', 'rejected'] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'unknown'] as const

const optionSchema = new Schema({ label: { type: String, required: true }, text: { type: String, required: true } }, { _id: false })

const questionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    origin: { type: String, enum: ['pdf', 'manual', 'ai_generated'], required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'UploadedDocument', default: null },
    source: {
      documentId: { type: Schema.Types.ObjectId, default: null },
      pageNumber: { type: Number, default: null },
      questionNumber: { type: String, default: null }
    },
    /** Exactly what the extractor read from the PDF — never overwritten by edits or AI. */
    rawText: { type: String, default: '' },
    questionText: { type: String, required: true, maxlength: 8000 },
    questionType: { type: String, enum: QUESTION_TYPES, default: 'single_correct' },
    options: { type: [optionSchema], default: [] },
    /** Option labels (or a numeric value). null = unknown; never inferred by AI. */
    correctAnswer: { type: [String], default: null },
    answerSource: { type: String, enum: ['document_key', 'student', 'ai_generated', null], default: null },
    explanation: { type: String, default: null, maxlength: 8000 },
    subjectId: { type: String, default: null },
    subjectName: { type: String, default: null },
    chapterId: { type: String, default: null },
    chapterName: { type: String, default: null },
    topicId: { type: String, default: null },
    topicName: { type: String, default: null },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'unknown' },
    status: { type: String, enum: QUESTION_STATUSES, default: 'extracted' },
    extractionConfidence: { type: Number, default: 0, min: 0, max: 1 },
    flags: { type: [String], default: [] },
    /** AI structured output kept separately from the student-visible record. */
    aiStructured: { type: Schema.Types.Mixed, default: null },
    /** sha256 of normalized question text + options. Prevents duplicates per owner. */
    contentHash: { type: String, required: true },
    verifiedAt: { type: Date, default: null }
  },
  { timestamps: true, minimize: false }
)
questionSchema.index({ userId: 1, contentHash: 1 }, { unique: true })
questionSchema.index({ userId: 1, status: 1, subjectId: 1, chapterId: 1, topicId: 1 })
questionSchema.index({ userId: 1, documentId: 1, 'source.pageNumber': 1 })
export const Question = mongoose.model('Question', questionSchema)
