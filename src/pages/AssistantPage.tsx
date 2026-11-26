import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUp,
  Brain,
  ClipboardList,
  FileText,
  Lightbulb,
  Lock,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  User
} from 'lucide-react'
import type { AIMode, AIMessage } from '../types'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Select, Textarea } from '../components/ui'
import { useStudy } from '../store/StudyStore'
import { dueRevisions, subjectProgress, topicMastery, allTopics } from '../store/selectors'
import { demoConversation, respond } from '../services/assistant'
import { cx } from '../lib/utils'
import { dateKey } from '../lib/date'

const MODES: Array<{ key: AIMode; label: string; desc: string; icon: React.ReactNode }> = [
  { key: 'assistant', label: 'Study assistant', desc: 'Concept doubts & explanations', icon: <MessageSquare size={14} /> },
  { key: 'quiz', label: 'Quiz generator', desc: 'Topic MCQs, 3 difficulties', icon: <ClipboardList size={14} /> },
  { key: 'weak-topics', label: 'Weak topic analysis', desc: 'Find what to fix first', icon: <TrendingDown size={14} /> },
  { key: 'smart-revision', label: 'Smart revision', desc: 'Prioritised revision plan', icon: <RotateCcw size={14} /> },
  { key: 'weekly-report', label: 'Weekly report', desc: 'Progress + next-week plan', icon: <FileText size={14} /> }
]

const STARTERS: Record<AIMode, string[]> = {
  assistant: ['What should I revise today?', 'Which chapters are weakest?', 'Explain my last mistake'],
  quiz: ['Generate a quiz on Profit & Loss', 'Generate a quiz on Ohm’s Law', 'Generate a quiz on Syllogism'],
  'weak-topics': ['Show my weakest topics', 'Which subject needs attention?', 'Where do I lose the most marks?'],
  'smart-revision': ['Build a revision plan', 'What should I revise today?', 'Plan tomorrow for me'],
  'weekly-report': ['Weekly report', 'How consistent was my week?', 'What should I change next week?']
}

