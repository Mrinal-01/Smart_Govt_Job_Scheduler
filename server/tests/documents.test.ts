import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { runPendingJobs } from '../src/jobs/queue.js'
import { Question } from '../src/models/index.js'
import { setOcrProvider } from '../src/modules/documents/extraction/ocr.js'
import { app, auth, registerVerified, useTestDb, withWorkspace } from './helpers.js'
import { SCIENCE_PAPER, makeBlankPdf, makePdf } from './pdf.js'

useTestDb()

async function setup() {
  const { token } = await registerVerified()
  await withWorkspace(token)
  return token
}

const upload = (token: string, file: Buffer, name = 'paper.pdf', fields: Record<string, string> = {}) => {
  let req = request(app).post('/api/documents').set(auth(token))
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v)
  return req.attach('file', file, { filename: name, contentType: 'application/pdf' })
}

describe('PDF upload and extraction pipeline', () => {
  it('Workflow D: upload → processing → extracted questions with document answer key → verify', async () => {
    const token = await setup()
    const pdf = await makePdf(SCIENCE_PAPER)
    const up = await upload(token, pdf, 'science.pdf', { mockType: 'subject_full', subjectIds: 'sub_science' }).expect(201)
    const doc = up.body.document
    expect(doc.pageCount).toBe(2)
    expect(doc.status).toBe('queued')
    expect(doc).not.toHaveProperty('storageKey')

    expect(await runPendingJobs()).toBe(1)
    const status = await request(app).get(`/api/documents/${doc._id}`).set(auth(token)).expect(200)
    expect(status.body.document.status).toBe('completed')
    expect(status.body.document.progress).toBe(100)
    expect(status.body.document.stats).toMatchObject({ questionsFound: 5, inserted: 5, duplicates: 0, answerKeyFound: true, textPages: 2 })
    expect(status.body.document.aiNote).toMatch(/not configured/)

    const list = await request(app).get(`/api/questions?documentId=${doc._id}&limit=50`).set(auth(token)).expect(200)
    expect(list.body.total).toBe(5)
    const q1 = list.body.items[0]
    expect(q1.questionText).toBe('What is the SI unit of force?')
    expect(q1.source).toMatchObject({ pageNumber: 1, questionNumber: '1' })
    expect(q1.correctAnswer).toEqual(['B'])
    expect(q1.answerSource).toBe('document_key')
    expect(q1.subjectId).toBe('sub_science') // single subject intent
    expect(q1.status).toBe('extracted') // not verified until the student says so
    expect(q1.rawText).toContain('SI unit of force')
    const q5 = list.body.items.find((q: { source: { questionNumber: string } }) => q.source.questionNumber === '5')
    expect(q5.status).toBe('needs_review')
    expect(q5.correctAnswer).toBeNull()

    // review: q5 cannot be verified without options/type
    const cannot = await request(app).post(`/api/questions/${q5._id}/verify`).set(auth(token))
    expect(cannot.status).toBe(422)
    expect(cannot.body.error.code).toBe('CANNOT_VERIFY')
    await request(app).post(`/api/questions/${q5._id}/reject`).set(auth(token)).expect(200)

    // edit + verify q1 with chapter
    const edited = await request(app)
      .patch(`/api/questions/${q1._id}`)
      .set(auth(token))
      .send({ chapterId: 'ch_sci_force', difficulty: 'easy', explanation: 'F = ma, unit newton.' })
      .expect(200)
    expect(edited.body.question.chapterName).toBe('Force and Motion')
    const verified = await request(app).post(`/api/questions/${q1._id}/verify`).set(auth(token)).expect(200)
    expect(verified.body.question.status).toBe('verified')

    // invalid answer label is rejected
    const badAnswer = await request(app).patch(`/api/questions/${q1._id}`).set(auth(token)).send({ correctAnswer: ['E'] })
    expect(badAnswer.body.error.code).toBe('INVALID_ANSWER')

    // bulk verify the rest of the valid ones
    const ids = list.body.items.filter((q: { _id: string }) => q._id !== q1._id && q._id !== q5._id).map((q: { _id: string }) => q._id)
    const bulk = await request(app).post('/api/questions/bulk').set(auth(token)).send({ ids, action: 'verify' }).expect(200)
    expect(bulk.body.succeeded).toBe(3)
    const stats = await request(app).get('/api/questions/stats').set(auth(token)).expect(200)
    expect(stats.body.byStatus).toMatchObject({ verified: 4, rejected: 1 })
  })

  it('does not duplicate documents or questions when the same content is uploaded again', async () => {
    const token = await setup()
    const pdf = await makePdf(SCIENCE_PAPER)
    const first = await upload(token, pdf).expect(201)
    await runPendingJobs()
    const again = await upload(token, pdf).expect(200)
    expect(again.body.duplicate).toBe(true)
    expect(again.body.document._id).toBe(first.body.document._id)

    // A different file containing the same questions → questions deduplicated
    const variant = await makePdf([[...SCIENCE_PAPER[0], 'Extra footer line to change the file hash'], SCIENCE_PAPER[1]])
    const second = await upload(token, variant, 'variant.pdf').expect(201)
    await runPendingJobs()
    const doc2 = await request(app).get(`/api/documents/${second.body.document._id}`).set(auth(token)).expect(200)
    expect(doc2.body.document.stats.duplicates).toBeGreaterThanOrEqual(4)
    expect(await Question.countDocuments({})).toBeLessThanOrEqual(6)
  })

  it('validates uploads: type, magic bytes and missing file', async () => {
    const token = await setup()
    const notPdf = await request(app).post('/api/documents').set(auth(token)).attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
    expect(notPdf.status).toBe(415)
    const fake = await upload(token, Buffer.from('not really a pdf'), 'fake.pdf')
    expect(fake.status).toBe(415)
    const none = await request(app).post('/api/documents').set(auth(token)).field('mockType', 'topic')
    expect(none.status).toBe(400)
    const brokenPdf = await upload(token, Buffer.from('%PDF-1.4 garbage'), 'broken.pdf')
    expect(brokenPdf.status).toBe(422)
  })

  it('reports scanned PDFs honestly when OCR is unavailable', async () => {
    const token = await setup()
    const up = await upload(token, await makeBlankPdf(2), 'scan.pdf').expect(201)
    await runPendingJobs()
    const doc = (await request(app).get(`/api/documents/${up.body.document._id}`).set(auth(token)).expect(200)).body.document
    expect(doc.status).toBe('failed')
    expect(doc.error).toMatch(/OCR is not installed/)
    expect(doc.pages.every((p: { method: string }) => p.method === 'ocr_unavailable')).toBe(true)
  })

  it('falls back to the OCR provider for pages without a text layer', async () => {
    const token = await setup()
    const seen: number[] = []
    setOcrProvider({
      name: 'fake-ocr',
      available: async () => true,
      recognizePage: async (_path, page) => {
        seen.push(page)
        return '1. Which gas do plants absorb?\n(a) Oxygen (b) Carbon dioxide (c) Nitrogen (d) Helium'
      }
    })
    try {
      const up = await upload(token, await makeBlankPdf(1), 'scan.pdf').expect(201)
      await runPendingJobs()
      const doc = (await request(app).get(`/api/documents/${up.body.document._id}`).set(auth(token)).expect(200)).body.document
      expect(seen).toEqual([1])
      expect(doc.status).toBe('completed')
      expect(doc.pages[0].method).toBe('ocr')
      expect(doc.stats).toMatchObject({ ocrPages: 1, questionsFound: 1 })
      const q = (await request(app).get(`/api/questions?documentId=${doc._id}`).set(auth(token))).body.items[0]
      expect(q.options.map((o: { text: string }) => o.text)).toEqual(['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'])
      expect(q.correctAnswer).toBeNull()
    } finally {
      setOcrProvider(null)
    }
  })

  it('serves the private PDF only through a valid, unexpired signed URL', async () => {
    const token = await setup()
    const up = await upload(token, await makePdf(SCIENCE_PAPER)).expect(201)
    const signed = await request(app).post(`/api/documents/${up.body.document._id}/file-url`).set(auth(token)).expect(200)
    const ok = await request(app).get(signed.body.url).buffer(true).expect(200)
    expect(ok.headers['content-type']).toBe('application/pdf')
    expect(ok.headers['cache-control']).toContain('no-store')
    await request(app).get(signed.body.url.replace(/sig=[^&]+/, 'sig=tampered-signature')).expect(403)
    await request(app).get(signed.body.url.replace(/exp=\d+/, 'exp=1000')).expect(403)
    await request(app).get(`/api/files/${up.body.document._id}`).expect(400)
  })
})
