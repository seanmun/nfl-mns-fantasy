// When a week's results email may go out, decided in Eastern time.
//
// The email is a MORNING-AFTER note: the Eastern day after the week's
// last included kickoff, from 8am. One further day is allowed in case a
// tick was missed. After that the week is EXPIRED and is never mailed —
// a "Week 1 results" email landing in Week 3 is not information, it is
// a glitch in the member's inbox, and the standings page is always
// right anyway.
//
// Added 2026-09-24: a score-sync fix was about to decide two stale weeks
// in one pass, and without this rule the tick would have mailed both.
// Nothing in this app may send a late results email, ever.

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
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

// Whole Eastern calendar days from a to b (b later => positive).
function easternDaysBetween(a: Date, b: Date): number {
  const [ay, am, ad] = ET_DAY.format(a).split('-').map(Number)
  const [by, bm, bd] = ET_DAY.format(b).split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

export type ResultsWindow = 'wait' | 'send' | 'expired'

export const RESULTS_SEND_DAYS = 2 // the morning after, plus one day of grace

export function resultsWindow(lastKickoff: Date, now: Date): ResultsWindow {
  const days = easternDaysBetween(lastKickoff, now)
  if (days < 1) return 'wait'
  if (days > RESULTS_SEND_DAYS) return 'expired'
  return Number(ET_HOUR.format(now)) >= 8 ? 'send' : 'wait'
}
