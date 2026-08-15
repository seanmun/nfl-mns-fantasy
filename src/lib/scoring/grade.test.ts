import { describe, expect, it } from 'vitest'
import { UngradableError, gradePick, resolvePick, survivorStrike, isEliminated } from './grade.js'
import type { SurvivorScoring } from './config.js'

// Fixtures are REAL 2026 Week 1 lines pulled from ESPN on 2026-08-13, so
// the sign convention is pinned to something that actually shipped rather
// than to a number chosen to make the test pass.

// BAL @ IND — ESPN details "BAL -3.5", spread +3.5. The away team is
// favoured, so the home-perspective number is POSITIVE. This is the case
// that silently inverts if anyone parses `details` instead of `spread`.
const balAtInd = { homeTeamId: 'IND', awayTeamId: 'BAL', homeScore: 0, awayScore: 0 }

// NE @ SEA — "SEA -3.5", spread -3.5. Home favourite, negative.
const neAtSea = { homeTeamId: 'SEA', awayTeamId: 'NE', homeScore: 0, awayScore: 0 }

// DEN @ KC — "KC -3". A whole number, so it can land exactly on a push.
const denAtKc = { homeTeamId: 'KC', awayTeamId: 'DEN', homeScore: 24, awayScore: 21 }

describe('resolvePick — against the spread', () => {
  it('pays the away favourite when it covers', () => {
    const g = { ...balAtInd, homeScore: 17, awayScore: 24 } // BAL by 7
    expect(resolvePick(g, 'BAL', 'ats', 3.5)).toBe('win')
    expect(resolvePick(g, 'IND', 'ats', 3.5)).toBe('loss')
  })

  it('pays the home underdog when the away favourite wins by less than the number', () => {
    const g = { ...balAtInd, homeScore: 21, awayScore: 24 } // BAL by 3, needed 3.5
    expect(resolvePick(g, 'BAL', 'ats', 3.5)).toBe('loss')
    expect(resolvePick(g, 'IND', 'ats', 3.5)).toBe('win')
  })

  it('handles a home favourite on the other side of zero', () => {
    expect(resolvePick({ ...neAtSea, homeScore: 24, awayScore: 20 }, 'SEA', 'ats', -3.5)).toBe('win')
    expect(resolvePick({ ...neAtSea, homeScore: 23, awayScore: 20 }, 'SEA', 'ats', -3.5)).toBe('loss')
  })

  it('pushes both sides when a whole-number spread lands exactly', () => {
    expect(resolvePick(denAtKc, 'KC', 'ats', -3)).toBe('push')
    expect(resolvePick(denAtKc, 'DEN', 'ats', -3)).toBe('push')
  })

  it('refuses to grade an ATS pool with no published line', () => {
    // Falling through to a 0 spread would regrade the slate straight-up
    // and read as a scoring bug rather than a missing publish.
    expect(() => resolvePick(denAtKc, 'KC', 'ats', null)).toThrow(UngradableError)
  })
})

describe('resolvePick — straight up', () => {
  it('ignores the line entirely', () => {
    expect(resolvePick(denAtKc, 'KC', 'straight_up', -3)).toBe('win')
    expect(resolvePick(denAtKc, 'DEN', 'straight_up', -3)).toBe('loss')
  })

  it('treats a genuine NFL tie as a push', () => {
    const tie = { ...denAtKc, homeScore: 20, awayScore: 20 }
    expect(resolvePick(tie, 'KC', 'straight_up', null)).toBe('push')
  })

  it('rejects a pick for a team that is not in the game', () => {
    expect(() => resolvePick(denAtKc, 'PHI', 'straight_up', null)).toThrow(UngradableError)
  })
})

describe('gradePick', () => {
  const classic = { winPoints: 1, pushPoints: 0, tiebreaker: 'none' as const }

  it('pays classic pools a flat point', () => {
    expect(gradePick({
      poolType: 'classic', spreadMode: 'straight_up', config: classic,
      game: denAtKc, selectedTeamId: 'KC', officialSpread: null,
    })).toEqual({ result: 'win', pointsEarned: 1 })
  })

  it('pays confidence pools the rank the user assigned', () => {
    expect(gradePick({
      poolType: 'confidence', spreadMode: 'ats',
      config: { pushBehavior: 'award', tiebreaker: 'none' },
      game: denAtKc, selectedTeamId: 'KC', confidencePoints: 12, officialSpread: -2.5,
    })).toEqual({ result: 'win', pointsEarned: 12 })
  })

  it('honours pushBehavior on a confidence push', () => {
    expect(gradePick({
      poolType: 'confidence', spreadMode: 'ats',
      config: { pushBehavior: 'void', tiebreaker: 'none' },
      game: denAtKc, selectedTeamId: 'KC', confidencePoints: 12, officialSpread: -3,
    })).toEqual({ result: 'push', pointsEarned: 0 })
  })

  it('refuses a confidence pick with no rank rather than paying zero', () => {
    // A silent 0 would quietly cost someone their week.
    expect(() => gradePick({
      poolType: 'confidence', spreadMode: 'straight_up',
      config: { pushBehavior: 'award', tiebreaker: 'none' },
      game: denAtKc, selectedTeamId: 'KC', confidencePoints: null, officialSpread: null,
    })).toThrow(UngradableError)
  })
})

describe('survivor', () => {
  const base: SurvivorScoring = { maxStrikes: 1, tiePolicy: 'survive', missedPickPolicy: 'eliminate' }

  it('strikes on a loss and not on a win', () => {
    expect(survivorStrike('loss', base)).toBe(true)
    expect(survivorStrike('win', base)).toBe(false)
  })

  it('lets tiePolicy decide what a tie costs', () => {
    expect(survivorStrike('push', base)).toBe(false)
    expect(survivorStrike('push', { ...base, tiePolicy: 'loss' })).toBe(true)
  })

  it('lets missedPickPolicy decide what forgetting costs', () => {
    expect(survivorStrike('missed', base)).toBe(true)
    expect(survivorStrike('missed', { ...base, missedPickPolicy: 'auto_favorite' })).toBe(false)
  })

  it('eliminates once strikes reach the pool maximum', () => {
    expect(isEliminated(0, base)).toBe(false)
    expect(isEliminated(1, base)).toBe(true)
    expect(isEliminated(1, { ...base, maxStrikes: 2 })).toBe(false)
  })
})
