import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Every time shown to a member is Eastern, labelled, never their local
// zone — the app has to say the same thing the pool's group chat says.
// See the time-display decision in CLAUDE.md.
const ET_DATETIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const ET_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'long',
})

export function kickoffLabel(date: Date | string): string {
  return `${ET_DATETIME.format(new Date(date))} ET`
}

export function dayLabel(date: Date | string): string {
  return ET_DAY.format(new Date(date))
}

// How one pick stands, in words: the graded result once there is one,
// else AHEAD / BEHIND / TIED while the game is live. An ATS pick stands
// against the number it took — the same maths as grade.ts — so "ahead"
// means covering, not merely leading. Null before kickoff.
export function pickStanding(
  pick: { selectedTeamId: string; result: string; lineSpreadAtPick: number | null },
  game: {
    status: string
    homeScore: number | null
    awayScore: number | null
    spread: number | null
    home: { id: string } | null
  },
  spreadMode: 'straight_up' | 'ats'
): { word: string; tone: 'win' | 'loss' | 'push' } | null {
  if (pick.result === 'win') return { word: 'WON', tone: 'win' }
  if (pick.result === 'loss') return { word: 'LOST', tone: 'loss' }
  if (pick.result === 'push') return { word: 'PUSH', tone: 'push' }
  if (game.status !== 'in_progress' || game.homeScore == null || game.awayScore == null) {
    return null
  }
  const isHome = pick.selectedTeamId === game.home?.id
  const line = spreadMode === 'ats' ? pick.lineSpreadAtPick ?? game.spread ?? 0 : 0
  const margin = isHome
    ? game.homeScore - game.awayScore + line
    : game.awayScore - game.homeScore - line
  if (margin > 0) return { word: 'AHEAD', tone: 'win' }
  if (margin < 0) return { word: 'BEHIND', tone: 'loss' }
  return { word: 'TIED', tone: 'push' }
}

// Text colour for a standing's tone on the muted and accent-soft tiles.
// Push reads in muted-foreground, not --color-pick-push: that grey
// measures 4.34 on those tiles in the light theme (under AA 4.5), while
// muted-foreground clears 5.37. Win and loss measure 4.52+ in both.
export const TONE_COLOR = {
  win: 'var(--color-pick-win)',
  loss: 'var(--color-pick-loss)',
  push: 'var(--color-muted-foreground)',
} as const

// Spreads are stored home-perspective; a member reads each team's own
// number. -3.5 for the home side means +3.5 for the away side.
export function teamSpread(homeSpread: number | null, side: 'home' | 'away'): string | null {
  if (homeSpread == null) return null
  const n = side === 'home' ? homeSpread : -homeSpread
  return n > 0 ? `+${n}` : String(n)
}
