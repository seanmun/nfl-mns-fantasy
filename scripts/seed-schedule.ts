import dotenv from 'dotenv'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '../src/lib/db/schema.js'
import { syncCalendar, syncWeek } from '../src/lib/sync/schedule.js'
import type { SeasonTypeKey } from '../api/_espn.js'

// `.env.local`, not `.env` — see the note in drizzle.config.ts. Imports
// hoist above this, so it must stay true that nothing imported here
// reads process.env at module load; they all read it inside functions.
dotenv.config({ path: ['.env.local', '.env'] })


// Pulls a full season: the week structure, then every week's fixtures.
//
// Run once before a season opens. After that the hourly tick keeps the
// current week fresh, so this is only needed again if the whole schedule
// has to be rebuilt.
//
//   DATABASE_URL=... npm run seed:schedule -- 2026
//
// Costs one ESPN request per week (~27 for a full season including the
// postseason). ESPN is unmetered, but they are sequential on purpose —
// hammering an undocumented public endpoint is how it stops being free.

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const season = Number(process.argv[2]) || new Date().getUTCFullYear()
// The schema generic is load-bearing: drizzle carries it in the type, and
// a client built without it is rejected by every service that takes a Db.
const db = drizzle(neon(url), { schema })

const weeks = await syncCalendar(db, season)
console.log(`Seeded ${weeks} weeks for ${season}`)

// Regular season is what pools run on. Postseason weeks exist in the
// calendar and can be synced later if a pool ever extends into them.
const PLAN: Array<{ type: SeasonTypeKey; weeks: number }> = [{ type: 'regular', weeks: 18 }]

let games = 0
for (const { type, weeks: count } of PLAN) {
  for (let week = 1; week <= count; week++) {
    const result = await syncWeek(db, season, type, week)
    games += result.gamesSeen
    if (result.unknownTeams.length) {
      // A team the seed does not know about means teams.ts is stale, and
      // every game involving it was skipped. Worth stopping for.
      console.error(`  week ${week}: UNKNOWN TEAMS ${result.unknownTeams.join(', ')}`)
    }
    console.log(`  ${type} week ${week}: ${result.gamesSeen} games`)
  }
}

console.log(`Seeded ${games} games for ${season}`)
