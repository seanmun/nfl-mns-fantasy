import { and, eq, inArray, sql } from 'drizzle-orm'
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
import { nflGames, nflTeams, nflWeeks, type GameStatus, type SeasonType } from '../db/schema.js'

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

// QA weeks. A 'test' week holds copies of real preseason games whose
// feed ids carry a `test-` prefix — decoupled from the real rows so a
// preseason sync can never collide with them on the unique feed-id key.
// The flip side is that no ordinary sync will ever score them, so this
// walks the preseason scoreboards and matches events to `test-<id>`.
// Returns the number of games updated. Zero test games pending = zero
// ESPN calls, so the regular season never pays for this.
export async function syncTestWeeks(db: Db, season: number): Promise<number> {
  const pending = await db
    .select({
      id: nflGames.id,
      scheduleFeedId: nflGames.scheduleFeedId,
      homeTeamId: nflGames.homeTeamId,
      awayTeamId: nflGames.awayTeamId,
      weekId: nflGames.weekId,
    })
    .from(nflGames)
    .innerJoin(nflWeeks, eq(nflWeeks.id, nflGames.weekId))
    .where(and(eq(nflWeeks.seasonType, 'test' as SeasonType), eq(nflWeeks.season, season)))

  const wanted = new Map(
    pending
      .filter((g) => g.scheduleFeedId?.startsWith('test-'))
      .map((g) => [g.scheduleFeedId!.slice('test-'.length), g])
  )
  if (!wanted.size) return 0

  let updated = 0
  for (let week = 1; week <= 4 && wanted.size > 0; week++) {
    let board
    try {
      board = await getScoreboard(season, 'pre', week)
    } catch {
      continue
    }
    for (const event of board.events) {
      const g = wanted.get(event.id)
      if (!g) continue
      const comp = event.competitions[0]
      if (!comp) continue

      const status = toGameStatus(comp)
      const isFinal = status === 'final'
      const winner = isFinal ? winnerSide(comp) : null

      await db
        .update(nflGames)
        .set({
          status,
          homeScore: scoreOf(sideOf(comp, 'home')),
          awayScore: scoreOf(sideOf(comp, 'away')),
          // The copy's own team ids, not ESPN's abbreviations — they
          // were pinned when the copy was made and are already valid.
          winnerTeamId:
            winner === 'home' ? g.homeTeamId : winner === 'away' ? g.awayTeamId : null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(nflGames.id, g.id))

      wanted.delete(event.id)
      updated++
    }
  }
  return updated
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

// ─── Which week is it ────────────────────────────────────────────────
//
// Two different questions, two different answers. Confusing them is
// what put a half-played Monday night game in "last week" on
// 2026-10-05 (members saw an empty Week 5 at 10:46pm ET with the
// Falcons game still on) and what dropped Monday night scores on
// 2026-09-24.
//
//   currentWeek()  — the week MEMBERS are in. A week ends at 6am
//                    Eastern on the morning after its last kickoff,
//                    never earlier. Monday night is still that week.
//                    Used by every member- and admin-facing endpoint.
//   upcomingWeek() — the next week to SCHEDULE: the one whose last
//                    kickoff is still ahead. Used by the crons only,
//                    so the Tuesday lines pull (10:00Z, which is 5am
//                    Eastern once DST ends) never re-pulls last week.
//
// Neither decides what gets scored: that is weeksNeedingSync().

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const ET_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  hour12: false,
})
const WEEK_ENDS_HOUR_ET = 6

// 6am Eastern on the Eastern calendar day after `lastKickoff`. Correct on
// both sides of the DST change: it guesses the EDT instant and shifts an
// hour if the Eastern clock disagrees.
export function weekEndsAt(lastKickoff: Date): Date {
  const [y, m, d] = ET_DATE.format(lastKickoff).split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d + 1, WEEK_ENDS_HOUR_ET + 4, 0, 0))
  const hour = Number(ET_HOUR.format(guess)) % 24
  return new Date(guess.getTime() + (WEEK_ENDS_HOUR_ET - hour) * 3_600_000)
}

// Members' week: the first week that has not ended, else the last.
// `weeks` must be in week order.
export function pickActiveWeek<T extends { lastKickoffAt: Date | null }>(
  weeks: T[],
  now: Date
): T | null {
  const t = now.getTime()
  return (
    weeks.find((w) => w.lastKickoffAt && weekEndsAt(w.lastKickoffAt).getTime() > t) ??
    weeks[weeks.length - 1] ??
    null
  )
}

