import { normalizePhone } from '../lib/phone.js'

/**
 * Reads `--phone <number>` (any format the app accepts, e.g. 9876543210) or `--email <address>`
 * (old email accounts) from the command line and returns a User filter plus a label for messages.
 */
export function userFilterFromArgs(): { filter: Record<string, string>; label: string } {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const phone = arg('phone')
  if (phone) {
    const r = normalizePhone(phone)
    if ('error' in r) throw new Error(r.error)
    return { filter: { phone: r.phone }, label: r.phone }
  }
  const email = arg('email')?.toLowerCase()
  if (email) return { filter: { email }, label: email }
  throw new Error('Say which user: --phone <mobile number> (or --email <address> for old email accounts)')
}
