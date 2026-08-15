import { describe, expect, it } from 'vitest'
import { validatePicks, type SlateGame, type ValidateInput } from './validate.js'

// A realistic slate: one game already played (Thursday), the rest of the
// week still ahead, deadline at Sunday 1pm ET.
const THU = new Date('2026-09-11T00:20:00Z')
const SUN_EARLY = new Date('2026-09-13T17:00:00Z')
const SUN_LATE = new Date('2026-09-13T20:25:00Z')
const MON = new Date('2026-09-14T00:15:00Z')

const SLATE: SlateGame[] = [
  { gameId: 'thu', homeTeamId: 'KC', awayTeamId: 'DEN', kickoffAt: THU, spread: -3 },
  { gameId: 'a', homeTeamId: 'CIN', awayTeamId: 'TB', kickoffAt: SUN_EARLY, spread: -3.5 },
  { gameId: 'b', homeTeamId: 'DET', awayTeamId: 'NO', kickoffAt: SUN_EARLY, spread: -7 },
  { gameId: 'c', homeTeamId: 'MIN', awayTeamId: 'GB', kickoffAt: SUN_LATE, spread: -1.5 },
  { gameId: 'd', homeTeamId: 'NYG', awayTeamId: 'DAL', kickoffAt: MON, spread: 2.5 },
]

// Saturday: everything except the Thursday game is still open.
const SATURDAY = new Date('2026-09-12T15:00:00Z')
const DEADLINE = SUN_EARLY

function base(over: Partial<ValidateInput> = {}): ValidateInput {
  return {
    poolType: 'pick_n',
    picksRequired: 3,
    keyPickEnabled: true,
    slate: SLATE,
    existing: [],
    proposed: [],
    now: SATURDAY,
    linesPublishedAt: new Date('2026-09-10T02:00:00Z'),
    pickDeadlineAt: DEADLINE,
    ...over,
  }
}

