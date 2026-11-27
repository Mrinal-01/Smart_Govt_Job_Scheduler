import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileText, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, LoadingBlock, Progress, StatCard, Tabs } from '../../components/ui'
import { useStudy } from '../../store/StudyStore'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/http'
import { QuestionEditor, SourcePageButton, TaxonomyFields, fmtBytes, type BankQuestion, type QuestionStatus, type UploadedDoc } from './shared'

type Filter = 'all' | QuestionStatus

export function ProcessingStatus({ doc }: { doc: UploadedDoc }) {
  const running = doc.status === 'queued' || doc.status === 'processing'
  return (
    <div className="stack stack--sm">
      <div className="row row--between">
        <span className="row" style={{ gap: 6 }}>
          {doc.status === 'completed' ? <CheckCircle2 size={15} className="text-success" /> : doc.status === 'failed' ? <AlertTriangle size={15} className="text-danger" /> : <RefreshCw size={15} className="spin" />}
          <strong>{doc.status === 'completed' ? 'Processing complete' : doc.status === 'failed' ? 'Processing failed' : `Processing — ${doc.stage}`}</strong>
        </span>
        <span className="mono text-tertiary">{doc.progress}%</span>
      </div>
      <Progress value={doc.progress} tone={doc.status === 'failed' ? 'danger' : doc.status === 'completed' ? 'success' : 'accent'} />
      {running ? <p className="text-tertiary" style={{ fontSize: 12 }}>You can leave this page — processing continues on the server.</p> : null}
    </div>
  )
}

