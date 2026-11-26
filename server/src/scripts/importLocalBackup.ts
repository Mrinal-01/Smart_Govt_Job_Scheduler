/**
 * Migration: import a StudyOS browser backup (Settings → Data & backup → Export JSON,
 * i.e. the old localStorage `studyos.state.v3` document) into a user's server workspace.
 *
 *   npm run migrate:import-local -- --email student@example.com --file ./studyos-backup.json [--replace]
 *
 * Never deletes anything unless --replace is given; with --replace the previous
 * workspace is first written to ./storage/backups/<userId>-<timestamp>.json.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import { connectDb, disconnectDb } from '../db.js'
import { StudyWorkspace, User } from '../models/index.js'
import { workspaceDataSchema } from '../modules/workspace/workspace.service.js'

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const email = arg('email')?.toLowerCase()
  const file = arg('file')
  const replace = process.argv.includes('--replace')
  if (!email || !file) throw new Error('Usage: --email <email> --file <backup.json> [--replace]')
  await connectDb(env.MONGODB_URI)
  const user = await User.findOne({ email })
  if (!user) throw new Error(`No user with email ${email}`)
  const parsed = workspaceDataSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')))
  if (!parsed.success) throw new Error(`Not a valid StudyOS backup: ${parsed.error.issues[0]?.message}`)
  const existing = await StudyWorkspace.findOne({ userId: user._id }).lean()
  if (existing && !replace) throw new Error('User already has a workspace. Re-run with --replace to overwrite (a backup is kept).')
  if (existing) {
    const dir = path.resolve('storage/backups')
    await fs.mkdir(dir, { recursive: true })
    const out = path.join(dir, `${user._id}-${Date.now()}.json`)
    await fs.writeFile(out, JSON.stringify(existing.data))
    console.log(`Previous workspace saved to ${out}`)
    await StudyWorkspace.updateOne({ _id: existing._id }, { $set: { data: parsed.data, origin: 'import', schemaVersion: parsed.data.version }, $inc: { revision: 1 } })
  } else {
    await StudyWorkspace.create({ userId: user._id, origin: 'import', schemaVersion: parsed.data.version, data: parsed.data })
  }
  console.log(`Imported workspace for ${email}`)
  await disconnectDb()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await disconnectDb().catch(() => undefined)
  process.exit(1)
})