// The crons' week: the first whose last kickoff is still ahead, else the
// last. This is the rule that rolled members into an empty next week at
// Monday night kickoff; it is right ONLY for "what do we schedule next".
export function pickWeekByKickoff<T extends { lastKickoffAt: Date | null }>(
  weeks: T[],
  now: Date
): T | null {
  const t = now.getTime()
  return (
    weeks.find((w) => w.lastKickoffAt && w.lastKickoffAt.getTime() > t) ??
    weeks[weeks.length - 1] ??
    null
  )
}

async function seasonWeeks(db: Db, season: number, seasonType: SeasonType) {
  return db
    .select()
    .from(nflWeeks)
    .where(and(eq(nflWeeks.season, season), eq(nflWeeks.seasonType, seasonType)))
    .orderBy(nflWeeks.week)
}

export async function currentWeek(db: Db, season: number, seasonType: SeasonType = 'regular') {
  return pickActiveWeek(await seasonWeeks(db, season, seasonType), new Date())
}

export async function upcomingWeek(db: Db, season: number, seasonType: SeasonType = 'regular') {
  return pickWeekByKickoff(await seasonWeeks(db, season, seasonType), new Date())
}

// ─── Which weeks still need a feed call ──────────────────────────────

// Terminal states. A game in either will never change again, so it never
// needs another fetch.
export function isSettled(status: GameStatus): boolean {
  return status === 'final' || status === 'cancelled'
}

export interface SyncGame {
  weekId: string
  status: GameStatus
  kickoffAt: Date
}

// Games that have kicked off and are not settled: in play, or played and
// not yet recorded as final here. This predicate — the game's OWN state,
// never the calendar — is what decides which weeks the tick re-fetches.
//
// Why it is phrased this way: currentWeek() rolls to the next week the
// moment a week's last game kicks off. Through Weeks 1 and 2 of 2026 the
// tick fetched only that "current" week, so the Monday night game — the
// last kickoff, with no later game holding its week open — was fetched
// for the last time at the tick BEFORE it started and sat at scheduled
// 0-0 for good. Ten picks on two games stayed 'pending' and every total
// that included one was short. Any rule of the form "which week is it"
// has that hole; "which games are undecided" does not.
export function unsettledKickedOff<T extends SyncGame>(games: T[], now: Date): T[] {
  const t = now.getTime()
  return games.filter((g) => g.kickoffAt.getTime() <= t && !isSettled(g.status))
}

export interface SyncBacklog {
  // Every week holding an unsettled game that has kicked off, in week
  // order. Usually empty; one week from Monday night until its final
  // lands; more only when something upstream has gone wrong.
  weeks: Array<typeof nflWeeks.$inferSelect>
  // The games behind that list, for the tick's stale-game report.
  games: Array<SyncGame & { label: string; homeTeamId: string; awayTeamId: string }>
}

// 'test' weeks are excluded: their games are copies under `test-` feed
// ids, synced by syncTestWeeks, and there is no scoreboard season-type
// code for them.
const FEED_SEASON_TYPES: SeasonType[] = ['pre', 'regular', 'post']

export async function weeksNeedingSync(db: Db, season: number, now: Date): Promise<SyncBacklog> {
  const rows = await db
    .select({
      week: nflWeeks,
      weekId: nflGames.weekId,
      status: nflGames.status,
      kickoffAt: nflGames.kickoffAt,
      homeTeamId: nflGames.homeTeamId,
      awayTeamId: nflGames.awayTeamId,
    })
    .from(nflGames)
    .innerJoin(nflWeeks, eq(nflWeeks.id, nflGames.weekId))
    .where(and(eq(nflWeeks.season, season), inArray(nflWeeks.seasonType, FEED_SEASON_TYPES)))

  const open = unsettledKickedOff(rows, now)
  const byId = new Map<string, typeof nflWeeks.$inferSelect>()
  for (const r of open) byId.set(r.week.id, r.week)

  return {
    weeks: [...byId.values()].sort((a, b) => a.week - b.week),
    games: open.map((r) => ({
      weekId: r.weekId,
      status: r.status,
      kickoffAt: r.kickoffAt,
      label: r.week.label,
      homeTeamId: r.homeTeamId,
      awayTeamId: r.awayTeamId,
    })),
  }
}

export { SEASON_TYPE_CODE }
