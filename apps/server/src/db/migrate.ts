import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { createDatabase } from './client'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations.')
}

const { db, close } = createDatabase(databaseUrl)

try {
  await migrate(db, { migrationsFolder: 'drizzle' })
} finally {
  await close()
}
