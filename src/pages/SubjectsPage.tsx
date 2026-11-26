import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Calculator,
  ChevronRight,
  FlaskConical,
  GraduationCap,
  Layers,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Target,
  Trash2,
  TrendingUp
} from 'lucide-react'
import type { Chapter, Difficulty, Subject, Topic } from '../types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Tabs,
  Textarea
} from '../components/ui'
import { useStudy } from '../store/StudyStore'
import {
  CHAPTER_STATUS_META,
  chapterAccuracy,
  chapterById,
  chapterProgress,
  chapterRevisions,
  chapterStatus,
  chaptersOf,
  subjectById,
  subjectProgress,
  topicMastery,
  topicsOfChapter
} from '../store/selectors'
import { formatShortDate, formatDuration } from '../lib/date'
import { cx, pct, sum } from '../lib/utils'

function SubjectIconEl({ subject, size = 18 }: { subject: Subject; size?: number }) {
  const map = {
    calculator: Calculator,
    flask: FlaskConical,
    brain: Brain,
    newspaper: Newspaper,
    book: BookOpen
  } as const
  const Cmp = map[subject.icon] ?? BookOpen
  return <Cmp size={size} />
}

type StatusFilter = 'all' | 'completed' | 'in-progress' | 'weak' | 'not-started'

export default function SubjectsPage() {
  const { state } = useStudy()
  const { subjectId, chapterId } = useParams()
  const navigate = useNavigate()

  const subject = subjectId ? subjectById(state, subjectId) : undefined
  const chapter = chapterId ? chapterById(state, chapterId) : undefined

  if (chapter && subject) return <ChapterDetail subject={subject} chapter={chapter} onBack={() => navigate(`/subjects/${subject.id}`)} />
  if (subject) return <SubjectDetail subject={subject} onBack={() => navigate('/subjects')} />
  return <SubjectList />
}

/* ------------------------------------------------------------------ */