export default function DocumentReviewPage() {
  const { documentId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { notify } = useStudy()
  const { config } = useAuth()
  const aiConfigured = Boolean(config?.ai.configured)
  const [doc, setDoc] = useState<UploadedDoc | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTax, setBulkTax] = useState<{ subjectId: string | null; chapterId: string | null; topicId: string | null }>({ subjectId: null, chapterId: null, topicId: null })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadDoc = useCallback(async () => {
    const r = await api<{ document: UploadedDoc; questionCounts: Record<string, number> }>(`/api/documents/${documentId}`)
    setDoc(r.document)
    setCounts(r.questionCounts)
    return r.document
  }, [documentId])

  const loadQuestions = useCallback(async () => {
    const r = await api<{ items: BankQuestion[] }>(`/api/questions?documentId=${documentId}&limit=200`)
    setQuestions(r.items)
  }, [documentId])

  useEffect(() => {
    let timer: number | undefined
    let stopped = false
    const tick = async () => {
      try {
        const d = await loadDoc()
        if (d.status === 'queued' || d.status === 'processing') {
          if (!stopped) timer = window.setTimeout(tick, 1500)
        } else await loadQuestions()
      } catch (err) {
        setError(errorMessage(err))
      }
    }
    void tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [loadDoc, loadQuestions])

  // While AI is answering this PDF's questions in the background, refresh every 10 s.
  const waiting = (counts.pending_answer ?? 0) > 0
  useEffect(() => {
    if (!waiting || !aiConfigured || doc?.status !== 'completed') return
    const t = window.setInterval(() => {
      void loadDoc().then(loadQuestions).catch(() => undefined)
    }, 10_000)
    return () => window.clearInterval(t)
  }, [waiting, aiConfigured, doc?.status, loadDoc, loadQuestions])

  const visible = useMemo(() => (questions ?? []).filter((q) => filter === 'all' || q.status === filter), [questions, filter])

  const onSaved = (q: BankQuestion) => {
    setQuestions((qs) => qs?.map((x) => (x._id === q._id ? q : x)) ?? null)
    void loadDoc()
  }

  const bulk = async (action: 'confirm' | 'reject' | 'assign') => {
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; failed: number; results: Array<{ ok: boolean; error?: string }> }>('/api/questions/bulk', {
        method: 'POST',
        body: { ids: Array.from(selected), action, ...(action === 'assign' ? { assign: bulkTax } : {}) }
      })
      const firstError = r.results.find((x) => !x.ok)?.error
      notify({
        title: `${r.succeeded} updated${r.failed ? `, ${r.failed} need attention` : ''}`,
        message: firstError,
        variant: r.failed ? 'warning' : 'success'
      })
      setSelected(new Set())
      await Promise.all([loadQuestions(), loadDoc()])
    } catch (err) {
      notify({ title: 'Bulk action failed', message: errorMessage(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const reprocess = async () => {
    try {
      await api(`/api/documents/${documentId}/reprocess`, { method: 'POST' })
      window.location.reload()
    } catch (err) {
      notify({ title: 'Could not reprocess', message: errorMessage(err), variant: 'error' })
    }
  }

  if (error && !doc) return <main className="page"><div className="callout callout--danger">{error}</div></main>
  if (!doc) return <main className="page"><LoadingBlock label="Loading document…" /></main>

  const ready = counts.ready ?? 0
  const returnType = params.get('type')
  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <Link to="/tests" className="back-link">
            <ArrowLeft size={13} /> Test builder
          </Link>
          <h1>{doc.originalName}</h1>
          <p className="page-head__sub">
            {doc.pageCount} pages · {fmtBytes(doc.sizeBytes)} · uploaded {new Date(doc.createdAt).toLocaleString()}
            {doc.intent.subjectNames?.length ? ` · ${doc.intent.subjectNames.join(', ')}` : ''}. Questions go into the shared question hub: ones with an answer key are{' '}
            <strong>ready</strong> right away, the rest are answered by AI in the background, and unclear ones wait for your review.
          </p>
        </div>
        <div className="page-head__actions">
          <SourcePageButton documentId={doc._id} page={1} label="View PDF" />
          {doc.status === 'completed' || doc.status === 'failed' ? (
            <Button icon={<RefreshCw size={13} />} onClick={reprocess}>
              Reprocess
            </Button>
          ) : null}
          <Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <Button variant="primary" iconRight={<ArrowRight size={14} />} disabled={!ready} onClick={() => navigate(`/tests/new?step=configure${returnType ? `&type=${returnType}` : ''}`)}>
            Configure a test
          </Button>
        </div>
      </div>

      <Card className="section">
        <ProcessingStatus doc={doc} />
        {doc.error ? (
          <div className="callout callout--danger" style={{ marginTop: 12 }}>
            <AlertTriangle size={14} />
            <span>{doc.error}</span>
          </div>
        ) : null}
        {doc.aiNote ? <div className="callout callout--neutral" style={{ marginTop: 12 }}>{doc.aiNote}</div> : null}
        {doc.status === 'completed' && doc.stats.ocrUnavailablePages ? (
          <div className="callout callout--warning" style={{ marginTop: 12 }}>
            <AlertTriangle size={14} />
            <span>{doc.stats.ocrUnavailablePages} page(s) had no text layer and OCR is not installed on the server — questions on those pages were not extracted.</span>
          </div>
        ) : null}
      </Card>

      {doc.status === 'completed' ? (
        <div className="grid grid--4 section">
          <StatCard label="Questions found" value={doc.stats.questionsFound} icon={<FileText size={15} />} hint={`${doc.stats.textPages} text · ${doc.stats.ocrPages} OCR pages`} />
          <StatCard label="Ready for tests" value={ready} hint={doc.stats.answerKeyFound ? 'Answer key found in the PDF' : 'No answer key — AI answers them'} tone="success" />
          <StatCard
            label="Waiting for AI"
            value={counts.pending_answer ?? 0}
            hint={aiConfigured ? 'Answered in the background' : 'AI is off — answered once OPENAI_API_KEY is added'}
            tone="accent"
          />
          <StatCard label="Need review" value={counts.needs_review ?? 0} hint={`${doc.stats.inserted} new · ${doc.stats.duplicates} already in the hub`} tone="warning" />
        </div>
      ) : null}

      {questions ? (
        <Card pad={false}>
          <div className="review-toolbar">
            <Tabs<Filter>
              value={filter}
              onChange={setFilter}
              tabs={[
                { value: 'all', label: 'All', count: questions.length },
                { value: 'ready', label: 'Ready', count: ready },
                { value: 'pending_answer', label: 'Waiting for AI', count: counts.pending_answer ?? 0 },
                { value: 'needs_review', label: 'Needs review', count: counts.needs_review ?? 0 },
                { value: 'rejected', label: 'Rejected', count: counts.rejected ?? 0 }
              ]}
            />
            <div className="row row--wrap" style={{ gap: 8 }}>
              <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={visible.some((q) => q.mine) && visible.filter((q) => q.mine).every((q) => selected.has(q._id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.filter((q) => q.mine).map((q) => q._id)) : new Set())}
                />
                Select all shown
              </label>
              <Badge>{selected.size} selected</Badge>
              <Button size="sm" variant="success" icon={<ShieldCheck size={13} />} disabled={!selected.size || busy} onClick={() => bulk('confirm')} title="Use in tests (no answer → sent to AI)">
                Confirm selected
              </Button>
              <Button size="sm" variant="ghost" disabled={!selected.size || busy} onClick={() => bulk('reject')}>
                Reject selected
              </Button>
            </div>
          </div>
          {selected.size ? (
            <div className="bulk-assign">
              <TaxonomyFields value={bulkTax} onChange={setBulkTax} compact />
              <Button size="sm" disabled={!bulkTax.subjectId || busy} onClick={() => bulk('assign')}>
                Assign to {selected.size} selected
              </Button>
            </div>
          ) : null}
          <div className="review-list">
            {visible.length ? (
              visible.map((q) => (
                <QuestionEditor
                  key={q._id}
                  question={q}
                  onSaved={onSaved}
                  aiConfigured={aiConfigured}
                  selectable
                  selected={selected.has(q._id)}
                  onSelect={(v) =>
                    setSelected((s) => {
                      const n = new Set(s)
                      if (v) n.add(q._id)
                      else n.delete(q._id)
                      return n
                    })
                  }
                />
              ))
            ) : (
              <EmptyState compact title={questions.length ? 'No questions in this filter' : 'No questions were detected'} message={questions.length ? undefined : 'Check the PDF format, or add questions manually in the Question Hub.'} />
            )}
          </div>
        </Card>
      ) : doc.status === 'completed' ? (
        <LoadingBlock label="Loading questions…" />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this PDF?"
        message="The stored file is deleted, along with its questions that are not ready yet. Ready questions stay in the shared hub — other students may already use them."
        confirmLabel="Delete PDF"
        onConfirm={async () => {
          try {
            await api(`/api/documents/${documentId}`, { method: 'DELETE' })
            navigate('/tests')
          } catch (err) {
            notify({ title: 'Delete failed', message: errorMessage(err), variant: 'error' })
          }
        }}
      />
    </main>
  )
}
