import { describe, expect, it } from 'vitest'
import { isSettled, unsettledKickedOff } from './schedule.js'

// The 2026 Week 1 Monday night game, DEN@KC, kicked off 2026-09-15T00:15Z.
// The 00:00Z tick saw it 'scheduled'. By the 01:00Z tick currentWeek()
// had rolled to Week 2 and, under the old rule, Week 1 was never fetched
// again — the game sat at scheduled 0-0 and its picks at 'pending'.
// This suite pins the rule that replaced it: a game is fetched until it
// is settled, whatever week the calendar says it is.
const W1 = 'week-1'
const W2 = 'week-2'
const mondayNight = { weekId: W1, status: 'scheduled' as const, kickoffAt: new Date('2026-09-15T00:15:00Z') }
const sundayFinal = { weekId: W1, status: 'final' as const, kickoffAt: new Date('2026-09-13T17:00:00Z') }
const nextThursday = { weekId: W2, status: 'scheduled' as const, kickoffAt: new Date('2026-09-18T00:15:00Z') }

describe('unsettledKickedOff', () => {
  it('keeps Week 1 in the fetch set at the tick that used to drop it', () => {
    const now = new Date('2026-09-15T01:00:00Z')
    expect(unsettledKickedOff([sundayFinal, mondayNight, nextThursday], now)).toEqual([mondayNight])
  })

  it('keeps it there nine days later if the final never landed', () => {
    const now = new Date('2026-09-24T17:00:00Z')
    const thursdayDone = { ...nextThursday, status: 'final' as const }
    expect(unsettledKickedOff([mondayNight, thursdayDone], now)).toEqual([mondayNight])
  })

  it('lets the week go once the game is final', () => {
    const done = { ...mondayNight, status: 'final' as const }
    expect(unsettledKickedOff([sundayFinal, done], new Date('2026-09-15T04:00:00Z'))).toEqual([])
  })

  it('fetches a game in play', () => {
    const live = { ...mondayNight, status: 'in_progress' as const }
    expect(unsettledKickedOff([live], new Date('2026-09-15T02:00:00Z'))).toEqual([live])
  })

  it('does not fetch a game that has not kicked off', () => {
    expect(unsettledKickedOff([mondayNight, nextThursday], new Date('2026-09-15T00:00:00Z'))).toEqual([])
  })

  it('kickoff itself counts as kicked off', () => {
    expect(unsettledKickedOff([mondayNight], new Date('2026-09-15T00:15:00Z'))).toEqual([mondayNight])
  })

  it('keeps watching a postponed game, drops a cancelled one', () => {
    const postponed = { ...mondayNight, status: 'postponed' as const }
    const cancelled = { ...mondayNight, status: 'cancelled' as const }
    const now = new Date('2026-09-20T00:00:00Z')
    expect(unsettledKickedOff([postponed, cancelled], now)).toEqual([postponed])
  })
})

describe('isSettled', () => {
  it('final and cancelled are terminal; everything else can still change', () => {
    expect(isSettled('final')).toBe(true)
    expect(isSettled('cancelled')).toBe(true)
    expect(isSettled('scheduled')).toBe(false)
    expect(isSettled('in_progress')).toBe(false)
    expect(isSettled('postponed')).toBe(false)
  })
})
