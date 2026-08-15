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

// Spreads are stored home-perspective; a member reads each team's own
// number. -3.5 for the home side means +3.5 for the away side.
export function teamSpread(homeSpread: number | null, side: 'home' | 'away'): string | null {
  if (homeSpread == null) return null
  const n = side === 'home' ? homeSpread : -homeSpread
  return n > 0 ? `+${n}` : String(n)
}
