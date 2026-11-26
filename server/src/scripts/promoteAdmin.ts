/** Grants the admin role: npm run admin:promote -- --email someone@example.com */
import { env } from '../config/env.js'
import { connectDb, disconnectDb } from '../db.js'
import { User } from '../models/index.js'

async function main() {
  const i = process.argv.indexOf('--email')
  const email = i >= 0 ? process.argv[i + 1]?.toLowerCase() : undefined
  if (!email) throw new Error('Usage: --email <email>')
  await connectDb(env.MONGODB_URI)
  const r = await User.updateOne({ email }, { $set: { role: 'admin' } })
  console.log(r.matchedCount ? `${email} is now an admin` : `No user with email ${email}`)
  await disconnectDb()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await disconnectDb().catch(() => undefined)
  process.exit(1)
})
