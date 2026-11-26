import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'
import { unauthorized } from '../lib/errors.js'

export interface GoogleIdentity {
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>

const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
let client: OAuth2Client | null = null

/**
 * Verifies a Google Identity Services ID token with Google's official library:
 * signature (Google public keys), audience (our client id), expiry and issuer.
 * Nothing the browser sends about the user is trusted except this token.
 */
export const googleLibraryVerifier: GoogleVerifier = async (idToken) => {
  if (!env.GOOGLE_CLIENT_ID) throw unauthorized('Google sign-in is not configured', 'GOOGLE_NOT_CONFIGURED')
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID)
  let payload
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })
    payload = ticket.getPayload()
  } catch {
    throw unauthorized('Google sign-in could not be verified. Please try again.', 'GOOGLE_TOKEN_INVALID')
  }
  if (!payload || !payload.sub) throw unauthorized('Google token had no subject', 'GOOGLE_TOKEN_INVALID')
  if (!payload.iss || !VALID_ISSUERS.has(payload.iss)) throw unauthorized('Unexpected token issuer', 'GOOGLE_TOKEN_INVALID')
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw unauthorized('Token audience mismatch', 'GOOGLE_TOKEN_INVALID')
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw unauthorized('Google token expired', 'GOOGLE_TOKEN_INVALID')
  return {
    sub: payload.sub,
    email: payload.email ? payload.email.trim().toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    name: payload.name ?? null
  }
}

let verifier: GoogleVerifier = googleLibraryVerifier

export const verifyGoogleIdToken = (idToken: string) => verifier(idToken)

/** Test seam — automated tests inject a fake verifier; production never calls this. */
export function setGoogleVerifier(next: GoogleVerifier | null) {
  verifier = next ?? googleLibraryVerifier
}
