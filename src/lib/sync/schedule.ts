import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/types.js'
import {
  getScoreboard,
  getSeasonCalendar,
  SEASON_TYPE_CODE,
  abbrOf,
  scoreOf,
  sideOf,
  toGameStatus,
  winnerSide,
  type SeasonTypeKey,
} from '../../../api/_espn.js'
import { nflGames, nflTeams, nflWeeks, type SeasonType } from '../db/schema.js'

// Schedule and score sync. ESPN is the source for both — one scoreboard
// call per week returns the fixtures, the live state and the finals.


const CODE_TO_KEY: Record<number, SeasonTypeKey> = {
  1: 'pre',
  2: 'regular',
  3: 'post',
}

export interface SyncWeekResult {
  weekId: string
  gamesSeen: number
  gamesFinal: number
  // Games whose kickoff moved. Flex scheduling is real and it changes
  // which games are behind a pool's deadline, so the caller logs these
  // rather than letting them pass silently.
  kickoffsChanged: string[]
  unknownTeams: string[]
}

// Upserts the season's week structure from ESPN's calendar, which rides
// along on any scoreboard response — so this costs one request.
export async function syncCalendar(db: Db, season: number): Promise<number> {
  const calendar = await getSeasonCalendar(season)
  let count = 0

  for (const section of calendar) {
    const key = CODE_TO_KEY[Number(section.value)]
    if (!key || !section.entries?.length) continue

    for (const entry of section.entries) {
      await db
        .insert(nflWeeks)
        .values({
          season,
          seasonType: key as SeasonType,
          week: Number(entry.value),
          label: entry.label,
        })
        .onConflictDoUpdate({
          target: [nflWeeks.season, nflWeeks.seasonType, nflWeeks.week],
          // Only the label is refreshed. Kickoff bounds are derived from
          // games, not from ESPN's calendar window, which is a broader
          // Tue-to-Mon range and would make "is this week live" wrong.
          set: { label: entry.label, updatedAt: new Date() },
        })
      count++
    }
  }
  return count
}

// One week of fixtures and results. Safe to call repeatedly — it is the
// same code path before kickoff, during play and after the final whistle.
export async function syncWeek(
  db: Db,
  season: number,
  seasonType: SeasonTypeKey,
  week: number
): Promise<SyncWeekResult> {
  const [weekRow] = await db
    .select()
    .from(nflWeeks)
    .where(
      and(
        eq(nflWeeks.season, season),
        eq(nflWeeks.seasonType, seasonType as SeasonType),
        eq(nflWeeks.week, week)
      )
    )
    .limit(1)
  if (!weekRow) throw new Error(`Week not seeded: ${season} ${seasonType} ${week}`)

  const board = await getScoreboard(season, seasonType, week)
  const existing = await db.select().from(nflGames).where(eq(nflGames.weekId, weekRow.id))
  const byFeedId = new Map(existing.map((g) => [g.scheduleFeedId, g]))
  const knownTeams = new Set((await db.select({ id: nflTeams.id }).from(nflTeams)).map((t) => t.id))

  const result: SyncWeekResult = {
    weekId: weekRow.id,
    gamesSeen: 0,
    gamesFinal: 0,
    kickoffsChanged: [],
    unknownTeams: [],
  }

  for (const event of board.events) {
    const comp = event.competitions[0]
    if (!comp) continue

    const home = sideOf(comp, 'home')
    const away = sideOf(comp, 'away')
    const homeId = abbrOf(home)
    const awayId = abbrOf(away)
    if (!homeId || !awayId) continue

    // teams.id IS the ESPN abbreviation by construction, so this is a
    // direct match. A miss means ESPN renamed or relocated a team and the
    // seed is stale. Recorded and skipped rather than inserted, because
    // the foreign key would reject it anyway — and a caller that sees a
    // non-empty unknownTeams knows to reseed instead of wondering why a
    // game never appeared.
    if (!knownTeams.has(homeId) || !knownTeams.has(awayId)) {
      for (const id of [homeId, awayId]) {
        if (!knownTeams.has(id) && !result.unknownTeams.includes(id)) {
          result.unknownTeams.push(id)
        }
      }
      continue
    }

    const status = toGameStatus(comp)
    const isFinal = status === 'final'
    const kickoffAt = new Date(event.date)
    const winner = isFinal ? winnerSide(comp) : null

    const values = {
      weekId: weekRow.id,
      homeTeamId: homeId,
      awayTeamId: awayId,
      kickoffAt,
      status,
      homeScore: scoreOf(home),
      awayScore: scoreOf(away),
      // Null on a final game means a TIE. Only ever set from a final
      // game, so it cannot be mistaken for "not played yet".
      winnerTeamId: winner === 'home' ? homeId : winner === 'away' ? awayId : null,
      scheduleFeedId: event.id,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    }

    const prior = byFeedId.get(event.id)
    if (prior && prior.kickoffAt.getTime() !== kickoffAt.getTime()) {
      result.kickoffsChanged.push(`${awayId}@${homeId}`)
    }

    await db
      .insert(nflGames)
      .values(values)
      .onConflictDoUpdate({ target: nflGames.scheduleFeedId, set: values })

    result.gamesSeen++
    if (isFinal) result.gamesFinal++
  }

  await refreshWeekBounds(db, weekRow.id)
  return result
}

// firstKickoffAt / lastKickoffAt are derived from games, so they stay
// correct when a game is flexed.
export async function refreshWeekBounds(db: Db, weekId: string): Promise<void> {
  await db
    .update(nflWeeks)
    .set({
      firstKickoffAt: sql`(select min(${nflGames.kickoffAt}) from ${nflGames} where ${nflGames.weekId} = ${weekId})`,
      lastKickoffAt: sql`(select max(${nflGames.kickoffAt}) from ${nflGames} where ${nflGames.weekId} = ${weekId})`,
      updatedAt: new Date(),
    })
    .where(eq(nflWeeks.id, weekId))
}

// The week the app should be operating on: the one whose last kickoff is
// still ahead of us, else the most recent. Deliberately not "today's
// date" arithmetic — bye weeks, flexed games and the postseason make
// calendar maths wrong often enough to matter.
export async function currentWeek(db: Db, season: number) {
  const weeks = await db
    .select()
    .from(nflWeeks)
    .where(eq(nflWeeks.season, season))
    .orderBy(nflWeeks.seasonType, nflWeeks.week)

  const now = Date.now()
  return (
    weeks.find((w) => w.lastKickoffAt && w.lastKickoffAt.getTime() > now) ??
    weeks[weeks.length - 1] ??
    null
  )
}

export { SEASON_TYPE_CODE }
