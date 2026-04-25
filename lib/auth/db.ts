import 'server-only'
import { sql } from '@vercel/postgres'

// This file has been refactored to use Vercel Postgres instead of SQLite
// for compatibility with Vercel's serverless environment.

// The database connection is now automatically managed by Vercel
// based on the `DATABASE_URL` environment variable in your project settings.

// You can use the 'sql' template tag from `@vercel/postgres` to run queries.
// Example:
// import { sql } from '@/lib/auth/db'
// const { rows } = await sql`SELECT * FROM users;`

export { sql }

// The previous `getDatabase()` and `getDatabaseFilePath()` functions have been removed.
// Any server-side code that used `getDatabase()` will need to be updated
// to use the exported 'sql' object for queries.