export default function AssistantPage() {
  const { state, appendAIMessage, clearAIMessages, today } = useStudy()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AIMode>('assistant')
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const messages: AIMessage[] = useMemo(() => {
    if (state.aiMessages.length) return state.aiMessages
    return demoConversation(state)
  }, [state])

  const due = useMemo(() => dueRevisions(state, today), [state, today])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, thinking])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinking) return
    appendAIMessage({ role: 'user', mode, content: trimmed, demo: true })
    setInput('')
    setThinking(true)
    window.setTimeout(() => {
      const reply = respond(mode, trimmed, state)
      appendAIMessage({ role: 'assistant', mode, content: reply.content, demo: true, suggestions: reply.suggestions })
      setThinking(false)
      window.setTimeout(() => inputRef.current?.focus(), 80)
    }, 620)
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>AI Study Assistant</h1>
          <p className="page-head__sub">
            Interface and service layer are ready for a secure Node.js + OpenAI backend. Every response here is generated locally by rules over your own
            study data — and labelled as demo. No API key ever touches the browser.
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="secondary" icon={<Trash2 size={14} />} onClick={clearAIMessages} disabled={!state.aiMessages.length}>
            Clear chat
          </Button>
        </div>
      </div>

      <div className="callout callout--warning section">
        <Lock size={14} />
        <div>
          <strong>Demo mode — no AI model is being called.</strong>
          <div style={{ marginTop: 3, lineHeight: 1.55 }}>
            Responses are computed from your local revision, topic and mistake records. To go live, the Express backend holds{' '}
            <code style={{ fontSize: 11 }}>OPENAI_API_KEY</code> and exposes the endpoints in <code style={{ fontSize: 11 }}>docs/API_CONTRACT.md</code>.
            Flip <code style={{ fontSize: 11 }}>USE_REMOTE_API</code> in <code style={{ fontSize: 11 }}>src/services/api.ts</code> and nothing else
            changes.
          </div>
        </div>
      </div>

      <div className="ai-layout">
        <div className="stack" style={{ gap: 12 }}>
          <Card pad={false}>
            <div style={{ padding: 8 }}>
              {MODES.map((m) => (
                <button key={m.key} className={cx('ai-mode', mode === m.key && 'is-active')} onClick={() => setMode(m.key)}>
                  <span className="ai-mode__title">
                    {m.icon}
                    {m.label}
                  </span>
                  <span className="ai-mode__desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Live context" subtitle="What the assistant can already read" icon={<Brain size={15} />} />
            <div className="stack" style={{ gap: 8, fontSize: 12 }}>
              <div className="row row--between">
                <span className="text-secondary">Revisions due</span>
                <strong className="mono">{due.length}</strong>
              </div>
              <div className="row row--between">
                <span className="text-secondary">Topics learnt</span>
                <strong className="mono">{allTopics(state).filter((t) => t.initialLearningDate).length}</strong>
              </div>
              <div className="row row--between">
                <span className="text-secondary">Mistakes open</span>
                <strong className="mono">{state.mistakes.filter((m) => m.status !== 'resolved').length}</strong>
              </div>
              <div className="row row--between">
                <span className="text-secondary">Mock attempts</span>
                <strong className="mono">{state.attempts.length}</strong>
              </div>
              <div className="divider" style={{ margin: '3px 0' }} />
              {state.subjects.map((s) => {
                const p = subjectProgress(state, s.id)
                return (
                  <div key={s.id} className="row row--between">
                    <span className="text-secondary">{s.shortName}</span>
                    <span className="mono text-tertiary" style={{ fontSize: 11 }}>
                      mastery {p.mastery}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Planned capabilities" icon={<Sparkles size={15} />} />
            <ul className="stack" style={{ gap: 7, fontSize: 11.5, color: 'var(--text-secondary)' }}>
              <li>• Explain concepts and resolve doubts</li>
              <li>• Explain each incorrect answer</li>
              <li>• Generate topic-wise MCQs (easy → hard)</li>
              <li>• Analyse mistakes into weak chapters</li>
              <li>• Recommend priority revisions</li>
              <li>• Produce a weekly progress report</li>
            </ul>
          </Card>
        </div>

        <div className="chat">
          <div className="chat__head">
            <span className="subject-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 28, height: 28 }}>
              <Sparkles size={14} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>
                {MODES.find((m) => m.key === mode)?.label}
              </p>
              <p className="text-tertiary" style={{ fontSize: 11 }}>
                Local rules · grounded in your study history
              </p>
            </div>
            <Badge tone="warning" size="sm" dot>
              demo data
            </Badge>
          </div>

          <div className="chat__scroll" ref={scrollRef}>
            {messages.length ? (
              messages.map((m) => <MessageBubble key={m.id} message={m} onSuggestion={send} />)
            ) : (
              <EmptyState
                compact
                icon={<Sparkles size={18} />}
                title="Start a conversation"
                message="Pick a mode on the left, then ask anything about your preparation."
              />
            )}
            {thinking ? (
              <div className="msg msg--assistant">
                <span className="msg__avatar">
                  <Sparkles size={13} />
                </span>
                <div className="msg__bubble">
                  <span className="typing">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="chat__suggestions">
            {STARTERS[mode].map((s) => (
              <button key={s} className="suggest-chip" onClick={() => send(s)} disabled={thinking}>
                {s}
              </button>
            ))}
          </div>

          <div className="chat__composer">
            <Textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder={`Ask about ${MODES.find((m) => m.key === mode)?.label.toLowerCase()}…`}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              style={{ minHeight: 38, maxHeight: 120 }}
            />
            <Button variant="primary" size="md" onClick={() => send(input)} disabled={!input.trim() || thinking} aria-label="Send message">
              <ArrowUp size={15} />
            </Button>
          </div>
        </div>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader title="Integration checklist for the backend" icon={<Target size={15} />} />
        <div className="grid grid--2" style={{ gap: 14 }}>
          <div className="stack" style={{ gap: 7, fontSize: 11.5 }}>
            <p className="field__label">Server responsibilities</p>
            <ul className="stack" style={{ gap: 5, color: 'var(--text-secondary)' }}>
              <li>1. Store the provider key only in server env (never client bundles).</li>
              <li>2. Authenticate the user and load their study context server-side.</li>
              <li>3. Cap tokens, rate-limit per user, log prompt + usage.</li>
              <li>4. Tag generated questions <code>origin: "ai-generated"</code>.</li>
              <li>5. Never claim generated MCQs are official previous-year papers.</li>
            </ul>
          </div>
          <div className="stack" style={{ gap: 7, fontSize: 11.5 }}>
            <p className="field__label">Endpoints the UI expects</p>
            <ul className="stack" style={{ gap: 5, color: 'var(--text-secondary)' }}>
              <li><code>POST /api/v1/ai/chat</code> · mode, message, context</li>
              <li><code>POST /api/v1/ai/quiz</code> · subject, topic, difficulty, count</li>
              <li><code>GET /api/v1/ai/weak-topics</code></li>
              <li><code>GET /api/v1/ai/smart-revision</code></li>
              <li><code>GET /api/v1/ai/weekly-report</code></li>
            </ul>
          </div>
        </div>
        <div className="row row--wrap" style={{ gap: 7, marginTop: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => navigate('/subjects')} icon={<Lightbulb size={12} />}>
            Browse curriculum
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/mistakes')} icon={<ClipboardList size={12} />}>
            Open mistake bank
          </Button>
        </div>
      </Card>
    </main>
  )
}

/* ------------------------------------------------------------------ */

function MessageBubble({ message, onSuggestion }: { message: AIMessage; onSuggestion: (s: string) => void }) {
  const isUser = message.role === 'user'
  return (
    <div className={cx('msg', isUser ? 'msg--user' : 'msg--assistant')}>
      <span className="msg__avatar">{isUser ? <User size={13} /> : <Sparkles size={13} />}</span>
      <div style={{ minWidth: 0 }}>
        <div className="msg__bubble">
          <Markdown text={message.content} />
        </div>
        <div className="msg__foot">
          {message.demo ? <Badge tone="warning" size="sm">demo</Badge> : null}
          <span>{new Date(message.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {!isUser && message.suggestions?.length ? (
          <div className="row row--wrap" style={{ gap: 5, marginTop: 6 }}>
            {message.suggestions.map((s) => (
              <button key={s} className="suggest-chip" onClick={() => onSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Minimal markdown renderer: headings, bullets, bold, code, fenced blocks. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split('\n')
  const out: React.ReactNode[] = []
  let list: string[] = []
  let code: string[] | null = null

  const flushList = () => {
    if (!list.length) return
    out.push(
      <ul key={`ul-${out.length}`}>
        {list.map((li, i) => (
          <li key={i}>{inline(li.replace(/^[-•]\s*/, ''))}</li>
        ))}
      </ul>
    )
    list = []
  }

  blocks.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      if (code) {
        out.push(
          <pre key={`pre-${idx}`}>
            <code>{code.join('\n')}</code>
          </pre>
        )
        code = null
      } else {
        flushList()
        code = []
      }
      return
    }
    if (code) {
      code.push(line)
      return
    }
    if (/^#{1,4}\s/.test(line)) {
      flushList()
      out.push(<h3 key={`h-${idx}`}>{inline(line.replace(/^#{1,4}\s/, ''))}</h3>)
      return
    }
    if (/^[-•*]\s/.test(line.trim()) || /^\d+\.\s/.test(line.trim())) {
      list.push(line.trim())
      return
    }
    if (!line.trim()) {
      flushList()
      return
    }
    flushList()
    out.push(<p key={`p-${idx}`}>{inline(line)}</p>)
  })
  flushList()
  if (code) {
    out.push(
      <pre key="pre-final">
        <code>{(code as string[]).join('\n')}</code>
      </pre>
    )
  }
  return <>{out}</>
}

function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    else parts.push(<code key={key++}>{token.slice(1, -1)}</code>)
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

export { Field, Select, dateKey, topicMastery }
