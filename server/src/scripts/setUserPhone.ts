/**
 * Attaches a mobile number to an existing (email) account so it can sign in with a one-time code:
 *   npm --prefix server run user:set-phone -- someone@example.com 9876543210
 */
import { env } from '../config/env.js'
import { connectDb, disconnectDb } from '../db.js'
import { normalizePhone } from '../lib/phone.js'
import { User } from '../models/index.js'

async function main() {
  const [emailArg, phoneArg] = process.argv.slice(2).filter((a) => a !== '--')
  if (!emailArg || !phoneArg) throw new Error('Usage: npm --prefix server run user:set-phone -- <email> <phone>')
  const email = emailArg.trim().toLowerCase()
  const normalized = normalizePhone(phoneArg)
  if ('error' in normalized) throw new Error(normalized.error)
  await connectDb(env.MONGODB_URI)
  const user = await User.findOne({ email })
  if (!user) throw new Error(`No user with email ${email}`)
  const other = await User.findOne({ phone: normalized.phone, _id: { $ne: user._id } }).select('_id').lean()
  if (other) throw new Error(`${normalized.phone} already belongs to another account`)
  await User.updateOne({ _id: user._id }, { $set: { phone: normalized.phone, phoneVerifiedAt: null } })
  console.log(`${email} can now log in with ${normalized.phone} (verified on first OTP login).`)
  await disconnectDb()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await disconnectDb().catch(() => undefined)
  process.exit(1)
})
