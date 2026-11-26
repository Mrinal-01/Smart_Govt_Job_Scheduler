import crypto from 'node:crypto'

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url')

export const sha256 = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex')

export const hmac = (secret: string, value: string): string =>
  crypto.createHmac('sha256', secret).update(value).digest('base64url')

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/** Deterministic PRNG (mulberry32) so question selection is reproducible from a stored seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
