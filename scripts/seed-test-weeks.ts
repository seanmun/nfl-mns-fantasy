import dotenv from 'dotenv'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '../src/lib/db/schema.js'
import { nflGames, nflTeams, nflWeeks } from '../src/lib/db/schema.js'
import { getScoreboard, abbrOf, sideOf, toGameStatus, winnerSide, scoreOf } from '../api/_espn.js'

// `.env.local`, not `.env` — see the note in drizzle.config.ts.
dotenv.config({ path: ['.env.local', '.env'] })

// Builds QA test weeks out of real preseason games.
//
// A "week" in this app is only a set of games with a deadline, so a test
// week can be a single evening. These live under seasonType 'test', which
// the ESPN calendar sync never writes — so they cannot collide with real
// weeks, and the whole test tears down with one delete.
//
//   npm run seed:test
//
// Re-runnable: it clears and rebuilds the test weeks each time.

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const db = drizzle(neon(url), { schema })

const SEASON = Number(process.env.NFL_SEASON) || 2026

// Which real preseason games go in which test week. Identified by the
// pairing rather than by ESPN id so this reads as the plan does.
const PLAN: Array<{ week: number; label: string; games: string[] }> = [
  { week: 1, label: 'Test Week 1', games: ['LAR@KC', 'JAX@NO'] },
  { week: 2, label: 'Test Week 2', games: ['PHI@BAL', 'DAL@SEA'] },
]

// ESPN preseason week holding tonight's slate.
const ESPN_PRESEASON_WEEK = 2

async function main() {
  const teams = await db.select().from(nflTeams)
  const known = new Set(teams.map((t) => t.id))

  const board = await getScoreboard(SEASON, 'pre', ESPN_PRESEASON_WEEK)
  console.log(`ESPN preseason week ${ESPN_PRESEASON_WEEK}: ${board.events.length} events`)

  // Index the live events by "AWAY@HOME" so the plan above can name them.
  const byPair = new Map<string, { event: (typeof board.events)[number]; home: string; away: string }>()
  for (const event of board.events) {
    const comp = event.competitions[0]
    if (!comp) continue
    const home = abbrOf(sideOf(comp, 'home'))
    const away = abbrOf(sideOf(comp, 'away'))
    if (!home || !away || !known.has(home) || !known.has(away)) continue
    byPair.set(`${away}@${home}`, { event, home, away })
  }

  // ── Tear down any previous run ────────────────────────────────
  const old = await db
    .select({ id: nflWeeks.id })
    .from(nflWeeks)
    .where(and(eq(nflWeeks.season, SEASON), eq(nflWeeks.seasonType, 'test')))
  if (old.length) {
    await db.delete(nflGames).where(inArray(nflGames.weekId, old.map((w) => w.id)))
    await db.delete(nflWeeks).where(inArray(nflWeeks.id, old.map((w) => w.id)))
    console.log(`cleared ${old.length} previous test week(s)`)
  }

  // ── Build ─────────────────────────────────────────────────────
  for (const plan of PLAN) {
    const [week] = await db
      .insert(nflWeeks)
      .values({
        season: SEASON,
        seasonType: 'test',
        week: plan.week,
        label: plan.label,
      })
      .returning()

    const kickoffs: Date[] = []
    for (const pair of plan.games) {
      const found = byPair.get(pair)
      if (!found) {
        console.error(`  !! ${pair} not found in ESPN preseason week ${ESPN_PRESEASON_WEEK}`)
        continue
      }
      const comp = found.event.competitions[0]
      const kickoffAt = new Date(found.event.date)
      const status = toGameStatus(comp)
      const winner = status === 'final' ? winnerSide(comp) : null

      // A distinct feed id: the real game already exists under its real
      // week, and scheduleFeedId is unique. Suffixing keeps the test copy
      // separate so the hourly sync never fights over the same row.
      await db.insert(nflGames).values({
        weekId: week.id,
        homeTeamId: found.home,
        awayTeamId: found.away,
        kickoffAt,
        status,
        homeScore: scoreOf(sideOf(comp, 'home')),
        awayScore: scoreOf(sideOf(comp, 'away')),
        winnerTeamId: winner === 'home' ? found.home : winner === 'away' ? found.away : null,
        scheduleFeedId: `test-${found.event.id}`,
        lastSyncedAt: new Date(),
      })
      kickoffs.push(kickoffAt)
      console.log(`  ${plan.label}: ${pair}  ${kickoffAt.toISOString()}  (${status})`)
    }

    if (kickoffs.length) {
      kickoffs.sort((a, b) => a.getTime() - b.getTime())
      await db
        .update(nflWeeks)
        .set({ firstKickoffAt: kickoffs[0], lastKickoffAt: kickoffs[kickoffs.length - 1] })
        .where(eq(nflWeeks.id, week.id))
    }
  }

  console.log('\ndone. Create a pool with seasonType "test" to play these weeks.')
}

await main()
