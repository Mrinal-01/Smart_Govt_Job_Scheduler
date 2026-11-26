import type { ID, StudyState, Topic } from '../types'
import { dateKey, diffDays } from '../lib/date'
import { dueRevisions, recentTopics, subjectById, topicById } from '../store/selectors'

export interface RevisionItem {
  id: string
  kind: 'topic' | 'mistake' | 'note'
  title: string
  meta?: string
  badge?: string
  topicId?: ID
  mistakeId?: ID
}

export interface RevisionPack {
  subjectName: string
  previous: RevisionItem[]
  due: RevisionItem[]
  mistakes: RevisionItem[]
  formulas: Array<{ topicName: string; values: string[] }>
  checklist: RevisionItem[]
  totalTopics: number
}

/**
 * Builds the "Revision Preparation Panel" for a subject.
 * This is the product's most important logic: before new learning, surface
 * everything the student already studied but has not yet consolidated.
 */
export function buildRevisionPack(state: StudyState, subjectId: ID, today = dateKey()): RevisionPack {
  const subject = subjectById(state, subjectId)
  const prevTopics = recentTopics(state, subjectId, 4, today)
  const due = dueRevisions(state, today, subjectId)

  const previous: RevisionItem[] = prevTopics.map((t) => ({
    id: `topic:${t.id}`,
    kind: 'topic',
    title: t.name,
    meta: t.initialLearningDate
      ? `Learnt ${diffDays(today, t.initialLearningDate) === 0 ? 'today' : `${diffDays(today, t.initialLearningDate)} day(s) ago`}`
      : 'Not started',
    badge: `${t.revisions.length} revisions`,
    topicId: t.id
  }))

  const dueItems: RevisionItem[] = due.slice(0, 6).map((d) => ({
    id: `topic:${d.topic.id}`,
    kind: 'topic',
    title: d.topic.name,
    meta: `${d.chapter.name} · ${d.kind} revision`,
    badge: d.daysOverdue > 0 ? `${d.daysOverdue}d overdue` : 'due today',
    topicId: d.topic.id
  }))

  const subjectMistakes = state.mistakes
    .filter((m) => m.subjectId === subjectId && m.status !== 'resolved')
    .slice(0, 4)

  const mistakeItems: RevisionItem[] = subjectMistakes.map((m) => {
    const topic = topicById(state, m.topicId)
    return {
      id: `mistake:${m.id}`,
      kind: 'mistake',
      title: m.question.length > 88 ? `${m.question.slice(0, 88)}…` : m.question,
      meta: `${topic?.name ?? 'Topic'} · ${m.category.replace('-', ' ')}`,
      mistakeId: m.id
    }
  })

  const formulaTopics = [...prevTopics, ...due.slice(0, 3).map((d) => d.topic)]
  const seen = new Set<ID>()
  const formulas: Array<{ topicName: string; values: string[] }> = []
  formulaTopics.forEach((t: Topic) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    const values = [...t.formulas, ...t.keyPoints.slice(0, 2)]
    if (values.length) formulas.push({ topicName: t.name, values })
  })

  const checklistMap = new Map<string, RevisionItem>()
  ;[...dueItems, ...previous].forEach((i) => {
    if (!checklistMap.has(i.id)) checklistMap.set(i.id, i)
  })
  mistakeItems.forEach((i) => checklistMap.set(i.id, i))

  const checklist = Array.from(checklistMap.values())

  return {
    subjectName: subject?.name ?? 'Subject',
    previous,
    due: dueItems,
    mistakes: mistakeItems,
    formulas: formulas.slice(0, 4),
    checklist,
    totalTopics: new Set(checklist.filter((c) => c.kind === 'topic').map((c) => c.topicId)).size
  }
}
