// ESPN public scoreboard client — schedule, live state and final scores.
//
// Undocumented and unversioned, which is the price of free and unmetered.
// It is deliberately the ONLY module that knows this shape, so a break is
// one file to fix (golf wraps SlashGolf the same way).
//
// Field shapes verified against a live response on 2026-08-13
// (dates=2026&seasontype=2&week=1 — 16 events, all with odds).

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'

// ESPN's seasontype query values. 4 (off season) has no entries.
export const SEASON_TYPE_CODE = { pre: 1, regular: 2, post: 3 } as const
export type SeasonTypeKey = keyof typeof SEASON_TYPE_CODE

// ---- Typed slices of the response we actually consume ----

export interface EspnCalendarEntry {
  label: string // 'Week 1', 'Wild Card'
  value: string // week number, as a string
  startDate: string
  endDate: string
}

export interface EspnCalendarSection {
  label: string // 'Preseason' | 'Regular Season' | 'Postseason' | 'Off Season'
  value: string // matches SEASON_TYPE_CODE
  entries?: EspnCalendarEntry[]
}

export interface EspnCompetitor {
  homeAway: 'home' | 'away'
  team: { abbreviation: string; displayName: string }
  score?: string // yes, a string — '0', '24'
  // Present and true only for the winner of a completed game. Absent or
  // null before kickoff, and false for BOTH sides of a tie.
  winner?: boolean | null
}

export interface EspnOdds {
  provider: { name: string } // 'DraftKings'
  // FAVOURITE perspective: 'BAL -3.5' even when Baltimore is away.
  details?: string
  // HOME perspective: +3.5 for that same game. These two disagree on
  // sign whenever the away team is favoured, and reading `details`
  // instead of `spread` inverts every ATS grade. Verified 2026-08-13 on
  // BAL@IND, CHI@CAR, BUF@HOU and DAL@NYG.
  spread?: number
  overUnder?: number
}

export interface EspnCompetition {
  competitors: EspnCompetitor[]
  status: { type: { name: string; state: 'pre' | 'in' | 'post'; completed: boolean } }
  odds?: EspnOdds[]
}

export interface EspnEvent {
  id: string
  date: string // ISO, e.g. '2026-09-10T00:20Z'
  name: string
  shortName: string
  competitions: EspnCompetition[]
}

export interface EspnScoreboard {
  leagues: Array<{ calendar?: EspnCalendarSection[] }>
  season: { type: number; year: number }
  week?: { number: number }
  events: EspnEvent[]
}

async function espnFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) {
    throw new Error(`ESPN ${path.split('?')[0]} returned ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function getScoreboard(
  season: number,
  seasonType: SeasonTypeKey,
  week: number
): Promise<EspnScoreboard> {
  return espnFetch<EspnScoreboard>(
    `scoreboard?dates=${season}&seasontype=${SEASON_TYPE_CODE[seasonType]}&week=${week}`
  )
}

// The calendar rides along on every scoreboard response, so seeding the
// whole season's week structure costs one request.
export async function getSeasonCalendar(season: number): Promise<EspnCalendarSection[]> {
  const board = await getScoreboard(season, 'regular', 1)
  return board.leagues[0]?.calendar ?? []
}

// ---- Normalisers ----

export function toGameStatus(c: EspnCompetition): 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled' {
  const { name, state, completed } = c.status.type
  if (name === 'STATUS_POSTPONED') return 'postponed'
  if (name === 'STATUS_CANCELED' || name === 'STATUS_CANCELLED') return 'cancelled'
  if (completed || state === 'post') return 'final'
  if (state === 'in') return 'in_progress'
  return 'scheduled'
}

export function sideOf(c: EspnCompetition, side: 'home' | 'away'): EspnCompetitor | undefined {
  return c.competitors.find((t) => t.homeAway === side)
}

export function scoreOf(t: EspnCompetitor | undefined): number | null {
  if (!t?.score) return null
  const n = Number(t.score)
  return Number.isFinite(n) ? n : null
}

// ESPN abbreviation, which is not always ours (it uses WSH for
// Washington). Callers map it through teams.schedule_feed_abbr.
export function abbrOf(t: EspnCompetitor | undefined): string | null {
  return t?.team.abbreviation ?? null
}

// Returns the winning side, or null. Null on a COMPLETED game means a
// tie, which the NFL does have — callers must not read null as "not yet
// played". Check toGameStatus() first.
export function winnerSide(c: EspnCompetition): 'home' | 'away' | null {
  const w = c.competitors.find((t) => t.winner === true)
  return w ? w.homeAway : null
}

// DraftKings is the anchor book. Falls back to whatever provider ESPN
// offers, since this is only ever a free cross-check against the Odds
// API's official number.
export function draftKingsOdds(c: EspnCompetition): EspnOdds | null {
  if (!c.odds?.length) return null
  return c.odds.find((o) => o.provider?.name === 'DraftKings') ?? c.odds[0]
}
