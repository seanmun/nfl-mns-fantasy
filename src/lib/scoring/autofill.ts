import { and, eq, isNull, isNotNull, lte } from 'drizzle-orm'
import type { Db } from '../db/types.js'
import {
  nflGames,
  nflPoolEntries,
  nflPoolGames,
  nflPoolWeeks,
  nflPools,
  nflPicks,
} from '../db/schema.js'
import type { PickNScoring } from './config.js'
import { mulberry32, selectAutoPicks, selectKeyPick } from './autopick.js'


export interface AutofillResult {
  poolId: string
  weekId: string
  entriesFilled: number
  picksAssigned: number
  keyPicksAssigned: number
  // Entries that could not be brought up to the full count because the
  // slate had run out. Reported, never silent — a short set that looks
  // like success is how someone quietly loses a week.
  shortfalls: Array<{ entryId: string; owed: number; assigned: number }>
}

// Pool-weeks whose deadline has passed and whose fill has not yet run.
// The stamp is what makes a retry safe: without it, a second invocation
// assigns a second set of random picks on top of the first.
export async function duePoolWeeks(db: Db, now: Date) {
  return db
    .select()
    .from(nflPoolWeeks)
    .where(
      and(
        isNotNull(nflPoolWeeks.pickDeadlineAt),
        lte(nflPoolWeeks.pickDeadlineAt, now),
        isNull(nflPoolWeeks.autoPicksAppliedAt),
        isNotNull(nflPoolWeeks.linesPublishedAt)
      )
    )
}

// Fill in every short entry for one pool-week.
//
// The deadline is enforced on WRITE as well as here, so a late run never
// lets anyone sneak a pick in — it only delays the fill. That is why an
// hourly cron is sufficient precision for a job whose deadline is exact.
export async function autofillPoolWeek(
  db: Db,
  poolWeekId: string,
  opts: { now?: Date; seed?: number } = {}
): Promise<AutofillResult> {
  const now = opts.now ?? new Date()
  const rng = mulberry32(opts.seed ?? 0xc0ffee)

  const [poolWeek] = await db
    .select()
    .from(nflPoolWeeks)
    .where(eq(nflPoolWeeks.id, poolWeekId))
    .limit(1)
  if (!poolWeek) throw new Error(`No such pool week: ${poolWeekId}`)

  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolWeek.poolId)).limit(1)
  if (!pool) throw new Error(`No such pool: ${poolWeek.poolId}`)

  const result: AutofillResult = {
    poolId: pool.id,
    weekId: poolWeek.weekId,
    entriesFilled: 0,
    picksAssigned: 0,
    keyPicksAssigned: 0,
    shortfalls: [],
  }

  const config = pool.scoringConfig as unknown as PickNScoring
  const required = pool.picksRequired ?? config.picksRequired ?? null
  const wantsKeyPick = config.keyPick === true

  // Only games this pool actually included, joined to their kickoff so
  // ones already under way can be excluded.
  const slateAll = await db
    .select({
      gameId: nflPoolGames.gameId,
      homeTeamId: nflGames.homeTeamId,
      awayTeamId: nflGames.awayTeamId,
      kickoffAt: nflGames.kickoffAt,
      spread: nflPoolGames.spread,
    })
    .from(nflPoolGames)
    .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
    .where(
      and(
        eq(nflPoolGames.poolId, pool.id),
        eq(nflPoolGames.weekId, poolWeek.weekId),
        eq(nflPoolGames.isIncluded, true)
      )
    )
  // An OFF-THE-BOARD game (published ATS slate, no number) is not
  // pickable by a person, so the fill never assigns it either.
  const slate =
    pool.spreadMode === 'ats' ? slateAll.filter((g) => g.spread != null) : slateAll

  // ACTIVE entries only — a benched season or a ban is not something
  // the deadline job should be inventing picks for.
  const entries = await db
    .select()
    .from(nflPoolEntries)
    .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.status, 'active')))

  for (const entry of entries) {
    // Survivor entries that are already out are left alone.
    if (entry.isEliminated) continue

    const existing = await db
      .select()
      .from(nflPicks)
      .where(and(eq(nflPicks.entryId, entry.id), eq(nflPicks.weekId, poolWeek.weekId)))

    const owed = required == null ? 0 : Math.max(0, required - existing.length)

    if (owed > 0) {
      const assigned = selectAutoPicks({
        candidates: slate,
        alreadyPickedGameIds: new Set(existing.map((p) => p.gameId)),
        needed: owed,
        now,
        rng,
      })

      if (assigned.length > 0) {
        await db.insert(nflPicks).values(
          assigned.map((a) => ({
            entryId: entry.id,
            gameId: a.gameId,
            weekId: poolWeek.weekId,
            selectedTeamId: a.selectedTeamId,
            isAuto: true,
          }))
        )
        result.picksAssigned += assigned.length
        result.entriesFilled++
      }

      if (assigned.length < owed) {
        result.shortfalls.push({ entryId: entry.id, owed, assigned: assigned.length })
      }
    }

    if (!wantsKeyPick) continue

    // Re-read: the entry's week now includes anything just assigned, and
    // an auto-assigned pick is as eligible to be the key as a deliberate
    // one — by the deadline they are all equally the member's picks.
    const finalPicks = await db
      .select()
      .from(nflPicks)
      .where(and(eq(nflPicks.entryId, entry.id), eq(nflPicks.weekId, poolWeek.weekId)))

    if (finalPicks.length === 0) continue
    if (finalPicks.some((p) => p.isKeyPick)) continue

    const keyId = selectKeyPick(
      finalPicks.map((p) => p.id),
      rng
    )
    if (!keyId) continue

    // isKeyAuto, NOT isAuto — the pick may well have been the member's
    // own deliberate choice; only the key designation was ours.
    await db
      .update(nflPicks)
      .set({ isKeyPick: true, isKeyAuto: true, updatedAt: new Date() })
      .where(eq(nflPicks.id, keyId))
    result.keyPicksAssigned++
  }

  // Stamp last. If anything above threw, the stamp is not written and the
  // next tick retries — picks already inserted are counted as existing,
  // so the retry tops up rather than duplicating.
  await db
    .update(nflPoolWeeks)
    .set({ autoPicksAppliedAt: new Date(), updatedAt: new Date() })
    .where(eq(nflPoolWeeks.id, poolWeekId))

  return result
}
