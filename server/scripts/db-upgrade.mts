/**
 * Brings an existing StudyOS database up to the current schema.
 *
 *   npm --prefix server run db:upgrade            (dry run — prints what would change)
 *   npm --prefix server run db:upgrade -- --apply (does it)
 *
 * 1. Obsolete collections (removed features) are exported to
 *    STORAGE_DIR/../backups/<timestamp>/<collection>.json and then dropped:
 *      studycycles, cyclesubjectblocks, studylogs, revisiontasks, revisionlogs  (old ad-hoc cycle runner)
 *      emailverificationtokens, passwordresettokens                             (email login, replaced by phone OTP)
 * 2. The question bank is migrated to the shared question hub (migrateQuestionHub).
 * 3. Indexes of every current model are synced.
 *
 * Uses MONGODB_URI from server/.env. Safe to run more than once.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'
import { env } from '../src/config/env.ts'
import '../src/models/index.ts'
import { migrateQuestionHub } from '../src/modules/questions/hub.migration.ts'

const OBSOLETE = ['studycycles', 'cyclesubjectblocks', 'studylogs', 'revisiontasks', 'revisionlogs', 'emailverificationtokens', 'passwordresettokens']
const apply = process.argv.includes('--apply')

await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
const db = mongoose.connection.db!
console.log(`Database: ${db.databaseName}  (${apply ? 'APPLY' : 'dry run — add --apply to make changes'})\n`)

const present = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name))
const toDrop = OBSOLETE.filter((c) => present.has(c))
console.log(toDrop.length ? 'Obsolete collections:' : 'No obsolete collections found.')
const backupDir = path.resolve(env.storageDir, '..', 'backups', new Date().toISOString().replace(/[:.]/g, '-'))
for (const name of toDrop) {
  const count = await db.collection(name).countDocuments()
  console.log(`  - ${name}: ${count} document(s)`)
  if (!apply) continue
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 })
  const docs = await db.collection(name).find().toArray()
  await fs.writeFile(path.join(backupDir, `${name}.json`), JSON.stringify(docs, null, 2), { mode: 0o600 })
  await db.collection(name).drop()
  console.log(`    backed up to ${path.join(backupDir, `${name}.json`)} and dropped`)
}

console.log('\nQuestion hub migration:')
if (apply) {
  console.log(' ', JSON.stringify(await migrateQuestionHub()))
} else {
  console.log('  (runs with --apply)')
}

if (apply) {
  console.log('\nSyncing indexes…')
  for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes()
  console.log('  done')
}

await mongoose.disconnect()
