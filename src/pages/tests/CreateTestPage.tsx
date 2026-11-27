import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, FileUp, Library, Play, Upload, X } from 'lucide-react'
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Progress, Select, Textarea, Toggle } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { useAuth } from '../../auth/AuthContext'
import { useWorkspaceSync } from '../../workspace/WorkspaceGate'
import { ApiError, api, errorMessage, uploadWithProgress, type UploadHandle } from '../../lib/http'
import { chaptersOf } from '../../store/selectors'
import { cx } from '../../lib/utils'
import { MOCK_TYPE_META, fmtBytes, type MockType, type UploadedDoc } from './shared'
import { ProcessingStatus } from './DocumentReviewPage'

type Step = 'type' | 'source' | 'configure'
type BuildType = Exclude<MockType, 'practice'>
const TYPES: BuildType[] = ['full_mixed', 'sectional', 'subject_full', 'chapter', 'topic']

interface Config {
  subjectIds: string[]
  chapterIds: string[]
  topicIds: string[]
  distribution: Record<string, number>
  questionCount: number
  durationMinutes: number
  marksPerQuestion: number
  negativeMarks: number
  selectionMethod: 'random' | 'difficulty' | 'topic'
  difficultyDistribution: { easy: number; medium: number; hard: number }
  avoidRecentDays: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  instructions: string
}

interface PreviewResult {
  ok: boolean
  total: number
  buckets: Array<{ key: string; label: string; requested: number; available: number; detail?: Array<{ level: string; requested: number; available: number }> }>
}

export default function CreateTestPage() {
  const [params] = useSearchParams()
  const initialType = (TYPES.includes(params.get('type') as BuildType) ? params.get('type') : null) as BuildType | null
  const [type, setType] = useState<BuildType | null>(initialType)
  // Returning from document review with ?step=configure&type=… resumes at configuration.
  const [step, setStep] = useState<Step>(params.get('step') === 'configure' && initialType ? 'configure' : 'type')

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <Link to="/tests" className="back-link">
            <ArrowLeft size={13} /> Test builder
          </Link>
          <h1>Create a mock test</h1>
          <p className="page-head__sub">Build a timed test from the shared question hub — optionally adding your own question-paper PDF to it first.</p>
        </div>
      </div>
      <ol className="wizard-steps" aria-label="Steps">
        {(['type', 'source', 'configure'] as Step[]).map((s, i) => (
          <li key={s} className={cx(step === s && 'is-active', ['type', 'source', 'configure'].indexOf(step) > i && 'is-done')}>
            <span>{i + 1}</span> {s === 'type' ? 'Test type' : s === 'source' ? 'Questions' : 'Configure'}
          </li>
        ))}
      </ol>
      {step === 'type' ? (
        <TypeStep
          value={type}
          onChange={setType}
          onNext={() => setStep(params.get('step') === 'configure' ? 'configure' : 'source')}
        />
      ) : null}
      {step === 'source' && type ? <SourceStep type={type} onBack={() => setStep('type')} onNext={() => setStep('configure')} /> : null}
      {step === 'configure' && type ? <ConfigureStep type={type} onBack={() => setStep('source')} /> : null}
    </main>
  )
}

function TypeStep({ value, onChange, onNext }: { value: BuildType | null; onChange: (t: BuildType) => void; onNext: () => void }) {
  return (
    <Card>
      <CardHeader title="Step 1 — Select the mock test type" />
      <div className="type-grid" role="radiogroup">
        {TYPES.map((t, i) => (
          <button key={t} type="button" role="radio" aria-checked={value === t} className={cx('type-card', value === t && 'is-active')} onClick={() => onChange(t)}>
            <span className="type-card__letter">{'ABCDE'[i]}</span>
            <span className="type-card__title">{MOCK_TYPE_META[t].label}</span>
            <span className="type-card__body">{MOCK_TYPE_META[t].description}</span>
          </button>
        ))}
      </div>
      <div className="row row--between" style={{ marginTop: 16 }}>
        <span />
        <Button variant="primary" iconRight={<ArrowRight size={14} />} disabled={!value} onClick={onNext}>
          Continue
        </Button>
      </div>
    </Card>
  )
}

