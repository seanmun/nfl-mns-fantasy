import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/types.js'
import {
  nflEntryWeeks,
  nflGames,
  nflPoolEntries,
  nflPoolGames,
  nflPools,
  nflPicks,
  nflWeeks,
  type PickResult,
} from '../db/schema.js'
import type { PickNScoring, SurvivorScoring } from './config.js'
import { UngradableError, gradePick, isEliminated, survivorStrike } from './grade.js'
import { rankStandings } from './standings.js'


export interface GradeWeekResult {
  poolId: string
  weekId: string
  picksGraded: number
  // Picks that could not be graded, with the reason. Never swallowed —
  // an ungraded pick is someone's missing point.
  problems: Array<{ pickId: string; reason: string }>
}

// Grade one pool-week, then rebuild that pool's standings from scratch.
//
// Idempotent by construction: it recomputes every pick from the game
// result rather than incrementing counters, so running it twice, or
// re-running it after a score correction, converges on the same answer.
// That is the property that makes a regrade safe.
export async function gradePoolWeek(
  db: Db,
  poolId: string,
  weekId: string
): Promise<GradeWeekResult> {
  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolId)).limit(1)
  if (!pool) throw new Error(`No such pool: ${poolId}`)

  const config = pool.scoringConfig as unknown as PickNScoring & SurvivorScoring
  const out: GradeWeekResult = { poolId, weekId, picksGraded: 0, problems: [] }

  const entries = await db.select().from(nflPoolEntries).where(eq(nflPoolEntries.poolId, poolId))
  if (entries.length === 0) return out
  const entryIds = entries.map((e) => e.id)

  const picks = await db
    .select()
    .from(nflPicks)
    .where(and(inArray(nflPicks.entryId, entryIds), eq(nflPicks.weekId, weekId)))

  const games = await db.select().from(nflGames).where(eq(nflGames.weekId, weekId))
  const gameById = new Map(games.map((g) => [g.id, g]))

  // The pool's OWN numbers. Grading never reads game_lines.
  const poolGames = await db
    .select()
    .from(nflPoolGames)
    .where(and(eq(nflPoolGames.poolId, poolId), eq(nflPoolGames.weekId, weekId)))
  const spreadByGame = new Map(poolGames.map((pg) => [pg.gameId, pg.spread]))

  for (const pick of picks) {
    const game = gameById.get(pick.gameId)
    if (!game || game.status !== 'final') continue
    if (game.homeScore == null || game.awayScore == null) continue

    try {
      const graded = gradePick({
        poolType: pool.poolType,
        spreadMode: pool.spreadMode,
        config,
        game: {
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        },
        selectedTeamId: pick.selectedTeamId,
        confidencePoints: pick.confidencePoints,
        officialSpread: spreadByGame.get(pick.gameId) ?? null,
      })

      await db
        .update(nflPicks)
        .set({
          result: graded.result,
          pointsEarned: graded.pointsEarned,
          gradedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(nflPicks.id, pick.id))
      out.picksGraded++
    } catch (err) {
      out.problems.push({
        pickId: pick.id,
        reason: err instanceof UngradableError ? err.message : String(err),
      })
    }
  }

  await rebuildPoolStandings(db, poolId)
  return out
}

// Rebuild every entry's weekly and cumulative standings for a pool.
//
// Always a full rebuild, never a delta. entry_weeks and pool_entries are
// caches over picks — if the two ever disagree, picks win — and a full
// rebuild is the only version of that statement that stays true after a
// score correction or a line fix.
export async function rebuildPoolStandings(db: Db, poolId: string): Promise<void> {
  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolId)).limit(1)
  if (!pool) return
  const config = pool.scoringConfig as unknown as PickNScoring & SurvivorScoring

  const entries = await db.select().from(nflPoolEntries).where(eq(nflPoolEntries.poolId, poolId))
  if (entries.length === 0) return
  const entryIds = entries.map((e) => e.id)

  const picks = await db.select().from(nflPicks).where(inArray(nflPicks.entryId, entryIds))
  const weeks = await db
    .select()
    .from(nflWeeks)
    .where(and(eq(nflWeeks.season, pool.season), eq(nflWeeks.seasonType, pool.seasonType)))
    .orderBy(nflWeeks.week)

  // Week order matters: cumulative columns are a running total, so they
  // have to be walked in play order rather than whatever the join returns.
  const weeksInPool = weeks.filter((w) => w.week >= pool.startWeek && w.week <= pool.endWeek)

  for (const entry of entries) {
    const mine = picks.filter((p) => p.entryId === entry.id)
    let cumulativePoints = 0
    let cumulativeKeyScore = 0
    let strikes = 0
    let eliminatedWeek: number | null = null

    for (const week of weeksInPool) {
      const weekPicks = mine.filter((p) => p.weekId === week.id)
      const graded = weekPicks.filter((p) => p.result !== 'pending')
      if (weekPicks.length === 0 && graded.length === 0) continue

      const points = graded.reduce((sum, p) => sum + p.pointsEarned, 0)

      // A key win is always 1. A key push contributes whatever the admin
      // configured — 0 by default, so a push is not a win. Missing config
      // falls back to 0 rather than NaN, which would poison every
      // cumulative total downstream of it.
      const key = graded.find((p) => p.isKeyPick)
      const keyScore =
        key?.result === 'win'
          ? 1
          : key?.result === 'push'
            ? (config.keyPushCredit ?? 0)
            : 0

      cumulativePoints += points
      cumulativeKeyScore += keyScore

      // Survivor: strikes accrue in week order, so the elimination week is
      // the first one that tips past the limit.
      if (pool.poolType === 'survivor') {
        for (const p of graded) {
          if (survivorStrike(p.result as PickResult, config)) strikes++
        }
        if (eliminatedWeek == null && isEliminated(strikes, config)) {
          eliminatedWeek = week.week
        }
      }

      const row = {
        entryId: entry.id,
        weekId: week.id,
        points,
        correctCount: graded.filter((p) => p.result === 'win').length,
        incorrectCount: graded.filter((p) => p.result === 'loss').length,
        pushCount: graded.filter((p) => p.result === 'push').length,
        keyPickScore: keyScore,
        cumulativePoints,
        cumulativeKeyPickScore: cumulativeKeyScore,
        survivorResult:
          pool.poolType === 'survivor'
            ? eliminatedWeek != null && eliminatedWeek <= week.week
              ? 'eliminated'
              : 'alive'
            : null,
        gradedAt: new Date(),
      }

      await db
        .insert(nflEntryWeeks)
        .values(row)
        .onConflictDoUpdate({
          target: [nflEntryWeeks.entryId, nflEntryWeeks.weekId],
          set: row,
        })
    }

    await db
      .update(nflPoolEntries)
      .set({
        totalPoints: cumulativePoints,
        keyPickScore: cumulativeKeyScore,
        strikes,
        isEliminated: pool.poolType === 'survivor' && isEliminated(strikes, config),
        eliminatedWeek,
        updatedAt: new Date(),
      })
      .where(eq(nflPoolEntries.id, entry.id))
  }

  // Ranks last, once every total is settled. Sorted by points then key
  // picks, with genuine ties sharing a rank.
  const settled = await db.select().from(nflPoolEntries).where(eq(nflPoolEntries.poolId, poolId))
  const ranked = rankStandings(
    settled.map((e) => ({
      entryId: e.id,
      totalPoints: e.totalPoints,
      keyPickScore: e.keyPickScore,
    }))
  )
  for (const row of ranked) {
    await db
      .update(nflPoolEntries)
      .set({ rank: row.rank })
      .where(eq(nflPoolEntries.id, row.entryId))
  }
}
