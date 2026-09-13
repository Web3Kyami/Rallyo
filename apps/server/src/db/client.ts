import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl })

  return {
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  }
}

export type RallyoDatabase = ReturnType<typeof createDatabase>['db']
