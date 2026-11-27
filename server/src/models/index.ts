import mongoose from 'mongoose'

// Operator injection is prevented at the edge (middleware/security.ts rejects `$`-prefixed
// keys and every handler parses input with Zod into primitives before querying).
mongoose.set('strictQuery', true)

export * from './auth.js'
export * from './workspace.js'
export * from './schedule.js'
export * from './plan.js'
export * from './sounds.js'
export * from './documents.js'
export * from './questions.js'
export * from './exams.js'
export * from './ai.js'
