import { useEffect, useId, useMemo, useState } from 'react'
import { ExternalLink, FileText, Plus, Save, ShieldCheck, Trash2, X, XCircle } from 'lucide-react'
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { chaptersOf } from '../../store/selectors'
import { api, errorMessage } from '../../lib/http'
import { cx } from '../../lib/utils'

export type QuestionStatus = 'extracted' | 'needs_review' | 'verified' | 'rejected'
export type QuestionType = 'single_correct' | 'multiple_correct' | 'numeric' | 'true_false' | 'unknown'
export type MockType = 'full_mixed' | 'sectional' | 'subject_full' | 'chapter' | 'topic' | 'practice'

export interface BankQuestion {
  _id: string
  origin: 'pdf' | 'manual' | 'ai_generated'
  documentId: string | null
  source: { documentId: string | null; pageNumber: number | null; questionNumber: string | null }
  rawText: string
  questionText: string
  questionType: QuestionType
  options: Array<{ label: string; text: string }>
  correctAnswer: string[] | null
  answerSource: 'document_key' | 'student' | 'ai_generated' | null
  explanation: string | null
  subjectId: string | null
  subjectName: string | null
  chapterId: string | null
  chapterName: string | null
  topicId: string | null
  topicName: string | null
  difficulty: 'easy' | 'medium' | 'hard' | 'unknown'
  status: QuestionStatus
  extractionConfidence: number
  flags: string[]
  createdAt: string
}

export interface UploadedDoc {
  _id: string
  originalName: string
  sizeBytes: number
  pageCount: number
  status: 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed'
  stage: string
  progress: number
  error: string | null
  intent: { mockType: string | null; subjectIds: string[] }
  pages: Array<{ pageNumber: number; method: 'text' | 'ocr' | 'ocr_unavailable' | 'empty'; chars: number }>
  stats: { questionsFound: number; inserted: number; duplicates: number; needsReview: number; textPages: number; ocrPages: number; ocrUnavailablePages: number; answerKeyFound: boolean }
  aiUsed: boolean
  aiNote: string | null
  createdAt: string
}

export const MOCK_TYPE_META: Record<MockType, { label: string; short: string; description: string }> = {
  full_mixed: { label: 'Full mock — all subjects mixed', short: 'Full mixed', description: 'Every subject with a configurable question distribution.' },
  sectional: { label: 'Sectional mock', short: 'Sectional', description: 'Two or more selected subjects.' },
  subject_full: { label: 'Subject-wise full mock', short: 'Subject-wise', description: 'One subject, all its chapters.' },
  chapter: { label: 'Chapter-wise mock', short: 'Chapter-wise', description: 'One or more chapters.' },
  topic: { label: 'Topic-wise practice', short: 'Topic-wise', description: 'One or more topics.' },
  practice: { label: 'Practice set', short: 'Practice', description: 'Re-attempt from a previous result.' }
}

