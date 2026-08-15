import { and, eq, lte } from 'drizzle-orm'
import type { Db } from '../db/types.js'
import {
  bookmakerOf,
  fetchNflOdds,
  homeSpread,
  moneylines,
  total,
} from '../../../api/_oddsapi.js'
import { draftKingsOdds, getScoreboard, sideOf, abbrOf, type SeasonTypeKey } from '../../../api/_espn.js'
import { nflGameLines, nflGames, nflOddsSnapshots, nflTeams, nflWeeks, type SeasonType } from '../db/schema.js'


export interface SyncLinesResult {
  eventsReturned: number
  linesWritten: number
  snapshotsWritten: number
  creditsRemaining: number | null
  // Odds API events we could not tie to a game, and games in the window
  // that came back with no line. Both are surfaced because a game with no
  // spread cannot be graded ATS, and discovering that at grading time is
  // far too late.
  unmatchedEvents: string[]
  gamesWithoutLines: string[]
}

// The Tuesday pull. One request, three credits.
//
// The Odds API identifies teams ONLY by full display name, so matching
// runs through teams.odds_api_name. That equality was an assumption when
// the teams table was seeded from ESPN; this is where it gets tested for
// real, which is why a miss is collected and reported rather than logged
// and forgotten.
export async function syncLines(
  db: Db,
  season: number,
  seasonType: SeasonTypeKey,
  week: number
): Promise<SyncLinesResult> {
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

  const games = await db.select().from(nflGames).where(eq(nflGames.weekId, weekRow.id))
  const teams = await db.select().from(nflTeams)
  const idByOddsName = new Map(teams.map((t) => [t.oddsApiName, t.id]))

  const { events, creditsRemaining } = await fetchNflOdds()

  const result: SyncLinesResult = {
    eventsReturned: events.length,
    linesWritten: 0,
    snapshotsWritten: 0,
    creditsRemaining,
    unmatchedEvents: [],
    gamesWithoutLines: [],
  }

  // The odds feed returns a rolling window of upcoming events across
  // weeks, so it is matched to our games rather than iterated as truth.
  const gameByPair = new Map(games.map((g) => [`${g.awayTeamId}@${g.homeTeamId}`, g]))
  const matched = new Set<string>()

  for (const event of events) {
    const homeId = idByOddsName.get(event.home_team)
    const awayId = idByOddsName.get(event.away_team)
    if (!homeId || !awayId) {
      result.unmatchedEvents.push(`${event.away_team} @ ${event.home_team}`)
      continue
    }

    const game = gameByPair.get(`${awayId}@${homeId}`)
    if (!game) continue // a different week's fixture; not an error
    matched.add(game.id)

    // Keep every book's raw payload for the admin's comparison column and
    // for the audit trail. Never read by grading.
    for (const book of event.bookmakers) {
      await db.insert(nflOddsSnapshots).values({
        gameId: game.id,
        book: book.key,
        payload: book as unknown as Record<string, unknown>,
      })
      result.snapshotsWritten++
    }

    const dk = bookmakerOf(event, 'draftkings')
    if (!dk) continue

    const ml = moneylines(event, dk)
    const values = {
      gameId: game.id,
      spread: homeSpread(event, dk),
      total: total(dk),
      homeMoneyline: ml.home,
      awayMoneyline: ml.away,
      book: 'draftkings',
      updatedAt: new Date(),
    }
    await db
      .insert(nflGameLines)
      .values(values)
      .onConflictDoUpdate({ target: nflGameLines.gameId, set: values })
    result.linesWritten++
  }

  result.gamesWithoutLines = games
    .filter((g) => !matched.has(g.id))
    .map((g) => `${g.awayTeamId}@${g.homeTeamId}`)

  return result
}

// ESPN's own DraftKings line, written alongside as a free cross-check.
// Costs no Odds API credits, so the admin review page can show the two
// side by side and a disagreement is visible before publishing rather
// than after grading.
export async function snapshotEspnLines(
  db: Db,
  season: number,
  seasonType: SeasonTypeKey,
  week: number
): Promise<number> {
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
  if (!weekRow) return 0

  const games = await db.select().from(nflGames).where(eq(nflGames.weekId, weekRow.id))
  const byFeedId = new Map(games.map((g) => [g.scheduleFeedId, g]))

  const board = await getScoreboard(season, seasonType, week)
  let written = 0

  for (const event of board.events) {
    const comp = event.competitions[0]
    const game = byFeedId.get(event.id)
    if (!comp || !game) continue
    const odds = draftKingsOdds(comp)
    if (!odds) continue

    await db.insert(nflOddsSnapshots).values({
      gameId: game.id,
      book: `espn:${odds.provider?.name ?? 'unknown'}`,
      // `spread` here is home perspective; `details` is favourite
      // perspective. Both are stored raw so the disagreement is
      // inspectable, but only `spread` is ever read.
      payload: {
        spread: odds.spread ?? null,
        overUnder: odds.overUnder ?? null,
        details: odds.details ?? null,
        home: abbrOf(sideOf(comp, 'home')),
        away: abbrOf(sideOf(comp, 'away')),
      },
    })
    written++
  }
  return written
}

// Trim the audit trail. Snapshots grow by (games x books x markets) every
// week and nothing reads the old ones.
export async function pruneSnapshots(db: Db, olderThan: Date): Promise<void> {
  await db.delete(nflOddsSnapshots).where(lte(nflOddsSnapshots.fetchedAt, olderThan))
}
