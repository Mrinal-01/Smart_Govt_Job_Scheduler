import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { env } from '../config/env.js'
import { hmac, safeEqual } from '../lib/crypto.js'

/**
 * Private object storage. The default driver writes to STORAGE_DIR, which is
 * outside every statically served directory; files are only reachable through
 * the authenticated signed-URL route. Swap for an S3/GCS driver by
 * implementing the same interface.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>
  read(key: string): Promise<Buffer>
  stream(key: string): NodeJS.ReadableStream
  absolutePath(key: string): string
  remove(key: string): Promise<void>
}

/** `<userId>/<docId>.pdf` for documents, `<userId>/sounds/<soundId>.<ext>` for alert sounds. */
const SAFE_KEY = /^[a-f0-9]{24}\/(?:[a-f0-9]{24}\.pdf|sounds\/[a-f0-9]{24}\.(?:mp3|wav|ogg|m4a|webm))$/

function resolveKey(key: string) {
  if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key')
  const full = path.resolve(env.storageDir, key)
  if (!full.startsWith(env.storageDir + path.sep)) throw new Error('Storage key escapes storage root')
  return full
}

export const localStorage: ObjectStorage = {
  async put(key, data) {
    const full = resolveKey(key)
    await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 })
    await fs.writeFile(full, data, { mode: 0o600 })
  },
  read: (key) => fs.readFile(resolveKey(key)),
  stream: (key) => createReadStream(resolveKey(key)),
  absolutePath: (key) => resolveKey(key),
  async remove(key) {
    await fs.rm(resolveKey(key), { force: true })
  }
}

export const storage: ObjectStorage = localStorage

export const storageKeyFor = (userId: string, documentId: string) => `${userId}/${documentId}.pdf`
export const soundKeyFor = (userId: string, soundId: string, ext: string) => `${userId}/sounds/${soundId}.${ext}`

/* ------------------------------------------------------------------ */
/* Signed URLs — short-lived, bound to the document and its owner      */
/* ------------------------------------------------------------------ */

const SIGNED_URL_TTL_SECONDS = 300

export function signFileUrl(documentId: string, ownerId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS
  const sig = hmac(env.fileSigningSecret, `${documentId}:${ownerId}:${exp}`)
  return { url: `/api/files/${documentId}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() }
}

export function verifyFileSignature(documentId: string, ownerId: string, exp: number, sig: string, now = Date.now()) {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false
  return safeEqual(hmac(env.fileSigningSecret, `${documentId}:${ownerId}:${exp}`), sig)
}
