/** Grants the admin role: npm run admin:promote -- --phone 9876543210   (or --email for old email accounts) */
import { env } from '../config/env.js'
import { connectDb, disconnectDb } from '../db.js'
import { User } from '../models/index.js'
import { userFilterFromArgs } from './findUser.js'

async function main() {
  const { filter, label } = userFilterFromArgs()
  await connectDb(env.MONGODB_URI)
  const r = await User.updateOne(filter, { $set: { role: 'admin' } })
  console.log(r.matchedCount ? `${label} is now an admin` : `No user ${label}`)
  await disconnectDb()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await disconnectDb().catch(() => undefined)
  process.exit(1)
})
