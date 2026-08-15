import dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'

// drizzle-kit loads `.env` on its own, but this project keeps local
// values in `.env.local` (gitignored, matching the other apps and
// Vercel's convention). Without this, DATABASE_URL is simply absent and
// drizzle-kit fails with "connection url required" — which reads like a
// missing value rather than a file it never looked at.
dotenv.config({ path: ['.env.local', '.env'] })

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // All NFL tables live in the nfl schema; push can never touch public,
  // which is where the shared users table and another project's
  // leaderboard table live.
  schemaFilter: ['nfl'],
} satisfies Config
