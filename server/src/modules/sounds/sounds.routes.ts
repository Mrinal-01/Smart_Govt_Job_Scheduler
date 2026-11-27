import { Router } from 'express'
import multer from 'multer'
import { Types } from 'mongoose'
import { z } from 'zod'
import { AppError, asyncHandler, badRequest, conflict, notFound } from '../../lib/errors.js'
import { objectId, parse } from '../../lib/validate.js'
import { authOf, requireAuth } from '../../middleware/auth.js'
import { CustomSound } from '../../models/index.js'
import { soundKeyFor, storage } from '../../integrations/storage.js'

/*
 * /api/sounds — the student's own reminder sounds (max 10, 2 MB each).
 * Files live in private storage and are streamed only to their owner.
 */
export const soundRouter = Router()
soundRouter.use(requireAuth)

export const MAX_CUSTOM_SOUNDS = 10
const MAX_BYTES = 2 * 1024 * 1024

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' }

/** Identifies the real format from the file's first bytes; the browser-supplied type is not trusted. */
function sniffFormat(buf: Buffer): keyof typeof MIME | null {
  if (buf.length < 12) return null
  const ascii = (a: number, b: number) => buf.subarray(a, b).toString('latin1')
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(4, 8) === 'ftyp') return 'm4a'
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  return null
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|webm)$/i.test(file.originalname)) {
      return cb(new AppError(415, 'UNSUPPORTED_FILE', 'Upload an audio file (MP3, WAV, OGG, M4A or WebM).'))
    }
    cb(null, true)
  }
})

const serialize = (s: { _id: unknown; name: string; format: string; sizeBytes: number; createdAt?: Date }) => ({
  id: String(s._id),
  name: s.name,
  format: s.format,
  sizeBytes: s.sizeBytes,
  createdAt: s.createdAt
})

soundRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const sounds = await CustomSound.find({ userId: authOf(req).userId }).sort({ createdAt: 1 }).lean()
    res.json({ sounds: sounds.map(serialize), limit: MAX_CUSTOM_SOUNDS, maxBytes: MAX_BYTES })
  })
)

soundRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { userId } = authOf(req)
    const file = req.file
    if (!file) throw badRequest('Attach an audio file in the "file" field.')
    const { name } = parse(
      z.object({ name: z.string().trim().min(1, 'Give the sound a name').max(60, 'Name must be 60 characters or fewer') }),
      req.body ?? {}
    )
    const format = sniffFormat(file.buffer)
    if (!format) throw new AppError(415, 'UNSUPPORTED_FILE', 'This file is not a supported audio format (MP3, WAV, OGG, M4A or WebM).')
    if ((await CustomSound.countDocuments({ userId })) >= MAX_CUSTOM_SOUNDS) {
      throw conflict(`You can keep up to ${MAX_CUSTOM_SOUNDS} sounds. Delete one to upload another.`, 'SOUND_LIMIT')
    }
    const id = new Types.ObjectId()
    const storageKey = soundKeyFor(String(userId), String(id), format)
    await storage.put(storageKey, file.buffer)
    const doc = await CustomSound.create({ _id: id, userId, name, format, mimeType: MIME[format], sizeBytes: file.size, storageKey })
    // Two uploads racing past the count check: keep the limit by removing the newest extra.
    if ((await CustomSound.countDocuments({ userId })) > MAX_CUSTOM_SOUNDS) {
      await CustomSound.deleteOne({ _id: id })
      await storage.remove(storageKey)
      throw conflict(`You can keep up to ${MAX_CUSTOM_SOUNDS} sounds. Delete one to upload another.`, 'SOUND_LIMIT')
    }
    res.status(201).json({ sound: serialize(doc.toObject()) })
  })
)

soundRouter.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const sound = await CustomSound.findOne({ _id: parse(objectId, req.params.id), userId: authOf(req).userId }).lean()
    if (!sound) throw notFound('Sound')
    res.setHeader('Content-Type', sound.mimeType)
    res.setHeader('Content-Length', String(sound.sizeBytes))
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    storage.stream(sound.storageKey).on('error', () => res.destroy()).pipe(res)
  })
)

soundRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const sound = await CustomSound.findOneAndDelete({ _id: parse(objectId, req.params.id), userId: authOf(req).userId }).lean()
    if (!sound) throw notFound('Sound')
    await storage.remove(sound.storageKey)
    res.status(204).end()
  })
)
