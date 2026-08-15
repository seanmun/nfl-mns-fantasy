import type { DeadlineAnchor } from '../db/schema.js'

// Deadline arithmetic, done in the POOL's timezone rather than UTC.
//
// "Sunday 1pm ET" is 17:00 UTC for part of the season and 18:00 UTC for
// the rest. Computing it in UTC gets the deadline wrong by an hour on
// either side of a DST change — in one direction it closes picks an hour
// early, which for a pool with money in it is not a rounding error. Golf
// hit the same class of bug with venue-local sync windows.
//
// Intl is used rather than a date library because it is built in and
// already knows the DST table.

const ZONE = 'America/New_York'

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
})

export interface ZonedParts {
  weekday: string // 'Sun', 'Mon', ...
  minutesIntoDay: number
}

export function easternParts(d: Date): ZonedParts {
  const parts = FMT.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  // Intl renders midnight as hour 24 under hour12:false, so normalise it
  // back to 0 — otherwise a Sunday 00:15 kickoff sorts after 1pm.
  const hour = Number(get('hour')) % 24
  return {
    weekday: get('weekday'),
    minutesIntoDay: hour * 60 + Number(get('minute')),
  }
}

const SUNDAY_AFTERNOON = 13 * 60

// The NFL does not set late-season kickoff times until playoff
// implications are known, and ESPN represents "not scheduled yet" as
// midnight ET. Verified against the live 2026 schedule on 2026-08-14:
// 24 of 272 games, including all 16 of Week 18 and 4 of Week 17.
//
// This has to be handled explicitly, because midnight is the WORST
// possible placeholder: a game stored at 00:00 reads as "already kicked
// off" from one second past midnight, so it would show as locked for the
// entire day and nobody could pick it. No real NFL game starts at
// midnight ET, so the marker is unambiguous.
export function isTbdKickoff(kickoffAt: Date): boolean {
  return easternParts(kickoffAt).minutesIntoDay === 0
}

// The kickoff a week's deadline hangs off, or null when the rule finds
// nothing to hang it on.
//
// Null is not a failure to be papered over — it means the admin has to
// type the deadline himself at publish. Guessing here would silently set
// a wrong cutoff for a whole pool, which is far worse than asking.
export function anchorKickoff(anchor: DeadlineAnchor, kickoffs: Date[]): Date | null {
  if (anchor === 'manual' || kickoffs.length === 0) return null

  const sorted = [...kickoffs].sort((a, b) => a.getTime() - b.getTime())

  if (anchor === 'first_included_kickoff') return sorted[0]

  // sunday_1pm_et: the first included game kicking off at or after 13:00
  // ET on a Sunday. Deliberately skips Sunday morning London games, which
  // is the whole reason this is not just "the first Sunday game", and
  // skips TBD placeholders, which are not real times to hang a deadline
  // on. A week that is entirely TBD returns null and the admin types the
  // deadline — which is exactly Week 18 until the NFL schedules it.
  return (
    sorted.find((k) => {
      if (isTbdKickoff(k)) return false
      const { weekday, minutesIntoDay } = easternParts(k)
      return weekday === 'Sun' && minutesIntoDay >= SUNDAY_AFTERNOON
    }) ?? null
  )
}

// The pool's cutoff for a week. offsetMinutes is subtracted, so 60 means
// "one hour before the anchor" and 0 means "exactly at it".
export function computeDeadline(
  anchor: DeadlineAnchor,
  offsetMinutes: number,
  kickoffs: Date[]
): Date | null {
  const at = anchorKickoff(anchor, kickoffs)
  if (!at) return null
  return new Date(at.getTime() - offsetMinutes * 60_000)
}

// A game is pickable only while BOTH cutoffs are still ahead of it. See
// the rule block on the picks table — dropping either half reintroduces a
// real bug, so this is the single place that decides it.
export function isPickable(opts: {
  now: Date
  linesPublishedAt: Date | null
  pickDeadlineAt: Date | null
  kickoffAt: Date
}): boolean {
  const { now, linesPublishedAt, pickDeadlineAt, kickoffAt } = opts
  if (!linesPublishedAt) return false
  if (pickDeadlineAt && now >= pickDeadlineAt) return false
  // A TBD kickoff cannot lock its own game. Midnight would read as
  // "already started" all day, silently making the game unpickable. The
  // week deadline still closes it, so nothing is left open indefinitely.
  if (isTbdKickoff(kickoffAt)) return true
  return now < kickoffAt
}
