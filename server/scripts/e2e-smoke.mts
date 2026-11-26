// End-to-end smoke against a running `npm run dev` (http://localhost:3000, via the Vite proxy).
// Not part of `npm test`; run with: npm --prefix server run e2e:smoke
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildFreshState } from '../../src/data/seed.ts'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
let cookie = ''
let token = ''
const email = `e2e${Date.now()}@example.com`
const password = 'E2e-password-123'

async function call(path: string, init: { method?: string; body?: unknown; csrf?: boolean; form?: FormData } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.csrf ? { 'X-StudyOS-CSRF': '1' } : {})
    },
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined)
  })
  const set = res.headers.get('set-cookie')
  if (set?.startsWith('studyos_rt=')) cookie = set.split(';')[0]
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`)
  return json
}
const step = (s: string) => console.log('✓', s)

await call('/api/auth/register', { body: { name: 'E2E Student', email, password, confirmPassword: password, acceptTerms: true } })
const mail = await call('/api/dev/mailbox')
const link = mail.messages.find((m: { to: string; tag: string }) => m.to === email && m.tag === 'verify-email').link
await call('/api/auth/verify-email', { body: { token: new URL(link).searchParams.get('token') } })
step('registered + verified via dev mailbox')
token = (await call('/api/auth/login', { body: { email, password } })).accessToken
token = (await call('/api/auth/refresh', { method: 'POST', csrf: true })).accessToken
step('login + refresh (HttpOnly cookie through proxy, CSRF header)')

const data = buildFreshState({ name: 'E2E Student', email })
await call('/api/workspace', { body: { origin: 'fresh', data } })
const ws = await call('/api/workspace')
step(`workspace created (revision ${ws.revision}, ${ws.data.subjects.length} subjects)`)

await call('/api/schedule/publish', { body: { slots: data.schedule, changeReason: 'Initial schedule' } })
const sched = await call('/api/schedule')
step(`baseline schedule v${sched.latest.version} with ${sched.latest.slots.length} slots, ${sched.usage.remaining} changes left`)

const math = data.chapters.find((c) => c.subjectId === data.subjects[0].id)!
const c1 = (await call('/api/cycles/start', { body: {} })).cycle
const b = c1.blocks[0]
await call(`/api/cycles/blocks/${b._id}/start-learning`, { method: 'POST' })
await call(`/api/cycles/blocks/${b._id}/complete-learning`, { body: { entries: [{ topicId: math.topics[0].id, completion: 'completed' }] } })
await call(`/api/cycles/${c1._id}/end`, { body: { reason: 'smoke test' } })
const c2 = (await call('/api/cycles/start', { body: {} })).cycle
if (c2.blocks[0].tasks[0]?.topicId !== math.topics[0].id) throw new Error('cycle 2 revision task missing')
step(`cycle 2 revises "${c2.blocks[0].tasks[0].topicName}" before new learning`)

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
const page = pdf.addPage([595, 842])
;['1. What is 10% of 200?', '(a) 10 (b) 20 (c) 30 (d) 40', '2. What is 25% of 80?', '(a) 20 (b) 25 (c) 30 (d) 40', 'Answer Key', '1. (b) 2. (a)'].forEach((l, i) =>
  page.drawText(l, { x: 50, y: 800 - i * 18, size: 11, font })
)
const form = new FormData()
form.append('subjectIds', data.subjects[0].id)
form.append('file', new Blob([await pdf.save()], { type: 'application/pdf' }), 'pct.pdf')
const doc = (await call('/api/documents', { form })).document
let d = doc
for (let i = 0; i < 20 && ['queued', 'processing'].includes(d.status); i += 1) {
  await new Promise((r) => setTimeout(r, 1000))
  d = (await call(`/api/documents/${doc._id}`)).document
}
if (d.status !== 'completed') throw new Error(`document ${d.status}: ${d.error}`)
const qs = (await call(`/api/questions?documentId=${doc._id}`)).items
await call('/api/questions/bulk', { body: { ids: qs.map((q: { _id: string }) => q._id), action: 'verify' } })
step(`PDF processed by the background worker: ${qs.length} questions, answers from key: ${qs.map((q: { correctAnswer: string[] }) => q.correctAnswer).join(' ')}`)

const test = (await call('/api/mock-tests', { body: { name: 'Smoke test', type: 'subject_full', config: { subjectIds: [data.subjects[0].id], questionCount: 2, durationMinutes: 5 } } })).test
const { attemptId } = await call('/api/attempts', { body: { mockTestId: test._id } })
const view = (await call(`/api/attempts/${attemptId}`)).attempt
await call(`/api/attempts/${attemptId}/answers`, { method: 'PUT', body: { answers: view.questions.map((q: { questionId: string }) => ({ questionId: q.questionId, selected: ['B'] })) } })
const result = (await call(`/api/attempts/${attemptId}/submit`, { method: 'POST' })).attempt.result
step(`exam submitted: ${result.correct} correct, ${result.incorrect} incorrect, ${result.marks}/${result.maxMarks}`)

const signed = await call(`/api/documents/${doc._id}/file-url`, { method: 'POST' })
const fileRes = await fetch(BASE + signed.url)
step(`signed PDF URL served ${fileRes.status} ${fileRes.headers.get('content-type')}`)

await call('/api/auth/logout', { method: 'POST', csrf: true })
const after = await fetch(BASE + '/api/auth/refresh', { method: 'POST', headers: { Cookie: cookie, 'X-StudyOS-CSRF': '1' } })
step(`logout revoked refresh (${after.status})`)
console.log('E2E SMOKE PASSED')