export const STATUS_META: Record<QuestionStatus, { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' | 'info' }> = {
  extracted: { label: 'Extracted', tone: 'info' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' }
}

const FLAG_TEXT: Record<string, string> = {
  no_options_detected: 'No options detected',
  fewer_than_4_options: 'Fewer than 4 options',
  short_question_text: 'Very short question text',
  empty_option: 'An option is empty',
  page_has_images: 'Page has images/diagrams — check the source',
  answer_from_document_key: 'Answer read from the PDF answer key',
  answer_from_document_inline: 'Answer read from an “Ans:” line in the PDF',
  answer_label_not_in_options: 'Answer key label did not match any option (ignored)',
  ai_structured: 'Restructured by AI (verify carefully)',
  ai_output_rejected_not_grounded: 'AI suggestion rejected: not found in PDF text',
  subject_suggested_by_ai: 'Subject suggested by AI',
  needs_subject: 'Subject not assigned',
  ai_generated: 'AI-generated question',
  not_official_pyq: 'Not an official previous-year question'
}

export const flagLabel = (f: string) => FLAG_TEXT[f] ?? f.replace(/_/g, ' ')

export function OriginBadge({ q }: { q: Pick<BankQuestion, 'origin'> }) {
  if (q.origin === 'ai_generated') return <Badge tone="purple" size="sm">AI-generated · not official</Badge>
  if (q.origin === 'manual') return <Badge size="sm">Manual</Badge>
  return <Badge size="sm">From PDF</Badge>
}

/** Subject → chapter → topic pickers bound to the student's own curriculum. */
export function TaxonomyFields({
  value,
  onChange,
  compact
}: {
  value: { subjectId: string | null; chapterId: string | null; topicId: string | null }
  onChange: (v: { subjectId: string | null; chapterId: string | null; topicId: string | null }) => void
  compact?: boolean
}) {
  const { state } = useStudy()
  const uid = useId()
  const chapters = value.subjectId ? chaptersOf(state, value.subjectId) : []
  const topics = chapters.find((c) => c.id === value.chapterId)?.topics ?? []
  return (
    <div className={cx('grid', compact ? 'grid--3' : 'grid--3')}>
      <Field label="Subject" htmlFor={`${uid}-s`}>
        <Select id={`${uid}-s`} value={value.subjectId ?? ''} onChange={(e) => onChange({ subjectId: e.target.value || null, chapterId: null, topicId: null })}>
          <option value="">— Unassigned —</option>
          {state.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Chapter" htmlFor={`${uid}-c`}>
        <Select id={`${uid}-c`} value={value.chapterId ?? ''} disabled={!value.subjectId} onChange={(e) => onChange({ ...value, chapterId: e.target.value || null, topicId: null })}>
          <option value="">— None —</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Topic" htmlFor={`${uid}-t`}>
        <Select id={`${uid}-t`} value={value.topicId ?? ''} disabled={!value.chapterId} onChange={(e) => onChange({ ...value, topicId: e.target.value || null })}>
          <option value="">— None —</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** Opens the private PDF through a short-lived signed URL. */
export function SourcePageButton({ documentId, page, label = 'Source page' }: { documentId: string | null; page: number | null; label?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  if (!documentId) return null
  const open = async () => {
    try {
      const r = await api<{ url: string }>(`/api/documents/${documentId}/file-url`, { method: 'POST' })
      setUrl(`${r.url}#page=${page ?? 1}`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <>
      <Button size="sm" variant="ghost" icon={<FileText size={13} />} onClick={open} title={error || undefined}>
        {label}
        {page ? ` p.${page}` : ''}
      </Button>
      <Modal open={Boolean(url)} onClose={() => setUrl(null)} title={`Source PDF${page ? ` — page ${page}` : ''}`} size="xl">
        {url ? (
          <div className="pdf-frame">
            <iframe title="Source PDF" src={url} />
            <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              <span>Open in new tab</span>
            </a>
          </div>
        ) : null}
      </Modal>
      {error ? <span className="text-danger" style={{ fontSize: 12 }}>{error}</span> : null}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Question editor — edit, verify, reject                              */
/* ------------------------------------------------------------------ */

const LETTERS = ['A', 'B', 'C', 'D', 'E']

export function QuestionEditor({
  question,
  onSaved,
  onDeleted,
  selectable,
  selected,
  onSelect
}: {
  question: BankQuestion
  onSaved: (q: BankQuestion) => void
  onDeleted?: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (v: boolean) => void
}) {
  const [editing, setEditing] = useState(question.status === 'needs_review' || question.status === 'extracted')
  const [draft, setDraft] = useState(question)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string[]>([])
  useEffect(() => setDraft(question), [question])

  const dirty = useMemo(
    () =>
      JSON.stringify([draft.questionText, draft.questionType, draft.options, draft.correctAnswer, draft.explanation, draft.subjectId, draft.chapterId, draft.topicId, draft.difficulty]) !==
      JSON.stringify([question.questionText, question.questionType, question.options, question.correctAnswer, question.explanation, question.subjectId, question.chapterId, question.topicId, question.difficulty]),
    [draft, question]
  )

  const call = async (label: string, fn: () => Promise<{ question: BankQuestion } | void>) => {
    setBusy(label)
    setError([])
    try {
      const r = await fn()
      if (r && 'question' in r) onSaved(r.question)
    } catch (err) {
      const details = (err as { details?: { problems?: string[] } }).details
      setError(details?.problems ?? [errorMessage(err)])
    } finally {
      setBusy(null)
    }
  }

  const patchBody = () => ({
    questionText: draft.questionText,
    questionType: draft.questionType,
    options: draft.options.map((o) => ({ text: o.text })),
    correctAnswer: draft.correctAnswer && draft.correctAnswer.length ? draft.correctAnswer : null,
    explanation: draft.explanation || null,
    subjectId: draft.subjectId,
    chapterId: draft.chapterId,
    topicId: draft.topicId,
    difficulty: draft.difficulty
  })

  const save = () => call('save', () => api<{ question: BankQuestion }>(`/api/questions/${question._id}`, { method: 'PATCH', body: patchBody() }))

  const verify = () =>
    call('verify', async () => {
      if (dirty) await api(`/api/questions/${question._id}`, { method: 'PATCH', body: patchBody() })
      return api<{ question: BankQuestion }>(`/api/questions/${question._id}/verify`, { method: 'POST' })
    })

  const toggleAnswer = (label: string) => {
    const cur = draft.correctAnswer ?? []
    const next = draft.questionType === 'multiple_correct' ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label].sort()) : cur[0] === label ? [] : [label]
    setDraft({ ...draft, correctAnswer: next })
  }

  const status = STATUS_META[question.status]
  return (
    <article className={cx('q-card', `is-${question.status}`)}>
      <header className="q-card__head">
        {selectable ? <input type="checkbox" className="checkbox" checked={Boolean(selected)} onChange={(e) => onSelect?.(e.target.checked)} aria-label="Select question" /> : null}
        <span className="q-card__num">{question.source.questionNumber ? `Q${question.source.questionNumber}` : 'Q'}</span>
        <Badge tone={status.tone} size="sm" dot>
          {status.label}
        </Badge>
        <OriginBadge q={question} />
        {question.subjectName ? <Badge size="sm" tone="accent">{question.subjectName}</Badge> : null}
        {question.chapterName ? <span className="text-tertiary" style={{ fontSize: 12 }}>{question.chapterName}</span> : null}
        <span className="spacer" />
        <SourcePageButton documentId={question.source.documentId} page={question.source.pageNumber} />
        <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Collapse' : 'Edit'}
        </Button>
      </header>

      {question.flags.length ? (
        <div className="pill-row" style={{ marginBottom: 8 }}>
          {question.flags.map((f) => (
            <span key={f} className={cx('flag-chip', f.startsWith('answer_from') && 'is-good')}>
              {flagLabel(f)}
            </span>
          ))}
        </div>
      ) : null}

      {!editing ? (
        <div className="q-view">
          <p className="q-text">{question.questionText}</p>
          <ol className="q-options">
            {question.options.map((o) => (
              <li key={o.label} className={cx(question.correctAnswer?.includes(o.label) && 'is-correct')}>
                <span className="q-options__label">{o.label}</span> {o.text}
              </li>
            ))}
          </ol>
          {!question.correctAnswer ? <p className="text-tertiary" style={{ fontSize: 12 }}>No verified answer — this question will be unscored in tests.</p> : null}
        </div>
      ) : (
        <div className="stack">
          <Field label="Question text">
            <Textarea rows={3} value={draft.questionText} onChange={(e) => setDraft({ ...draft, questionText: e.target.value })} />
          </Field>
          <div className="grid grid--2">
            <Field label="Question type">
              <Select value={draft.questionType} onChange={(e) => setDraft({ ...draft, questionType: e.target.value as QuestionType, correctAnswer: [] })}>
                <option value="single_correct">Single correct</option>
                <option value="multiple_correct">Multiple correct</option>
                <option value="true_false">True / False</option>
                <option value="numeric">Numeric answer</option>
                <option value="unknown">Unknown</option>
              </Select>
            </Field>
            <Field label="Difficulty">
              <Select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as BankQuestion['difficulty'] })}>
                <option value="unknown">Unknown</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
          </div>
          {draft.questionType === 'numeric' ? (
            <Field label="Correct numeric answer" hint="Leave empty if the PDF has no answer key">
              <Input value={draft.correctAnswer?.[0] ?? ''} onChange={(e) => setDraft({ ...draft, correctAnswer: e.target.value ? [e.target.value] : [] })} />
            </Field>
          ) : (
            <div className="stack stack--sm">
              <span className="field__label">Options — tick the correct answer only if you are sure</span>
              {draft.options.map((o, i) => (
                <div key={i} className="option-edit">
                  <button
                    type="button"
                    className={cx('option-edit__mark', draft.correctAnswer?.includes(LETTERS[i]) && 'is-on')}
                    onClick={() => toggleAnswer(LETTERS[i])}
                    aria-pressed={Boolean(draft.correctAnswer?.includes(LETTERS[i]))}
                    aria-label={`Mark option ${LETTERS[i]} correct`}
                  >
                    {LETTERS[i]}
                  </button>
                  <Input value={o.text} onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  <button
                    type="button"
                    className="icon-btn is-ghost"
                    aria-label={`Remove option ${LETTERS[i]}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: draft.options.filter((_, j) => j !== i).map((x, j) => ({ ...x, label: LETTERS[j] })),
                        correctAnswer: []
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {draft.options.length < 5 ? (
                <div>
                  <Button size="sm" icon={<Plus size={13} />} onClick={() => setDraft({ ...draft, options: [...draft.options, { label: LETTERS[draft.options.length], text: '' }] })}>
                    Add option
                  </Button>
                </div>
              ) : null}
              {question.answerSource ? (
                <p className="text-tertiary" style={{ fontSize: 12 }}>
                  Current answer source: {question.answerSource === 'document_key' ? 'PDF answer key' : question.answerSource === 'ai_generated' ? 'AI (unverified until you verify)' : 'you'}
                </p>
              ) : null}
            </div>
          )}
          <TaxonomyFields value={{ subjectId: draft.subjectId, chapterId: draft.chapterId, topicId: draft.topicId }} onChange={(v) => setDraft({ ...draft, ...v })} compact />
          <Field label="Explanation" hint="Optional">
            <Textarea rows={2} value={draft.explanation ?? ''} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} />
          </Field>
          {question.rawText ? (
            <details className="raw-text">
              <summary>Original extracted text</summary>
              <pre>{question.rawText}</pre>
            </details>
          ) : null}
        </div>
      )}

      {error.length ? (
        <div className="callout callout--danger" style={{ marginTop: 10 }}>
          <XCircle size={14} />
          <div>{error.join(' ')}</div>
        </div>
      ) : null}

      <footer className="q-card__foot">
        {editing ? (
          <Button size="sm" icon={<Save size={13} />} disabled={!dirty} loading={busy === 'save'} onClick={save}>
            Save
          </Button>
        ) : null}
        {question.status !== 'verified' ? (
          <Button size="sm" variant="success" icon={<ShieldCheck size={13} />} loading={busy === 'verify'} onClick={verify}>
            {dirty ? 'Save & verify' : 'Verify'}
          </Button>
        ) : null}
        {question.status !== 'rejected' ? (
          <Button size="sm" variant="ghost" loading={busy === 'reject'} onClick={() => call('reject', () => api<{ question: BankQuestion }>(`/api/questions/${question._id}/reject`, { method: 'POST' }))}>
            Reject
          </Button>
        ) : null}
        {onDeleted ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={13} />}
            loading={busy === 'delete'}
            onClick={() =>
              window.confirm('Delete this question from your bank? Finished test results keep their copy.') &&
              call('delete', async () => {
                await api(`/api/questions/${question._id}`, { method: 'DELETE' })
                onDeleted(question._id)
              })
            }
          >
            Delete
          </Button>
        ) : null}
      </footer>
    </article>
  )
}

export const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
export const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(sec).padStart(2, '0')}s`
}
