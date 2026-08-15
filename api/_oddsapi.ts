// The Odds API (the-odds-api.com) client — the OFFICIAL Vegas lines.
//
// Credit cost is [markets] × [regions] per request, so the query below is
// 3 credits a pull. Called once a week by /api/cron/sync-lines and by
// nothing else; scores and schedule come from ESPN, which is free and
// unmetered. Do not add this to any hourly path.
//
// Response shape per the v4 guide, confirmed 2026-08-13.

const BASE = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl'

export interface OddsOutcome {
  name: string // full team display name, or 'Over' / 'Under' on totals
  price: number
  // Spreads: this team's handicap, negative when it is favoured. Totals:
  // the over/under number. Absent on h2h.
  point?: number
}

export interface OddsMarket {
  key: 'h2h' | 'spreads' | 'totals'
  outcomes: OddsOutcome[]
}

export interface OddsBookmaker {
  key: string // 'draftkings'
  title: string
  last_update: string
  markets: OddsMarket[]
}

export interface OddsEvent {
  id: string
  sport_key: string
  commence_time: string
  // Full display names, e.g. 'Kansas City Chiefs'. The ONLY team
  // identifier this API exposes — matched through teams.odds_api_name.
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
}

export interface OddsPull {
  events: OddsEvent[]
  // Surfaced by the API as response headers. Logged by the cron so the
  // budget is visible before it runs out, not after.
  creditsRemaining: number | null
  creditsUsed: number | null
}

export async function fetchNflOdds(): Promise<OddsPull> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY not configured')

  const url =
    `${BASE}/odds?regions=us&markets=spreads,h2h,totals` +
    `&oddsFormat=american&apiKey=${encodeURIComponent(key)}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Odds API returned ${res.status}`)
  }
  const events = (await res.json()) as OddsEvent[]

  const num = (h: string | null) => (h == null || h === '' ? null : Number(h))
  return {
    events,
    creditsRemaining: num(res.headers.get('x-requests-remaining')),
    creditsUsed: num(res.headers.get('x-requests-used')),
  }
}

export function bookmakerOf(event: OddsEvent, key = 'draftkings'): OddsBookmaker | null {
  return event.bookmakers.find((b) => b.key === key) ?? null
}

function marketOf(book: OddsBookmaker, key: OddsMarket['key']): OddsMarket | null {
  return book.markets.find((m) => m.key === key) ?? null
}

// Home-perspective spread, the convention game_lines.spread stores:
// -3.5 means the home team is favoured by 3.5.
//
// The API gives a per-team handicap rather than one number, so the home
// team's own `point` IS the home-perspective value — no sign flip. Taking
// the away outcome, or assuming the first outcome is the home side, is
// how this silently inverts.
export function homeSpread(event: OddsEvent, book: OddsBookmaker): number | null {
  const m = marketOf(book, 'spreads')
  const home = m?.outcomes.find((o) => o.name === event.home_team)
  return home?.point ?? null
}

export function total(book: OddsBookmaker): number | null {
  const m = marketOf(book, 'totals')
  const over = m?.outcomes.find((o) => o.name === 'Over')
  return over?.point ?? null
}

export function moneylines(
  event: OddsEvent,
  book: OddsBookmaker
): { home: number | null; away: number | null } {
  const m = marketOf(book, 'h2h')
  return {
    home: m?.outcomes.find((o) => o.name === event.home_team)?.price ?? null,
    away: m?.outcomes.find((o) => o.name === event.away_team)?.price ?? null,
  }
}
