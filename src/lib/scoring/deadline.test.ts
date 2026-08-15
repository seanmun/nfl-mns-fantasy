import { describe, expect, it } from 'vitest'
import { anchorKickoff, computeDeadline, easternParts, isPickable, isTbdKickoff } from './deadline.js'

// 2026 US DST ends Sunday 1 November. Sunday 1pm ET is 17:00Z before that
// and 18:00Z after, which is the entire reason this module exists.

describe('easternParts', () => {
  it('reads 1pm ET on both sides of the DST change', () => {
    expect(easternParts(new Date('2026-10-25T17:00:00Z'))).toEqual({ weekday: 'Sun', minutesIntoDay: 780 })
    expect(easternParts(new Date('2026-11-08T18:00:00Z'))).toEqual({ weekday: 'Sun', minutesIntoDay: 780 })
  })

  it('does not mistake the same UTC hour for the same wall clock', () => {
    // The bug a UTC-based deadline would ship: 17:00Z is 1pm ET in
    // October and only noon ET in November.
    expect(easternParts(new Date('2026-11-08T17:00:00Z'))).toEqual({ weekday: 'Sun', minutesIntoDay: 720 })
  })
})

// Thu night, Sunday 9:30am ET London, Sunday 1pm, Sunday 4:25pm, Mon night.
const octSlate = [
  new Date('2026-10-22T00:15:00Z'),
  new Date('2026-10-25T13:30:00Z'),
  new Date('2026-10-25T17:00:00Z'),
  new Date('2026-10-25T20:25:00Z'),
  new Date('2026-10-26T00:20:00Z'),
]

describe('anchorKickoff', () => {
  it('skips the Sunday morning London game', () => {
    // Not just "the first Sunday game" — that is the whole distinction.
    expect(anchorKickoff('sunday_1pm_et', octSlate)?.toISOString()).toBe('2026-10-25T17:00:00.000Z')
  })

  it('holds the ET wall clock across the DST change', () => {
    const nov = [new Date('2026-11-08T13:30:00Z'), new Date('2026-11-08T18:00:00Z')]
    expect(anchorKickoff('sunday_1pm_et', nov)?.toISOString()).toBe('2026-11-08T18:00:00.000Z')
  })

  it('takes the earliest kickoff under the other anchor', () => {
    expect(anchorKickoff('first_included_kickoff', octSlate)?.toISOString()).toBe('2026-10-22T00:15:00.000Z')
  })

  it('returns null rather than guessing', () => {
    // Null means the admin types it at publish. Guessing would silently
    // set a wrong cutoff for an entire pool.
    expect(anchorKickoff('manual', octSlate)).toBeNull()
    expect(anchorKickoff('sunday_1pm_et', [new Date('2026-10-25T13:30:00Z')])).toBeNull()
    expect(anchorKickoff('first_included_kickoff', [])).toBeNull()
  })
})

describe('computeDeadline', () => {
  it('subtracts the offset from the anchor', () => {
    expect(computeDeadline('sunday_1pm_et', 0, octSlate)?.toISOString()).toBe('2026-10-25T17:00:00.000Z')
    expect(computeDeadline('sunday_1pm_et', 60, octSlate)?.toISOString()).toBe('2026-10-25T16:00:00.000Z')
  })
})

describe('isPickable', () => {
  const linesPublishedAt = new Date('2026-10-24T02:00:00Z')
  const pickDeadlineAt = new Date('2026-10-25T17:00:00Z')
  const mondayNight = new Date('2026-10-26T00:20:00Z')
  const saturday = new Date('2026-10-24T21:00:00Z')

  it('refuses everything until the week is published', () => {
    expect(isPickable({
      now: new Date('2026-10-24T12:00:00Z'), linesPublishedAt: null, pickDeadlineAt, kickoffAt: mondayNight,
    })).toBe(false)
  })

  it('is open while both cutoffs are ahead', () => {
    expect(isPickable({
      now: new Date('2026-10-24T12:00:00Z'), linesPublishedAt, pickDeadlineAt, kickoffAt: mondayNight,
    })).toBe(true)
  })

  it('closes a Monday game at the Sunday deadline, long before its kickoff', () => {
    expect(isPickable({
      now: new Date('2026-10-25T17:30:00Z'), linesPublishedAt, pickDeadlineAt, kickoffAt: mondayNight,
    })).toBe(false)
  })

  it('closes an early game at its own kickoff, before the deadline', () => {
    // Otherwise a Saturday game could be picked on Sunday morning by
    // someone who already knows how it went.
    expect(isPickable({
      now: new Date('2026-10-24T22:00:00Z'), linesPublishedAt, pickDeadlineAt, kickoffAt: saturday,
    })).toBe(false)
  })
})

// ── TBD kickoffs ────────────────────────────────────────────────────
// The NFL sets late-season times only once playoff implications are
// known; ESPN marks those as midnight ET. Verified against the live 2026
// schedule: 24 of 272 games, all 16 of Week 18 among them.
describe('TBD kickoffs', () => {
  // 2027-01-03T05:00:00Z is exactly midnight ET on the Sunday of Week 18.
  const TBD = new Date('2027-01-03T05:00:00Z')
  const REAL = new Date('2027-01-03T18:00:00Z') // 1:00 PM ET same day

  it('recognises midnight ET as a placeholder', () => {
    expect(isTbdKickoff(TBD)).toBe(true)
    expect(isTbdKickoff(REAL)).toBe(false)
  })

  it('never lets a placeholder lock its own game', () => {
    // Midnight would otherwise read as "already started" all day, making
    // every unscheduled game unpickable.
    expect(isPickable({
      now: new Date('2027-01-03T16:00:00Z'), // 11am ET, well past midnight
      linesPublishedAt: new Date('2026-12-30T02:00:00Z'),
      pickDeadlineAt: new Date('2027-01-03T18:00:00Z'),
      kickoffAt: TBD,
    })).toBe(true)
  })

  it('still closes a placeholder at the week deadline', () => {
    expect(isPickable({
      now: new Date('2027-01-03T18:30:00Z'),
      linesPublishedAt: new Date('2026-12-30T02:00:00Z'),
      pickDeadlineAt: new Date('2027-01-03T18:00:00Z'),
      kickoffAt: TBD,
    })).toBe(false)
  })

  it('does not hang a deadline on a placeholder', () => {
    // A week that is entirely TBD has no anchor, so the admin types it.
    expect(anchorKickoff('sunday_1pm_et', [TBD, TBD])).toBeNull()
    // A real Sunday afternoon game is preferred over a placeholder.
    expect(anchorKickoff('sunday_1pm_et', [TBD, REAL])?.toISOString()).toBe(REAL.toISOString())
  })
})
