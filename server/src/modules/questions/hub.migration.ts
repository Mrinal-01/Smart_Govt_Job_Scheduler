import type { Types } from 'mongoose'
import { logger } from '../../lib/logger.js'
import { MockTest, MockTestAttempt, Question, taxonomyKey } from '../../models/index.js'

/*
 * One-time, idempotent upgrade from per-student question banks to the central hub:
 *  1. drop indexes of the old per-owner model (userId+contentHash unique, etc.);
 *  2. uploadedBy ← userId; subject/chapter/topic keys from names; old statuses → hub statuses
 *     (verified+answer → ready; other answered → needs_review; no answer → pending_answer;
 *     rejected stays rejected); answerSource 'ai_generated' → 'ai';
 *  3. merge duplicate contentHash records (keep the one with the best answer) and repoint
 *     mock tests, attempts' question references stay as they are (snapshots);
 *  4. build the new indexes (unique hub contentHash).
 * Safe to run any number of times.
 */

const OBSOLETE_INDEXES = ['userId_1_contentHash_1', 'userId_1_status_1_subjectId_1_chapterId_1_topicId_1', 'userId_1_documentId_1_source.pageNumber_1']
const ANSWER_RANK: Record<string, number> = { document_key: 3, student: 2, ai: 1 }

type Raw = {
  _id: Types.ObjectId
  userId?: Types.ObjectId
  uploadedBy?: Types.ObjectId | null
  status?: string
  correctAnswer?: string[] | null
  answerSource?: string | null
  subjectName?: string | null
  chapterName?: string | null
  topicName?: string | null
  subjectKey?: string | null
  contentHash: string
  documentId?: Types.ObjectId | null
  createdAt?: Date
}

const hasAnswer = (q: Raw) => Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0

export async function migrateQuestionHub() {
  const coll = Question.collection
  const report = { droppedIndexes: [] as string[], updated: 0, merged: 0, repointedTests: 0 }

  const existing = await coll.indexes().catch(() => [] as Array<{ name?: string }>)
  for (const idx of existing) {
    if (idx.name && OBSOLETE_INDEXES.includes(idx.name)) {
      await coll.dropIndex(idx.name)
      report.droppedIndexes.push(idx.name)
    }
  }

  // 2. per-document field mapping (only documents still in the old shape)
  const legacy = (await coll.find({ $or: [{ userId: { $exists: true } }, { status: { $in: ['verified', 'extracted'] } }, { answerSource: 'ai_generated' }] }).toArray()) as unknown as Raw[]
  for (const q of legacy) {
    const answered = hasAnswer(q)
    const status = q.status === 'rejected' ? 'rejected' : q.status === 'verified' && answered && q.subjectName ? 'ready' : answered ? 'needs_review' : 'pending_answer'
    await coll.updateOne(
      { _id: q._id },
      {
        $set: {
          uploadedBy: q.uploadedBy ?? q.userId ?? null,
          status,
          answerSource: q.answerSource === 'ai_generated' ? 'ai' : (q.answerSource ?? null),
          subjectKey: taxonomyKey(q.subjectName),
          chapterKey: taxonomyKey(q.chapterName),
          topicKey: taxonomyKey(q.topicName)
        },
        $unset: { userId: '', subjectId: '', chapterId: '', topicId: '', verifiedAt: '' }
      }
    )
    report.updated += 1
  }

  // 3. merge duplicates (previously allowed once per student)
  const dups = await coll.aggregate<{ _id: string; ids: Types.ObjectId[] }>([{ $group: { _id: '$contentHash', ids: { $push: '$_id' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray()
  for (const d of dups) {
    const docs = (await coll.find({ _id: { $in: d.ids } }).toArray()) as unknown as Raw[]
    docs.sort(
      (a, b) =>
        Number(b.status === 'ready') - Number(a.status === 'ready') ||
        (ANSWER_RANK[b.answerSource ?? ''] ?? 0) - (ANSWER_RANK[a.answerSource ?? ''] ?? 0) ||
        Number(hasAnswer(b)) - Number(hasAnswer(a)) ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
    )
    const [keep, ...drop] = docs
    const dropIds = drop.map((x) => x._id)
    const tests = await MockTest.find({ questionIds: { $in: dropIds } }).select('questionIds').lean()
    for (const t of tests) {
      const ids = t.questionIds.map((id) => (dropIds.some((x) => String(x) === String(id)) ? keep._id : id))
      const unique = ids.filter((id, i) => ids.findIndex((x) => String(x) === String(id)) === i)
      await MockTest.updateOne({ _id: t._id }, { $set: { questionIds: unique } })
      report.repointedTests += 1
    }
    const otherDocs = drop.map((x) => x.documentId).filter(Boolean)
    if (otherDocs.length) await coll.updateOne({ _id: keep._id }, { $addToSet: { alsoInDocuments: { $each: otherDocs } } })
    await coll.deleteMany({ _id: { $in: dropIds } })
    report.merged += dropIds.length
  }

  // 4. new indexes (unique global content hash, selection, AI queue)
  await Question.syncIndexes()
  await MockTestAttempt.init()
  logger.info(report, 'Question hub migration finished')
  return report
}
