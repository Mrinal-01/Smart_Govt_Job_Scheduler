import mongoose, { Schema } from 'mongoose'

/*
 * Central question hub. Every student's uploads land in ONE shared collection that all
 * students build mock tests from. A question enters a test only when it is `ready`, i.e. it
 * has a trusted answer: from the PDF's answer key, set by its uploader, or worked out by AI
 * with high confidence.
 *
 *   pending_answer  no answer yet — queued for background AI answering
 *   ready           trusted answer, usable in tests
 *   needs_review    unclear extraction, AI unsure/unanswerable, missing subject, or reported wrong
 *   rejected        excluded by its uploader
 */

export const QUESTION_TYPES = ['single_correct', 'multiple_correct', 'numeric', 'true_false', 'unknown'] as const
export const QUESTION_STATUSES = ['pending_answer', 'ready', 'needs_review', 'rejected'] as const
export const ANSWER_SOURCES = ['document_key', 'student', 'ai'] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'unknown'] as const

/** "  Mathematics " → "mathematics". Subjects are matched across students by this key. */
const ALIASES: Record<string, string> = {
  maths: 'mathematics',
  math: 'mathematics',
  'general science': 'science',
  gk: 'general knowledge',
  ga: 'general awareness',
  'current affair': 'current affairs'
}
export function taxonomyKey(name: string | null | undefined): string | null {
  if (!name) return null
  const k = name.trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ')
  return k ? (ALIASES[k] ?? k) : null
}

const optionSchema = new Schema({ label: { type: String, required: true }, text: { type: String, required: true } }, { _id: false })

const questionSchema = new Schema(
  {
    /** Provenance: the student whose upload/edit created it (null for system/seeded questions). */
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    origin: { type: String, enum: ['pdf', 'manual', 'ai_generated'], required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'UploadedDocument', default: null },
    /** Other uploaded PDFs that contained the same question (deduplicated into this record). */
    alsoInDocuments: { type: [Schema.Types.ObjectId], ref: 'UploadedDocument', default: [] },
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
    /** Option labels (or one numeric value). null = not known yet. */
    correctAnswer: { type: [String], default: null },
    answerSource: { type: String, enum: [...ANSWER_SOURCES, null], default: null },
    /** AI answers only: the model's own probability that the answer is right (0–1). */
    answerConfidence: { type: Number, default: null, min: 0, max: 1 },
    /** Why the answer is right (AI or uploader). Separate from the PDF's own explanation. */
    answerExplanation: { type: String, default: null, maxlength: 4000 },
    answerModel: { type: String, default: null },
    answeredAt: { type: Date, default: null },
    /** Explanation printed in the source PDF, if any. */
    explanation: { type: String, default: null, maxlength: 8000 },
    subjectName: { type: String, default: null },
    subjectKey: { type: String, default: null },
    chapterName: { type: String, default: null },
    chapterKey: { type: String, default: null },
    topicName: { type: String, default: null },
    topicKey: { type: String, default: null },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'unknown' },
    status: { type: String, enum: QUESTION_STATUSES, default: 'pending_answer' },
    extractionConfidence: { type: Number, default: 0, min: 0, max: 1 },
    flags: { type: [String], default: [] },
    /** AI structuring output kept separately from the student-visible record. */
    aiStructured: { type: Schema.Types.Mixed, default: null },
    /** Background AI answering state. */
    aiCheck: {
      state: { type: String, enum: ['queued', 'done', 'failed', null], default: null },
      /** true = re-check a reported answer (higher effort, must agree with the stored answer). */
      recheck: { type: Boolean, default: false },
      attempts: { type: Number, default: 0 },
      nextTryAt: { type: Date, default: null },
      note: { type: String, default: null, maxlength: 1000 },
      lastRunAt: { type: Date, default: null }
    },
    /** "This answer is wrong" reports from students who took it in a test. */
    reports: {
      type: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, reason: { type: String, maxlength: 500 }, at: { type: Date, default: () => new Date() }, _id: false }],
      default: []
    },
    /** sha256 of normalized question text + options — unique across the whole hub. */
    contentHash: { type: String, required: true }
  },
  { timestamps: true, minimize: false }
)
questionSchema.index({ contentHash: 1 }, { unique: true, name: 'hub_content_hash' })
questionSchema.index({ status: 1, subjectKey: 1, chapterKey: 1, topicKey: 1 }, { name: 'hub_selection' })
questionSchema.index({ uploadedBy: 1, createdAt: -1 }, { name: 'hub_uploader' })
questionSchema.index({ documentId: 1, 'source.pageNumber': 1 }, { name: 'hub_document' })
questionSchema.index({ alsoInDocuments: 1 }, { name: 'hub_also_in_document' })
questionSchema.index({ status: 1, 'aiCheck.state': 1, 'aiCheck.nextTryAt': 1 }, { name: 'hub_ai_queue' })
export const Question = mongoose.model('Question', questionSchema)
