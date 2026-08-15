import { describe, expect, it } from 'vitest'
import { mulberry32, selectAutoPicks, selectKeyPick } from './autopick.js'
import { rankStandings } from './standings.js'

const now = new Date('2026-10-25T17:00:00Z') // the Sunday 1pm ET deadline

const candidates = [
  { gameId: 'fri', homeTeamId: 'KC', awayTeamId: 'DEN', kickoffAt: new Date('2026-10-23T23:00:00Z') },
  { gameId: 'sat', homeTeamId: 'PHI', awayTeamId: 'DAL', kickoffAt: new Date('2026-10-24T21:00:00Z') },
  { gameId: 'a', homeTeamId: 'BUF', awayTeamId: 'MIA', kickoffAt: new Date('2026-10-25T17:00:01Z') },
  { gameId: 'b', homeTeamId: 'SEA', awayTeamId: 'SF', kickoffAt: new Date('2026-10-25T20:25:00Z') },
  { gameId: 'c', homeTeamId: 'GB', awayTeamId: 'MIN', kickoffAt: new Date('2026-10-26T00:20:00Z') },
]

describe('selectAutoPicks', () => {
  it('never assigns a game that has already kicked off', () => {
    // The Friday and Saturday games are on the slate but are history by
    // the deadline — assigning one hands out a pick on a known result.
    const got = selectAutoPicks({
      candidates, alreadyPickedGameIds: new Set(['b']), needed: 2, now, rng: mulberry32(7),
    })
    expect(got.map((p) => p.gameId).sort()).toEqual(['a', 'c'])
  })

  it('always picks a side that is actually in the game', () => {
    const got = selectAutoPicks({
      candidates, alreadyPickedGameIds: new Set(), needed: 3, now, rng: mulberry32(11),
    })
    for (const p of got) {
      const g = candidates.find((c) => c.gameId === p.gameId)!
      expect([g.homeTeamId, g.awayTeamId]).toContain(p.selectedTeamId)
    }
  })

  it('is reproducible for a given seed', () => {
    // So "the app picked for me" is something the admin can demonstrate.
    const run = () => selectAutoPicks({
      candidates, alreadyPickedGameIds: new Set(), needed: 3, now, rng: mulberry32(42),
    })
    expect(run()).toEqual(run())
  })

  it('assigns what it can when fewer games remain than picks owed', () => {
    expect(selectAutoPicks({
      candidates, alreadyPickedGameIds: new Set(), needed: 5, now, rng: mulberry32(1),
    })).toHaveLength(3)
  })

  it('does nothing for an entry that already picked its five', () => {
    expect(selectAutoPicks({
      candidates, alreadyPickedGameIds: new Set(), needed: 0, now, rng: mulberry32(1),
    })).toEqual([])
  })
})

describe('selectKeyPick', () => {
  it('chooses from the entry’s own picks', () => {
    expect(['p1', 'p2', 'p3']).toContain(selectKeyPick(['p1', 'p2', 'p3'], mulberry32(3)))
  })

  it('has nothing to choose from when there are no picks', () => {
    expect(selectKeyPick([], mulberry32(3))).toBeNull()
  })
})

describe('rankStandings', () => {
  it('sorts by points, breaks ties on key score, and shares a rank on a true tie', () => {
    // Competition ranking: 1, 2, 2, 4. Splitting a genuine tie by row
    // order is the kind of thing members notice when money is involved.
    const ranked = rankStandings([
      { entryId: 'low', totalPoints: 40.5, keyPickScore: 9 },
      { entryId: 'tieA', totalPoints: 52, keyPickScore: 6 },
      { entryId: 'top', totalPoints: 52, keyPickScore: 8 },
      { entryId: 'tieB', totalPoints: 52, keyPickScore: 6 },
    ])
    expect(ranked.map((r) => [r.entryId, r.rank])).toEqual([
      ['top', 1], ['tieA', 2], ['tieB', 2], ['low', 4],
    ])
  })

  it('does not let key picks outrank points', () => {
    const ranked = rankStandings([
      { entryId: 'manyKeys', totalPoints: 40, keyPickScore: 12 },
      { entryId: 'morePoints', totalPoints: 41, keyPickScore: 0 },
    ])
    expect(ranked[0].entryId).toBe('morePoints')
  })
})
