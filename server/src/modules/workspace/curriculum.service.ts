import type { Types } from 'mongoose'
import { AppError, unprocessable } from '../../lib/errors.js'
import { StudyWorkspace } from '../../models/index.js'

export interface CurriculumTopic {
  id: string
  name: string
  chapterId: string
  subjectId: string
  formulas: string[]
  keyPoints: string[]
}
export interface CurriculumChapter {
  id: string
  name: string
  subjectId: string
  topics: CurriculumTopic[]
}
export interface CurriculumSubject {
  id: string
  name: string
}

export interface Curriculum {
  subjects: CurriculumSubject[]
  chapters: CurriculumChapter[]
  subject(id: string): CurriculumSubject | undefined
  chapter(id: string): CurriculumChapter | undefined
  topic(id: string): CurriculumTopic | undefined
}

interface RawWorkspace {
  subjects?: Array<{ id: string; name: string }>
  chapters?: Array<{ id: string; name: string; subjectId: string; topics?: Array<Record<string, unknown>> }>
}

/**
 * The subject → chapter → topic tree lives in the user's workspace. Server
 * engines (cycles, question bank) reference it by id and validate against it,
 * so a client can never attach work to a topic it does not own.
 */
export async function loadCurriculum(userId: Types.ObjectId): Promise<Curriculum> {
  const ws = await StudyWorkspace.findOne({ userId }).select('data.subjects data.chapters').lean()
  if (!ws) throw new AppError(409, 'WORKSPACE_REQUIRED', 'Set up your study workspace first.')
  const data = (ws.data ?? {}) as RawWorkspace
  const subjects = (data.subjects ?? []).map((s) => ({ id: String(s.id), name: String(s.name) }))
  const chapters: CurriculumChapter[] = (data.chapters ?? []).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    subjectId: String(c.subjectId),
    topics: (c.topics ?? []).map((t) => ({
      id: String(t.id),
      name: String(t.name),
      chapterId: String(c.id),
      subjectId: String(c.subjectId),
      formulas: Array.isArray(t.formulas) ? (t.formulas as unknown[]).map(String).slice(0, 10) : [],
      keyPoints: Array.isArray(t.keyPoints) ? (t.keyPoints as unknown[]).map(String).slice(0, 10) : []
    }))
  }))
  const subjectMap = new Map(subjects.map((s) => [s.id, s]))
  const chapterMap = new Map(chapters.map((c) => [c.id, c]))
  const topicMap = new Map(chapters.flatMap((c) => c.topics.map((t) => [t.id, t] as const)))
  return {
    subjects,
    chapters,
    subject: (id) => subjectMap.get(id),
    chapter: (id) => chapterMap.get(id),
    topic: (id) => topicMap.get(id)
  }
}

/** Resolve and cross-check an optional subject/chapter/topic triple. Returns names for denormalized storage. */
export function resolveTaxonomy(
  cur: Curriculum,
  input: { subjectId?: string | null; chapterId?: string | null; topicId?: string | null }
) {
  const out = {
    subjectId: null as string | null,
    subjectName: null as string | null,
    chapterId: null as string | null,
    chapterName: null as string | null,
    topicId: null as string | null,
    topicName: null as string | null
  }
  if (input.topicId) {
    const topic = cur.topic(input.topicId)
    if (!topic) throw unprocessable('Unknown topic', 'UNKNOWN_TOPIC')
    input = { subjectId: input.subjectId ?? topic.subjectId, chapterId: input.chapterId ?? topic.chapterId, topicId: topic.id }
    if (input.chapterId !== topic.chapterId) throw unprocessable('Topic does not belong to the selected chapter', 'TAXONOMY_MISMATCH')
    out.topicId = topic.id
    out.topicName = topic.name
  }
  if (input.chapterId) {
    const chapter = cur.chapter(input.chapterId)
    if (!chapter) throw unprocessable('Unknown chapter', 'UNKNOWN_CHAPTER')
    if (input.subjectId && input.subjectId !== chapter.subjectId) throw unprocessable('Chapter does not belong to the selected subject', 'TAXONOMY_MISMATCH')
    input = { ...input, subjectId: chapter.subjectId }
    out.chapterId = chapter.id
    out.chapterName = chapter.name
  }
  if (input.subjectId) {
    const subject = cur.subject(input.subjectId)
    if (!subject) throw unprocessable('Unknown subject', 'UNKNOWN_SUBJECT')
    out.subjectId = subject.id
    out.subjectName = subject.name
  }
  return out
}
