import dotenv from 'dotenv'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { nflTeams } from '../src/lib/db/schema.js'
import { NFL_TEAMS } from '../src/lib/db/teams.js'

// `.env.local`, not `.env` — see the note in drizzle.config.ts. Imports
// hoist above this, so it must stay true that nothing imported here
// reads process.env at module load; they all read it inside functions.
dotenv.config({ path: ['.env.local', '.env'] })


// One-off. The 32 teams do not change, so nothing syncs them.
// Re-runnable: it upserts, so fixing a colour or a logo is just editing
// teams.ts and running this again.

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const db = drizzle(neon(url))

for (const team of NFL_TEAMS) {
  await db
    .insert(nflTeams)
    .values(team)
    .onConflictDoUpdate({ target: nflTeams.id, set: team })
}

console.log(`Seeded ${NFL_TEAMS.length} teams`)