function SourceStep({ type, onBack, onNext }: { type: BuildType; onBack: () => void; onNext: () => void }) {
  const { state } = useStudy()
  const { config } = useAuth()
  const { flush } = useWorkspaceSync()
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<string[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [doc, setDoc] = useState<UploadedDoc | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const handle = useRef<UploadHandle<{ document: UploadedDoc; duplicate: boolean; message?: string }> | null>(null)
  const maxMb = config?.maxUploadMb ?? 20

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl])

  // Poll processing status after upload.
  useEffect(() => {
    if (!doc || !['queued', 'processing'].includes(doc.status)) return
    const id = window.setTimeout(async () => {
      try {
        const r = await api<{ document: UploadedDoc }>(`/api/documents/${doc._id}`)
        setDoc(r.document)
      } catch (err) {
        setError(errorMessage(err))
      }
    }, 1500)
    return () => window.clearTimeout(id)
  }, [doc])

  const choose = (f: File | undefined) => {
    setError('')
    setDoc(null)
    setNote('')
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return setError('Choose a PDF file.')
    if (f.size > maxMb * 1024 * 1024) return setError(`This file is ${fmtBytes(f.size)}; the limit is ${maxMb} MB.`)
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const upload = async () => {
    if (!file) return
    if (!subjects.length) return setError('Choose the subject(s) this paper covers — the hub files questions by subject.')
    setError('')
    await flush()
    const form = new FormData()
    form.append('mockType', type)
    form.append('subjectIds', subjects.join(','))
    form.append('file', file)
    setProgress(0)
    handle.current = uploadWithProgress('/api/documents', form, setProgress)
    try {
      const r = await handle.current.promise
      setDoc(r.document)
      if (r.duplicate) setNote(r.message ?? 'This PDF was uploaded before; showing the existing document.')
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'ABORTED' ? 'Upload cancelled.' : errorMessage(err))
    } finally {
      setProgress(null)
      handle.current = null
    }
  }

  return (
    <div className="grid grid--aside">
      <Card>
        <CardHeader
          title="Step 2 — Add a question paper to the hub (optional)"
          subtitle="Questions are added to the shared hub. Ones without an answer key are answered by AI in the background. Text PDFs are read directly; scanned PDFs need OCR."
          icon={<FileUp size={15} />}
        />
        <div className="stack">
          <label className={cx('dropzone', file && 'has-file')}>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => choose(e.target.files?.[0])} disabled={progress !== null} />
            <Upload size={20} />
            {file ? (
              <span>
                <strong>{file.name}</strong> · {fmtBytes(file.size)}
              </span>
            ) : (
              <span>
                Choose a question-paper PDF <span className="text-tertiary">(max {maxMb} MB)</span>
              </span>
            )}
          </label>
          <Field label="Subjects in this PDF" required hint="Pick one subject if the paper covers only one — every question is then filed under it automatically.">
            <div className="pill-row">
              {state.subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cx('chip-filter', subjects.includes(s.id) && 'is-active')}
                  onClick={() => setSubjects((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
          {config && !config.ocr.available ? (
            <div className="callout callout--warning">
              <AlertTriangle size={14} />
              <span>OCR is not installed on this server, so scanned (image-only) pages cannot be read. Text-based PDFs work normally.</span>
            </div>
          ) : null}
          {progress !== null ? (
            <div className="stack stack--sm">
              <Progress value={progress} label="Uploading" showValue />
              <div>
                <Button size="sm" icon={<X size={13} />} onClick={() => handle.current?.abort()}>
                  Cancel upload
                </Button>
              </div>
            </div>
          ) : null}
          {error ? <div className="callout callout--danger" role="alert">{error}</div> : null}
          {note ? <div className="callout callout--info">{note}</div> : null}
          {doc ? (
            <div className="muted-box stack stack--sm">
              <div className="row row--between">
                <strong>{doc.originalName}</strong>
                <Badge size="sm">{doc.pageCount} pages</Badge>
              </div>
              <ProcessingStatus doc={doc} />
              {doc.status === 'completed' ? (
                <p className="text-secondary">
                  {doc.stats.questionsFound} questions found · {doc.stats.inserted} new in the hub · {doc.stats.duplicates} already there
                  {doc.stats.pendingAnswer ? ` · ${doc.stats.pendingAnswer} waiting for an AI answer` : ''} · {doc.stats.needsReview} need review
                </p>
              ) : null}
              {doc.error ? <div className="callout callout--danger">{doc.error}</div> : null}
              {doc.status === 'completed' ? (
                <Button variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => navigate(`/tests/documents/${doc._id}?type=${type}`)}>
                  Review questions
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="row row--between">
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>
              Back
            </Button>
            <div className="row" style={{ gap: 8 }}>
              {file && !doc ? (
                <Button variant="primary" icon={<Upload size={14} />} loading={progress !== null} disabled={!subjects.length} onClick={upload}>
                  Upload & extract
                </Button>
              ) : null}
              <Button icon={<Library size={14} />} iconRight={<ArrowRight size={14} />} onClick={onNext}>
                {doc ? 'Configure the test' : 'Skip — use the question hub'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="PDF preview" subtitle={file ? file.name : 'Choose a file to preview it here'} />
        {previewUrl ? (
          <div className="pdf-frame pdf-frame--inline">
            <iframe title="PDF preview" src={previewUrl} />
          </div>
        ) : (
          <p className="text-tertiary">The preview is rendered locally in your browser before anything is uploaded.</p>
        )}
      </Card>
    </div>
  )
}

function defaultConfig(subjectIds: string[]): Config {
  return {
    subjectIds: [],
    chapterIds: [],
    topicIds: [],
    distribution: Object.fromEntries(subjectIds.map((id) => [id, 5])),
    questionCount: 10,
    durationMinutes: 15,
    marksPerQuestion: 1,
    negativeMarks: 0,
    selectionMethod: 'random',
    difficultyDistribution: { easy: 30, medium: 50, hard: 20 },
    avoidRecentDays: 0,
    shuffleQuestions: true,
    shuffleOptions: false,
    instructions: ''
  }
}

function ConfigureStep({ type, onBack }: { type: BuildType; onBack: () => void }) {
  const { state, notify } = useStudy()
  const navigate = useNavigate()
  const [name, setName] = useState(`${MOCK_TYPE_META[type].short} test`)
  const [cfg, setCfg] = useState<Config>(() => defaultConfig(state.subjects.map((s) => s.id)))
  const [template, setTemplate] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((c) => ({ ...c, [k]: v }))
  // Ready questions per subject in the shared hub (matched to this student's subjects by name).
  const [hub, setHub] = useState<Record<string, { ready: number; pendingAnswer: number }>>({})
  useEffect(() => {
    api<{ subjects: Array<{ subjectId: string; ready: number; pendingAnswer: number }> }>('/api/questions/hub-summary')
      .then((r) => setHub(Object.fromEntries(r.subjects.map((x) => [x.subjectId, { ready: x.ready, pendingAnswer: x.pendingAnswer }]))))
      .catch(() => undefined)
  }, [])
  const readyLabel = (id: string) => (hub[id] ? ` · ${hub[id].ready} ready` : '')

  const usesDistribution = type === 'full_mixed' || type === 'sectional'
  const distributionSubjects = useMemo(() => (type === 'full_mixed' ? state.subjects.map((s) => s.id) : cfg.subjectIds), [type, state.subjects, cfg.subjectIds])
  const payload = useMemo(
    () => ({
      type,
      config: {
        ...cfg,
        distribution: usesDistribution ? distributionSubjects.map((id) => ({ subjectId: id, count: cfg.distribution[id] ?? 0 })).filter((d) => d.count > 0) : [],
        subjectIds: type === 'subject_full' ? cfg.subjectIds.slice(0, 1) : cfg.subjectIds
      }
    }),
    [cfg, type, usesDistribution, distributionSubjects]
  )
  const total = usesDistribution ? payload.config.distribution.reduce((a, d) => a + d.count, 0) : cfg.questionCount

  const localProblems = useMemo(() => {
    const p: string[] = []
    if (type === 'sectional' && cfg.subjectIds.length < 2) p.push('Choose at least two subjects.')
    if (type === 'subject_full' && cfg.subjectIds.length !== 1) p.push('Choose one subject.')
    if (type === 'chapter' && !cfg.chapterIds.length) p.push('Choose at least one chapter.')
    if (type === 'topic' && !cfg.topicIds.length) p.push('Choose at least one topic.')
    if (total < 1) p.push('The test needs at least one question.')
    if (cfg.selectionMethod === 'difficulty') {
      const d = cfg.difficultyDistribution
      if (d.easy + d.medium + d.hard !== 100) p.push('Difficulty percentages must add up to 100.')
    }
    if (cfg.negativeMarks > cfg.marksPerQuestion) p.push('Negative marks cannot exceed marks per question.')
    return p
  }, [cfg, type, total])

  // Live availability check against the real bank (debounced).
  useEffect(() => {
    if (localProblems.length) {
      setPreview(null)
      return
    }
    const id = window.setTimeout(async () => {
      try {
        setPreview(await api<PreviewResult>('/api/mock-tests/preview', { method: 'POST', body: payload }))
        setPreviewError('')
      } catch (err) {
        setPreviewError(errorMessage(err))
      }
    }, 400)
    return () => window.clearTimeout(id)
  }, [payload, localProblems])

  const create = async (startNow: boolean) => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ test: { _id: string } }>('/api/mock-tests', { method: 'POST', body: { name: name.trim(), ...payload, saveAsTemplate: template } })
      notify({ title: 'Mock test created', message: name, variant: 'success' })
      if (startNow) {
        const a = await api<{ attemptId: string }>('/api/attempts', { method: 'POST', body: { mockTestId: r.test._id } })
        navigate(`/exam/${a.attemptId}`)
      } else navigate('/tests')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (k: 'subjectIds' | 'chapterIds' | 'topicIds', id: string, single = false) =>
    set(k, single ? [id] : cfg[k].includes(id) ? cfg[k].filter((x) => x !== id) : [...cfg[k], id])

  return (
    <div className="grid grid--aside">
      <Card>
        <CardHeader title={`Step 3 — Configure: ${MOCK_TYPE_META[type].label}`} />
        <div className="stack">
          <Field label="Test name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>

          {type === 'sectional' || type === 'subject_full' ? (
            <Field label={type === 'subject_full' ? 'Subject' : 'Subjects'}>
              <div className="pill-row">
                {state.subjects.map((s) => (
                  <button key={s.id} type="button" className={cx('chip-filter', cfg.subjectIds.includes(s.id) && 'is-active')} onClick={() => toggle('subjectIds', s.id, type === 'subject_full')}>
                    {s.name}
                    <span className="chip-filter__count">{readyLabel(s.id)}</span>
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          {type === 'chapter' || type === 'topic' ? (
            <div className="picker">
              {state.subjects.map((s) => (
                <details key={s.id} className="picker__subject" open={state.subjects.length <= 4}>
                  <summary>{s.name}</summary>
                  {chaptersOf(state, s.id).map((c) =>
                    type === 'chapter' ? (
                      <Checkbox key={c.id} checked={cfg.chapterIds.includes(c.id)} onChange={() => toggle('chapterIds', c.id)} label={c.name} />
                    ) : (
                      <div key={c.id} className="picker__chapter">
                        <span className="picker__chapter-name">{c.name}</span>
                        {c.topics.map((t) => (
                          <Checkbox key={t.id} checked={cfg.topicIds.includes(t.id)} onChange={() => toggle('topicIds', t.id)} label={t.name} />
                        ))}
                      </div>
                    )
                  )}
                </details>
              ))}
            </div>
          ) : null}

          {usesDistribution ? (
            <Field label="Questions per subject" hint="Example only — adjust freely.">
              <div className="distribution">
                {distributionSubjects.map((id) => (
                  <label key={id} className="distribution__row">
                    <span>
                      {state.subjects.find((s) => s.id === id)?.name}
                      <span className="text-tertiary">{readyLabel(id)}</span>
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      value={cfg.distribution[id] ?? 0}
                      onChange={(e) => set('distribution', { ...cfg.distribution, [id]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
                    />
                  </label>
                ))}
                <div className="distribution__row distribution__total">
                  <span>Total</span>
                  <strong className="mono">{total}</strong>
                </div>
              </div>
            </Field>
          ) : (
            <Field label="Number of questions">
              <div className="row row--wrap" style={{ gap: 6 }}>
                {[10, 20, 30, 50].map((n) => (
                  <button key={n} type="button" className={cx('chip-filter', cfg.questionCount === n && 'is-active')} onClick={() => set('questionCount', n)}>
                    {n}
                  </button>
                ))}
                <Input type="number" min={1} max={300} style={{ width: 90 }} value={cfg.questionCount} onChange={(e) => set('questionCount', Math.max(1, Math.min(300, Number(e.target.value) || 1)))} aria-label="Custom question count" />
              </div>
            </Field>
          )}

          <div className="grid grid--3">
            <Field label="Duration (minutes)">
              <Input type="number" min={1} max={600} value={cfg.durationMinutes} onChange={(e) => set('durationMinutes', Math.max(1, Math.min(600, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Marks per question">
              <Input type="number" min={0} step={0.25} value={cfg.marksPerQuestion} onChange={(e) => set('marksPerQuestion', Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Negative marks (per wrong)">
              <Input type="number" min={0} step={0.25} value={cfg.negativeMarks} onChange={(e) => set('negativeMarks', Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>

          <div className="grid grid--2">
            <Field label="Question selection">
              <Select value={cfg.selectionMethod} onChange={(e) => set('selectionMethod', e.target.value as Config['selectionMethod'])}>
                <option value="random">Random</option>
                <option value="difficulty">By difficulty distribution</option>
                <option value="topic">Spread across topics</option>
              </Select>
            </Field>
            <Field label="Avoid questions attempted in the last…">
              <Select value={cfg.avoidRecentDays} onChange={(e) => set('avoidRecentDays', Number(e.target.value))}>
                <option value={0}>Don’t avoid</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </Select>
            </Field>
          </div>
          {cfg.selectionMethod === 'difficulty' ? (
            <div className="grid grid--3">
              {(['easy', 'medium', 'hard'] as const).map((lvl) => (
                <Field key={lvl} label={`${lvl[0].toUpperCase()}${lvl.slice(1)} %`}>
                  <Input type="number" min={0} max={100} value={cfg.difficultyDistribution[lvl]} onChange={(e) => set('difficultyDistribution', { ...cfg.difficultyDistribution, [lvl]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                </Field>
              ))}
            </div>
          ) : null}
          <Toggle checked={cfg.shuffleQuestions} onChange={(v) => set('shuffleQuestions', v)} label="Shuffle question order" />
          <Toggle checked={cfg.shuffleOptions} onChange={(v) => set('shuffleOptions', v)} label="Shuffle option order" />
          <Field label="Instructions" hint="Shown before the test starts (optional).">
            <Textarea rows={2} value={cfg.instructions} onChange={(e) => set('instructions', e.target.value)} />
          </Field>
          <Checkbox checked={template} onChange={setTemplate} label="Also save these settings as a reusable template" />
          {error ? <div className="callout callout--danger" role="alert">{error}</div> : null}
          <div className="row row--between">
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>
              Back
            </Button>
            <div className="row" style={{ gap: 8 }}>
              <Button disabled={busy || !preview?.ok || name.trim().length < 2} onClick={() => create(false)}>
                Save test
              </Button>
              <Button variant="primary" icon={<Play size={14} />} loading={busy} disabled={!preview?.ok || name.trim().length < 2} onClick={() => create(true)}>
                Create & start
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Availability in the question hub" subtitle="Only ready questions (with a trusted answer) are used" />
        {localProblems.length ? (
          <ul className="plain-list">
            {localProblems.map((p) => (
              <li key={p} className="text-warning">
                {p}
              </li>
            ))}
          </ul>
        ) : previewError ? (
          <div className="callout callout--danger">{previewError}</div>
        ) : !preview ? (
          <p className="text-tertiary">Checking…</p>
        ) : (
          <div className="stack stack--sm">
            {preview.buckets.map((b) => {
              const short = b.available < b.requested || b.detail?.some((d) => d.available < d.requested)
              return (
                <div key={b.key} className="avail-row">
                  <div className="row row--between">
                    <strong className="truncate">{b.label}</strong>
                    <Badge tone={short ? 'danger' : 'success'} size="sm">
                      {b.available} available / {b.requested} needed
                    </Badge>
                  </div>
                  {b.detail ? (
                    <p className="text-tertiary" style={{ fontSize: 12 }}>
                      {b.detail.map((d) => `${d.level}: ${d.available}/${d.requested}`).join(' · ')}
                    </p>
                  ) : null}
                </div>
              )
            })}
            {preview.ok ? (
              <div className="callout callout--success">
                <Check size={14} />
                <span>
                  Ready: {preview.total} questions · {cfg.durationMinutes} min
                </span>
              </div>
            ) : (
              <div className="callout callout--warning">
                <AlertTriangle size={14} />
                <span>
                  Not enough ready questions. Reduce the count, change the selection, or upload more question papers for this subject — a short test is never created
                  silently.
                </span>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