function SubjectList() {
  const { state, addSubject, deleteSubject, notify } = useStudy()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [short, setShort] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null)
  const [error, setError] = useState('')

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Subjects & Chapters</h1>
          <p className="page-head__sub">
            Four exam subjects come pre-loaded with chapters and topics. Track learning, practice, PYQs, revisions, mock performance and accuracy at
            chapter level — mastery is earned across many sessions, never from one.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            Add subject
          </Button>
        </div>
      </div>

      <div className="subject-grid section">
        {state.subjects.map((s) => {
          const p = subjectProgress(state, s.id)
          const tone = `var(--s-${s.tone === 'custom' ? 'math' : s.tone})`
          const soft = `var(--s-${s.tone === 'custom' ? 'math' : s.tone}-soft)`
          return (
            <div key={s.id} style={{ position: 'relative' }}>
              <button className="subject-card" style={{ width: '100%' }} onClick={() => navigate(`/subjects/${s.id}`)}>
                <div className="subject-card__head">
                  <span className="subject-icon" style={{ background: soft, color: tone }}>
                    <SubjectIconEl subject={s} size={17} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="subject-card__name">{s.name}</p>
                    <p className="subject-card__meta">
                      {p.chapters} chapters · {p.topics} topics
                    </p>
                  </div>
                  <ChevronRight size={15} className="text-tertiary" />
                </div>
                <Progress value={p.mastery} tone={p.mastery >= 75 ? 'success' : 'accent'} height={5} label={`Mastery ${p.mastery}%`} showValue />
                <div className="subject-card__stats">
                  <div>
                    <p className="mini-stat__value mono">{p.topicsLearned}</p>
                    <p className="mini-stat__label">Learnt</p>
                  </div>
                  <div>
                    <p className="mini-stat__value mono">{p.revisions}</p>
                    <p className="mini-stat__label">Revisions</p>
                  </div>
                  <div>
                    <p className="mini-stat__value mono" style={{ color: p.accuracy >= 75 ? 'var(--success)' : p.accuracy >= 60 ? 'var(--warning)' : 'var(--danger)' }}>
                      {p.accuracy}%
                    </p>
                    <p className="mini-stat__label">Accuracy</p>
                  </div>
                </div>
                {p.weakChapters.length ? (
                  <Badge tone="warning" size="sm" dot>
                    {p.weakChapters.length} weak chapter{p.weakChapters.length === 1 ? '' : 's'}
                  </Badge>
                ) : (
                  <Badge tone="success" size="sm" dot>
                    No weak chapters
                  </Badge>
                )}
              </button>
              {s.tone === 'custom' ? (
                <button
                  className="icon-btn"
                  style={{ position: 'absolute', top: 10, right: 36, width: 26, height: 26 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(s)
                  }}
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 size={12} />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <Card>
        <CardHeader title="Chapter completion across subjects" subtitle="Progress weights learning, practice, PYQs, revisions and accuracy" icon={<Target size={15} />} />
        <div className="stack" style={{ gap: 12 }}>
          {state.subjects.map((s) => {
            const chapters = chaptersOf(state, s.id)
            const done = chapters.filter((c) => ['learning-completed', 'revision-in-progress', 'mastered'].includes(chapterStatus(c))).length
            const tone = `var(--s-${s.tone === 'custom' ? 'math' : s.tone})`
            return (
              <div key={s.id}>
                <div className="row row--between" style={{ marginBottom: 4 }}>
                  <div className="row" style={{ gap: 7 }}>
                    <span className="subject-dot" style={{ background: tone }} />
                    <span style={{ fontSize: 12.5, fontWeight: 550 }}>{s.name}</span>
                  </div>
                  <span className="mono text-secondary" style={{ fontSize: 11.5 }}>
                    {done}/{chapters.length} chapters
                  </span>
                </div>
                <Progress value={done} max={Math.max(1, chapters.length)} tone="accent" height={5} />
              </div>
            )
          })}
        </div>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a custom subject"
        subtitle="Useful for optional papers, descriptive subjects or a second exam."
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (name.trim().length < 2) {
                  setError('Subject name needs at least 2 characters.')
                  return
                }
                const created = addSubject({ name, shortName: short })
                notify({ title: 'Subject created', message: `${created.name} is ready for chapters.`, variant: 'success' })
                setCreateOpen(false)
                setName('')
                setShort('')
                setError('')
                navigate(`/subjects/${created.id}`)
              }}
            >
              Create subject
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Subject name" required error={error}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General Awareness" />
          </Field>
          <Field label="Short name" hint="Shown in tight spaces (max 14 characters)">
            <Input value={short} onChange={(e) => setShort(e.target.value)} placeholder="GA" maxLength={14} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? 'subject'}?`}
        message="All chapters, topics and scheduled sessions for this subject will be removed. Default exam subjects cannot be deleted."
        confirmLabel="Delete subject"
        onConfirm={() => {
          if (deleteTarget) {
            deleteSubject(deleteTarget.id)
            notify({ title: 'Subject deleted', message: `${deleteTarget.name} and its chapters were removed.`, variant: 'info' })
          }
          setDeleteTarget(null)
        }}
      />
    </main>
  )
}

/* ------------------------------------------------------------------ */

function SubjectDetail({ subject, onBack }: { subject: Subject; onBack: () => void }) {
  const { state, addChapter, updateChapter, deleteChapter, notify } = useStudy()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [chapterModal, setChapterModal] = useState<{ chapter?: Chapter } | null>(null)
  const [chapterName, setChapterName] = useState('')
  const [weightage, setWeightage] = useState('5')
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null)
  const [modalError, setModalError] = useState('')

  const p = subjectProgress(state, subject.id)
  const chapters = chaptersOf(state, subject.id)
  const tone = `var(--s-${subject.tone === 'custom' ? 'math' : subject.tone})`
  const soft = `var(--s-${subject.tone === 'custom' ? 'math' : subject.tone}-soft)`

  const filtered = useMemo(() => {
    let list = chapters
    if (filter === 'completed') list = list.filter((c) => ['learning-completed', 'mastered', 'revision-in-progress'].includes(chapterStatus(c)))
    if (filter === 'in-progress') list = list.filter((c) => ['learning', 'revision-in-progress'].includes(chapterStatus(c)))
    if (filter === 'weak') list = list.filter((c) => chapterStatus(c) !== 'not-started' && chapterAccuracy(c) < 72)
    if (filter === 'not-started') list = list.filter((c) => chapterStatus(c) === 'not-started')
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.topics.some((t) => t.name.toLowerCase().includes(q)))
    }
    return list
  }, [chapters, filter, search])

  const counts = {
    all: chapters.length,
    completed: chapters.filter((c) => ['learning-completed', 'mastered', 'revision-in-progress'].includes(chapterStatus(c))).length,
    'in-progress': chapters.filter((c) => ['learning', 'revision-in-progress'].includes(chapterStatus(c))).length,
    weak: chapters.filter((c) => chapterStatus(c) !== 'not-started' && chapterAccuracy(c) < 72).length,
    'not-started': chapters.filter((c) => chapterStatus(c) === 'not-started').length
  }

  return (
    <main className="page">
      <button className="btn btn--ghost btn--sm" onClick={onBack} style={{ marginBottom: 12 }}>
        <ArrowLeft size={13} /> All subjects
      </button>

      <div className="page-head">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="subject-icon" style={{ background: soft, color: tone, width: 42, height: 42 }}>
            <SubjectIconEl subject={subject} size={20} />
          </span>
          <div className="page-head__text">
            <h1 style={{ fontSize: 22 }}>{subject.name}</h1>
            <p className="page-head__sub">
              {p.chapters} chapters · {p.topics} topics · {p.topicsLearned} learnt · {p.revisions} revisions logged
            </p>
          </div>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<Plus size={14} />} onClick={() => { setChapterModal({}); setChapterName(''); setWeightage('5'); setModalError('') }}>
            Add chapter
          </Button>
          <Button variant="primary" icon={<Target size={14} />} onClick={() => navigate('/mock-tests')}>
            Take a test
          </Button>
        </div>
      </div>

      <div className="grid grid--4 section" style={{ gap: 11 }}>
        <Card>
          <p className="stat__label">Mastery</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {p.mastery}%
          </p>
          <Progress value={p.mastery} tone={p.mastery >= 75 ? 'success' : 'accent'} height={4} />
        </Card>
        <Card>
          <p className="stat__label">Accuracy</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {p.accuracy}%
          </p>
          <p className="stat__hint">{p.topics ? `${sum(chapters.flatMap((c) => c.topics).map((t) => t.questionsAttempted))} questions attempted` : '—'}</p>
        </Card>
        <Card>
          <p className="stat__label">Chapters done</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {p.chaptersCompleted}/{p.chapters}
          </p>
          <p className="stat__hint">{p.weakChapters.length} weak</p>
        </Card>
        <Card>
          <p className="stat__label">Revisions</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {p.revisions}
          </p>
          <p className="stat__hint">across all topics</p>
        </Card>
      </div>

      <Card pad={false}>
        <div style={{ padding: '14px 14px 0' }}>
          <div className="row row--between row--wrap" style={{ gap: 10, marginBottom: 12 }}>
            <Tabs
              value={filter}
              onChange={(v) => setFilter(v)}
              tabs={[
                { value: 'all', label: 'All chapters', count: counts.all },
                { value: 'completed', label: 'Completed', count: counts.completed },
                { value: 'in-progress', label: 'In progress', count: counts['in-progress'] },
                { value: 'weak', label: 'Weak', count: counts.weak },
                { value: 'not-started', label: 'Not started', count: counts['not-started'] }
              ]}
            />
          </div>
          <div style={{ paddingBottom: 12, maxWidth: 320 }}>
            <div className="row" style={{ gap: 6 }}>
              <Search size={14} className="text-tertiary" />
              <Input placeholder="Search chapters or topics…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {filtered.length ? (
          <div>
            {filtered.map((chapter) => {
              const status = chapterStatus(chapter)
              const meta = CHAPTER_STATUS_META[status]
              const progress = chapterProgress(chapter)
              const accuracy = chapterAccuracy(chapter)
              return (
                <div key={chapter.id} className="chapter-row" onClick={() => navigate(`/subjects/${subject.id}/${chapter.id}`)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/subjects/${subject.id}/${chapter.id}`) }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 7 }}>
                      <span className="chapter-row__name">{chapter.name}</span>
                      <Badge tone={meta.tone as 'neutral' | 'accent' | 'success' | 'warning' | 'info'} size="sm" dot>
                        {meta.label}
                      </Badge>
                    </div>
                    <div className="chapter-row__meta">
                      <span>{chapter.topics.length} topics</span>
                      <span>·</span>
                      <span>{chapter.topics.filter((t) => t.initialLearningDate).length} learnt</span>
                      <span>·</span>
                      <span>{chapterRevisions(chapter)} revisions</span>
                      <span>·</span>
                      <span>{accuracy}% accuracy</span>
                      <span>·</span>
                      <span>{chapter.topics.reduce((a, t) => a + t.mistakeCount, 0)} mistakes</span>
                    </div>
                  </div>
                  <div className="chapter-row__right">
                    <div style={{ width: 90 }}>
                      <Progress value={progress} tone={progress >= 80 ? 'success' : progress >= 40 ? 'accent' : 'warning'} height={4} />
                    </div>
                    <span className="chapter-row__pct">{progress}%</span>
                    <div className="row" style={{ gap: 1 }} onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" aria-label="Edit chapter"
                        onClick={() => { setChapterModal({ chapter }); setChapterName(chapter.name); setWeightage(String(chapter.weightage)); setModalError('') }}>
                        <Pencil size={12} />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Delete chapter" onClick={() => setDeleteTarget(chapter)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                    <ChevronRight size={14} className="text-tertiary" />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Layers size={20} />}
            title="No chapters in this view"
            message="Change the filter, clear the search, or add your first chapter to this subject."
            action={<Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setChapterModal({})}>Add chapter</Button>}
          />
        )}
      </Card>

      <Modal
        open={Boolean(chapterModal)}
        onClose={() => setChapterModal(null)}
        title={chapterModal?.chapter ? 'Edit chapter' : 'Add chapter'}
        footer={
          <>
            <Button onClick={() => setChapterModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (chapterName.trim().length < 2) {
                  setModalError('Chapter name needs at least 2 characters.')
                  return
                }
                if (chapterModal?.chapter) {
                  updateChapter(chapterModal.chapter.id, { name: chapterName.trim(), weightage: Number(weightage) || 5 })
                  notify({ title: 'Chapter updated', message: chapterName.trim(), variant: 'success' })
                } else {
                  addChapter(subject.id, chapterName, Number(weightage) || 5)
                  notify({ title: 'Chapter added', message: `${chapterName.trim()} added to ${subject.name}.`, variant: 'success' })
                }
                setChapterModal(null)
              }}
            >
              {chapterModal?.chapter ? 'Save chapter' : 'Add chapter'}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Chapter name" required error={modalError}>
            <Input value={chapterName} onChange={(e) => setChapterName(e.target.value)} placeholder="e.g. Data Interpretation" />
          </Field>
          <Field label="Exam weightage (relative marks share)" hint="Used to prioritise revision and mock composition">
            <Input type="number" min={1} max={20} value={weightage} onChange={(e) => setWeightage(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? 'chapter'}?`}
        message="Its topics and revision history are removed with it. Completed session logs stay in your daily history."
        confirmLabel="Delete chapter"
        onConfirm={() => {
          if (deleteTarget) {
            deleteChapter(deleteTarget.id)
            notify({ title: 'Chapter deleted', message: `${deleteTarget.name} removed.`, variant: 'info' })
          }
          setDeleteTarget(null)
        }}
      />
    </main>
  )
}

/* ------------------------------------------------------------------ */

function ChapterDetail({ subject, chapter, onBack }: { subject: Subject; chapter: Chapter; onBack: () => void }) {
  const { state, addTopic, updateTopic, deleteTopic, notify } = useStudy()
  const [topicOpen, setTopicOpen] = useState(false)
  const [topicName, setTopicName] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [notesFor, setNotesFor] = useState<Topic | null>(null)
  const [notesValue, setNotesValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Topic | null>(null)
  const [error, setError] = useState('')

  const topics = topicsOfChapter(state, chapter.id)
  const status = chapterStatus(chapter)
  const meta = CHAPTER_STATUS_META[status]

  return (
    <main className="page">
      <button className="btn btn--ghost btn--sm" onClick={onBack} style={{ marginBottom: 12 }}>
        <ArrowLeft size={13} /> {subject.name}
      </button>

      <div className="page-head">
        <div className="page-head__text">
          <div className="row" style={{ gap: 8, marginBottom: 5 }}>
            <Badge tone={meta.tone as 'neutral' | 'accent' | 'success' | 'warning' | 'info'} dot>
              {meta.label}
            </Badge>
            <Badge tone="neutral" size="sm">weightage {chapter.weightage}</Badge>
          </div>
          <h1 style={{ fontSize: 21 }}>{chapter.name}</h1>
          <p className="page-head__sub">
            {topics.length} topics · {chapterRevisions(chapter)} revisions · {chapterAccuracy(chapter)}% accuracy · progress {chapterProgress(chapter)}%
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => window.dispatchEvent(new CustomEvent('studyos:open-revision'))}>
            Revise chapter
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => { setTopicOpen(true); setTopicName(''); setError('') }}>
            Add topic
          </Button>
        </div>
      </div>

      <div className="grid grid--4 section" style={{ gap: 11 }}>
        <Card>
          <p className="stat__label">Topics learnt</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {topics.filter((t) => t.initialLearningDate).length}/{topics.length}
          </p>
        </Card>
        <Card>
          <p className="stat__label">Practice / PYQ</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {topics.filter((t) => t.practiceCompleted).length}/{topics.filter((t) => t.pyqCompleted).length}
          </p>
        </Card>
        <Card>
          <p className="stat__label">Mistakes</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {topics.reduce((a, t) => a + t.mistakeCount, 0)}
          </p>
        </Card>
        <Card>
          <p className="stat__label">Avg. mastery</p>
          <p className="stat__value mono" style={{ marginTop: 4 }}>
            {topics.length ? Math.round(sum(topics.map(topicMastery)) / topics.length) : 0}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Topics" subtitle="Every topic keeps its own learning date, revision history and mastery" icon={<BookOpen size={15} />} />
        {topics.length ? (
          <div className="stack" style={{ gap: 7 }}>
            {topics.map((topic) => (
              <div className="topic-row" key={topic.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row row--wrap" style={{ gap: 6 }}>
                    <span className="topic-row__name">{topic.name}</span>
                    <Badge tone={topic.difficulty === 'hard' ? 'danger' : topic.difficulty === 'medium' ? 'warning' : 'success'} size="sm">
                      {topic.difficulty}
                    </Badge>
                    {topicMastery(topic) > 0 ? (
                      <Badge tone={topicMastery(topic) >= 75 ? 'success' : topicMastery(topic) >= 55 ? 'info' : 'warning'} size="sm">
                        mastery {topicMastery(topic)}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="topic-row__meta">
                    <span className={cx('topic-status', topic.learningCompleted && 'is-on')}>
                      {topic.learningCompleted ? '✓' : '○'} Learning
                    </span>
                    <span className={cx('topic-status', topic.practiceCompleted && 'is-on')}>
                      {topic.practiceCompleted ? '✓' : '○'} Practice
                    </span>
                    <span className={cx('topic-status', topic.pyqCompleted && 'is-on')}>
                      {topic.pyqCompleted ? '✓' : '○'} PYQ
                    </span>
                    <span>· {topic.revisions.length} revisions</span>
                    {topic.nextRevisionDue ? <span>· next {formatShortDate(topic.nextRevisionDue)}</span> : null}
                    {topic.initialLearningDate ? <span>· learnt {formatShortDate(topic.initialLearningDate)}</span> : null}
                  </div>
                </div>
                <div className="row" style={{ gap: 2 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setNotesFor(topic); setNotesValue(topic.notes) }}
                  >
                    Notes
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Delete topic" onClick={() => setDeleteTarget(topic)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen size={20} />}
            title="No topics yet"
            message="Add the individual topics under this chapter — each becomes a trackable unit with its own revision timeline."
            action={<Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setTopicOpen(true)}>Add first topic</Button>}
          />
        )}
      </Card>

      <Modal
        open={topicOpen}
        onClose={() => setTopicOpen(false)}
        title="Add topic"
        subtitle={`Under ${chapter.name}`}
        footer={
          <>
            <Button onClick={() => setTopicOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (topicName.trim().length < 2) {
                  setError('Topic name needs at least 2 characters.')
                  return
                }
                addTopic(chapter.id, topicName, difficulty)
                notify({ title: 'Topic added', message: topicName.trim(), variant: 'success' })
                setTopicOpen(false)
              }}
            >
              Add topic
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Topic name" required error={error}>
            <Input value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="e.g. Alligation Method" />
          </Field>
          <Field label="Difficulty">
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(notesFor)}
        onClose={() => setNotesFor(null)}
        title={notesFor?.name ?? 'Topic notes'}
        subtitle="Notes are shown in the revision panel before new learning"
        footer={
          <>
            <Button onClick={() => setNotesFor(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (notesFor) {
                  updateTopic(notesFor.id, { notes: notesValue })
                  notify({ title: 'Notes saved', message: notesFor.name, variant: 'success' })
                }
                setNotesFor(null)
              }}
            >
              Save notes
            </Button>
          </>
        }
      >
        <Field label="Notes, shortcuts and doubts">
          <Textarea rows={6} value={notesValue} onChange={(e) => setNotesValue(e.target.value)} placeholder="Key shortcuts, trap patterns, doubts to ask…" />
        </Field>
        {notesFor?.formulas.length ? (
          <div style={{ marginTop: 12 }}>
            <p className="field__label">Formulas on file</p>
            <div style={{ marginTop: 4 }}>
              {notesFor.formulas.map((f) => (
                <span key={f} className="formula-chip">
                  {f}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete this topic?"
        message="Its revision history, accuracy record and notes are removed permanently."
        confirmLabel="Delete topic"
        onConfirm={() => {
          if (deleteTarget) {
            deleteTopic(deleteTarget.id)
            notify({ title: 'Topic deleted', message: deleteTarget.name, variant: 'info' })
          }
          setDeleteTarget(null)
        }}
      />
    </main>
  )
}

export { MoreHorizontal, GraduationCap, TrendingUp, formatDuration, pct }