describe('week-level gates', () => {
  it('refuses picks before the week is published', () => {
    const r = validatePicks(base({ linesPublishedAt: null, proposed: [{ gameId: 'a', selectedTeamId: 'TB' }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/not been published/)
  })

  it('refuses picks after the deadline', () => {
    const r = validatePicks(base({
      now: new Date('2026-09-13T17:30:00Z'),
      proposed: [{ gameId: 'c', selectedTeamId: 'GB' }],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/deadline/)
  })

  it('closes a Monday game at the Sunday deadline, not at its own kickoff', () => {
    // The whole point of the global deadline: Monday is unpickable well
    // before it kicks off.
    const r = validatePicks(base({
      now: new Date('2026-09-13T17:30:00Z'),
      proposed: [{ gameId: 'd', selectedTeamId: 'DAL' }],
    }))
    expect(r.ok).toBe(false)
  })
})

describe('locked games', () => {
  it('will not accept a new pick on a game that already kicked off', () => {
    const r = validatePicks(base({ proposed: [{ gameId: 'thu', selectedTeamId: 'KC' }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/already started/)
  })

  it('refuses to change a pick on a game that already kicked off', () => {
    const r = validatePicks(base({
      existing: [{ pickId: 'p1', gameId: 'thu', selectedTeamId: 'KC' }],
      proposed: [{ gameId: 'thu', selectedTeamId: 'DEN' }],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/no longer be changed/)
  })

  it('carries a locked pick through when the client omits it', () => {
    // A client that sends only the still-open games must not silently
    // delete the pick that has already kicked off.
    const r = validatePicks(base({
      existing: [{ pickId: 'p1', gameId: 'thu', selectedTeamId: 'KC' }],
      proposed: [{ gameId: 'a', selectedTeamId: 'TB' }],
    }))
    expect(r.ok).toBe(true)
    expect(r.effective).toHaveLength(2)
    expect(r.effective.find((p) => p.gameId === 'thu')?.selectedTeamId).toBe('KC')
  })

  it('accepts a locked pick resent unchanged', () => {
    const r = validatePicks(base({
      existing: [{ pickId: 'p1', gameId: 'thu', selectedTeamId: 'KC' }],
      proposed: [
        { gameId: 'thu', selectedTeamId: 'KC' },
        { gameId: 'a', selectedTeamId: 'TB' },
      ],
    }))
    expect(r.ok).toBe(true)
    expect(r.effective).toHaveLength(2)
  })
})

describe('per-pick sanity', () => {
  it('rejects a team that is not in the game', () => {
    const r = validatePicks(base({ proposed: [{ gameId: 'a', selectedTeamId: 'PHI' }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/not playing/)
  })

  it('rejects a game that is not on this pool’s slate', () => {
    // The admin excluded it, so it does not exist for this pool.
    const r = validatePicks(base({ proposed: [{ gameId: 'excluded', selectedTeamId: 'PHI' }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/not part of this pool/)
  })

  it('rejects two picks on the same game', () => {
    const r = validatePicks(base({
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB' },
        { gameId: 'a', selectedTeamId: 'CIN' },
      ],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/one team per game/)
  })
})

describe('counts', () => {
  it('allows a partial save', () => {
    // Someone picking two of three on Saturday keeps their work.
    const r = validatePicks(base({ proposed: [{ gameId: 'a', selectedTeamId: 'TB' }] }))
    expect(r.ok).toBe(true)
  })

  it('rejects more picks than the pool allows', () => {
    const r = validatePicks(base({
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB' },
        { gameId: 'b', selectedTeamId: 'NO' },
        { gameId: 'c', selectedTeamId: 'GB' },
        { gameId: 'd', selectedTeamId: 'DAL' },
      ],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/takes 3 picks/)
  })

  it('counts a carried-over locked pick toward the limit', () => {
    // Three open picks plus a locked one is four, which is over.
    const r = validatePicks(base({
      existing: [{ pickId: 'p1', gameId: 'thu', selectedTeamId: 'KC' }],
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB' },
        { gameId: 'b', selectedTeamId: 'NO' },
        { gameId: 'c', selectedTeamId: 'GB' },
      ],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/takes 3 picks/)
  })
})

describe('key pick', () => {
  it('accepts exactly one', () => {
    const r = validatePicks(base({
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB', isKeyPick: true },
        { gameId: 'b', selectedTeamId: 'NO' },
      ],
    }))
    expect(r.ok).toBe(true)
  })

  it('rejects two', () => {
    const r = validatePicks(base({
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB', isKeyPick: true },
        { gameId: 'b', selectedTeamId: 'NO', isKeyPick: true },
      ],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/[Oo]nly one pick/)
  })

  it('does not require one on a partial save', () => {
    // The deadline job assigns a key if it is still missing; refusing
    // the save would lose the member's work instead.
    const r = validatePicks(base({ proposed: [{ gameId: 'a', selectedTeamId: 'TB' }] }))
    expect(r.ok).toBe(true)
  })

  it('rejects a key pick in a pool that does not use them', () => {
    const r = validatePicks(base({
      keyPickEnabled: false,
      proposed: [{ gameId: 'a', selectedTeamId: 'TB', isKeyPick: true }],
    }))
    expect(r.ok).toBe(false)
  })
})

describe('survivor', () => {
  const survivor = (over: Partial<ValidateInput> = {}) =>
    validatePicks(base({
      poolType: 'survivor',
      picksRequired: 1,
      keyPickEnabled: false,
      ...over,
    }))

  it('takes one pick', () => {
    expect(survivor({ proposed: [{ gameId: 'a', selectedTeamId: 'TB' }] }).ok).toBe(true)
  })

  it('rejects two', () => {
    const r = survivor({
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB' },
        { gameId: 'b', selectedTeamId: 'NO' },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a team already used this season', () => {
    const r = survivor({
      proposed: [{ gameId: 'a', selectedTeamId: 'TB' }],
      usedTeamIds: new Set(['TB', 'KC']),
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/already used/)
  })

  it('allows a team not yet used', () => {
    const r = survivor({
      proposed: [{ gameId: 'a', selectedTeamId: 'CIN' }],
      usedTeamIds: new Set(['TB', 'KC']),
    })
    expect(r.ok).toBe(true)
  })
})

describe('confidence', () => {
  const conf = (proposed: ValidateInput['proposed']) =>
    validatePicks(base({
      poolType: 'confidence',
      picksRequired: null, // every game
      keyPickEnabled: false,
      proposed,
    }))

  it('accepts a clean permutation over the open games', () => {
    const r = conf([
      { gameId: 'a', selectedTeamId: 'TB', confidencePoints: 4 },
      { gameId: 'b', selectedTeamId: 'NO', confidencePoints: 3 },
      { gameId: 'c', selectedTeamId: 'GB', confidencePoints: 2 },
      { gameId: 'd', selectedTeamId: 'DAL', confidencePoints: 1 },
    ])
    expect(r.ok).toBe(true)
  })

  it('rejects a repeated value', () => {
    const r = conf([
      { gameId: 'a', selectedTeamId: 'TB', confidencePoints: 3 },
      { gameId: 'b', selectedTeamId: 'NO', confidencePoints: 3 },
    ])
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/only be used once/)
  })

  it('rejects a value outside the range', () => {
    const r = conf([{ gameId: 'a', selectedTeamId: 'TB', confidencePoints: 99 }])
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/between 1 and/)
  })

  it('rejects a pick with no confidence value', () => {
    const r = conf([{ gameId: 'a', selectedTeamId: 'TB' }])
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/needs confidence points/)
  })

  it('treats a locked pick’s value as taken and immovable', () => {
    // The Thursday game locked days ago carrying value 4. Sunday's picks
    // must work around it rather than reuse or rewrite it.
    const r = validatePicks(base({
      poolType: 'confidence',
      picksRequired: null,
      keyPickEnabled: false,
      existing: [{ pickId: 'p1', gameId: 'thu', selectedTeamId: 'KC', confidencePoints: 4 }],
      proposed: [{ gameId: 'a', selectedTeamId: 'TB', confidencePoints: 4 }],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/only be used once/)
  })
})

describe('non-confidence pools', () => {
  it('rejects confidence points where they do not belong', () => {
    const r = validatePicks(base({
      proposed: [{ gameId: 'a', selectedTeamId: 'TB', confidencePoints: 3 }],
    }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/does not use confidence/)
  })
})

describe('error reporting', () => {
  it('does not repeat the same message once per pick', () => {
    const r = validatePicks(base({
      linesPublishedAt: null,
      proposed: [
        { gameId: 'a', selectedTeamId: 'TB' },
        { gameId: 'b', selectedTeamId: 'NO' },
        { gameId: 'c', selectedTeamId: 'GB' },
      ],
    }))
    expect(r.errors).toEqual([...new Set(r.errors)])
  })
})

describe('carried picks are identified for the caller', () => {
  it('reports which effective picks are locked', () => {
    // The endpoint uses this to avoid deleting and reinserting rows that
    // already hold a grade, points and an isAuto flag. Rewriting them
    // would discard all three and leave standings wrong until the next
    // grading pass — the bug this contract exists to prevent.
    const r = validatePicks(base({
      existing: [{ pickId: 'p1', gameId: 'thu', selectedTeamId: 'KC' }],
      proposed: [{ gameId: 'a', selectedTeamId: 'TB' }],
    }))
    expect(r.ok).toBe(true)
    expect(r.carried).toEqual(['thu'])
    // The still-open pick is not carried, so it is safe to replace.
    expect(r.carried).not.toContain('a')
  })

  it('reports nothing carried when no game has started', () => {
    const r = validatePicks(base({ proposed: [{ gameId: 'a', selectedTeamId: 'TB' }] }))
    expect(r.carried).toEqual([])
  })
})
