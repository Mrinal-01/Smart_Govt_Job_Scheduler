import { useEffect, useRef, useState } from 'react'
import { Send, ShieldAlert, Sparkles } from 'lucide-react'
import { Button, Card, Textarea } from '../components/ui'
import { ApiError, api, errorMessage } from '../lib/http'
import { cx } from '../lib/utils'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** false = the server refused it as out of scope */
  allowed?: boolean
}
interface AiStatus {
  configured: boolean
  enabledForUser: boolean
  usage: { used: number; limit: number; remaining: number }
}

/** Shown only while AI is switched off, so the page explains itself. Clearly labelled as an example. */
const EXAMPLE: Turn[] = [
  { role: 'user', content: 'Solve: A train 150 m long crosses a pole in 15 s. Find its speed in km/h.' },
  {
    role: 'assistant',
    allowed: true,
    content:
      '**Method**\n- Crossing a pole means the train covers its own length.\n- Speed = distance ÷ time = 150 m ÷ 15 s = **10 m/s**.\n- Convert to km/h: 10 × 18/5 = **36 km/h**.\n\n**Answer:** 36 km/h'
  },
  { role: 'user', content: 'What should I revise today?' },
  {
    role: 'assistant',
    allowed: true,
    content: 'From your plan: revise **Reasoning** (Analogy, Classification) before its first session, then **Physical Science** (Units and Measurements). Mathematics is already done for today.'
  },
  { role: 'user', content: 'Tell me a joke about cricket' },
  {
    role: 'assistant',
    allowed: false,
    content: 'I can only help with your studies: explaining topics, solving exam questions, your study schedule and revision, and exam strategy. Please ask something related to your preparation.'
  }
]

const SUGGESTIONS = [
  'Explain HCF and LCM with a simple example',
  'Solve: A train 150 m long crosses a pole in 15 s. Find its speed in km/h.',
  'What should I revise today?',
  'How should I split time between subjects this week?'
]

/** Light Markdown: paragraphs, bullet lines and **bold** — enough for tutor answers, no HTML injection. */
function Rich({ text }: { text: string }) {
  const bold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>))
  return (
    <>
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split('\n')
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{bold(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {bold(l.replace(/^#+\s*/, ''))}
                {j < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        )
      })}
    </>
  )
}

export default function AiHelpPage() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<AiStatus>('/api/ai/status')
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)))
  }, [])
  // Block body on purpose: newer Chromium (Brave) returns a Promise from scrollIntoView, and an effect
  // must not return anything but a cleanup function.
  useEffect(() => {
    if (turns.length || busy) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  const ready = Boolean(status?.configured && status.enabledForUser)

  const ask = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    if (message.length > 2000) return setError('Keep your question under 2000 characters.')
    setError('')
    const history = turns.filter((t) => t.allowed !== false).map(({ role, content }) => ({ role, content }))
    setTurns((t) => [...t, { role: 'user', content: message }])
    setDraft('')
    setBusy(true)
    try {
      const r = await api<{ allowed: boolean; content: string }>('/api/ai/ask', { method: 'POST', body: { message, history } })
      setTurns((t) => [...t, { role: 'assistant', content: r.content, allowed: r.allowed }])
      setStatus((s) => (s ? { ...s, usage: { ...s.usage, used: s.usage.used + 1, remaining: Math.max(0, s.usage.remaining - 1) } } : s))
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'AI_DAILY_LIMIT' ? 'You have used today’s AI questions. It resets at midnight.' : errorMessage(err))
      setTurns((t) => t.slice(0, -1))
      setDraft(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>AI Help</h1>
          <p className="page-head__sub">Ask about a topic, a question you are stuck on, your schedule or what to revise. Study questions only.</p>
        </div>
        {status?.configured ? (
          <span className="text-tertiary" style={{ fontSize: 12 }}>
            {status.usage.remaining} of {status.usage.limit} questions left today
          </span>
        ) : null}
      </div>

      {status && !status.configured ? (
        <div className="callout callout--neutral section">
          <Sparkles size={14} />
          <span>AI Help is not switched on yet. It starts working as soon as the server’s OpenAI key is added (see docs/SETUP.md › AI).</span>
        </div>
      ) : null}
      {status && status.configured && !status.enabledForUser ? (
        <div className="callout callout--neutral section">
          <Sparkles size={14} />
          <span>You turned AI features off in Settings.</span>
        </div>
      ) : null}

      <Card className="ai-chat">
        <div className="ai-chat__log" aria-live="polite">
          {turns.length === 0 && status && !status.configured ? (
            <>
              <p className="ai-chat__example-label">Example — this is how AI Help answers once it is switched on</p>
              {EXAMPLE.map((t, i) => (
                <div key={i} className={cx('ai-msg', `ai-msg--${t.role}`, 'is-example', t.allowed === false && 'is-refused')}>
                  {t.allowed === false ? <ShieldAlert size={14} /> : null}
                  <div className="ai-msg__body">{t.role === 'assistant' ? <Rich text={t.content} /> : t.content}</div>
                </div>
              ))}
            </>
          ) : turns.length === 0 ? (
            <div className="ai-chat__empty">
              <p className="text-secondary">Try one of these:</p>
              <div className="pill-row">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip-filter" disabled={!ready || busy} onClick={() => void ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={cx('ai-msg', `ai-msg--${t.role}`, t.allowed === false && 'is-refused')}>
                {t.allowed === false ? <ShieldAlert size={14} /> : null}
                <div className="ai-msg__body">{t.role === 'assistant' ? <Rich text={t.content} /> : t.content}</div>
              </div>
            ))
          )}
          {busy ? <div className="ai-msg ai-msg--assistant text-tertiary">Thinking…</div> : null}
          <div ref={end} />
        </div>
        {error ? <div className="callout callout--danger" style={{ margin: '0 0 10px' }}>{error}</div> : null}
        <form
          className="ai-chat__input"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(draft)
          }}
        >
          <Textarea
            rows={2}
            value={draft}
            maxLength={2000}
            placeholder={ready ? 'Ask a study question…' : 'AI Help is not available yet'}
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(draft)
              }
            }}
          />
          <Button type="submit" variant="primary" icon={<Send size={14} />} loading={busy} disabled={!ready || !draft.trim()}>
            Ask
          </Button>
        </form>
      </Card>
    </main>
  )
}
