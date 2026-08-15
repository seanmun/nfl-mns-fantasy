import { describe, expect, it } from 'vitest'
import { describeRules, type DescribePoolInput } from './describeRules.js'

// Kongers Kitchen as configured: Pick 5, ATS, 18 weeks, key pick,
// manager's own spreads, Sunday-afternoon deadline.
const KONGERS: DescribePoolInput = {
  poolType: 'pick_n',
  spreadMode: 'ats',
  picksRequired: 5,
  startWeek: 1,
  endWeek: 18,
  allowLateJoin: false,
  maxEntriesPerUser: 1,
  deadlineAnchor: 'sunday_1pm_et',
  deadlineOffsetMinutes: 0,
  lineSource: 'manual',
  reminderHoursBefore: 24,
  scoringConfig: {
    winPoints: 1,
    pushPoints: 0.5,
    picksRequired: 5,
    keyPick: true,
    keyPushCredit: 0,
    tiebreaker: 'key_pick_score',
  },
}

const flat = (p: DescribePoolInput) =>
  describeRules(p).flatMap((s) => s.items).join(' ')

describe('generated rules track the config', () => {
  it('states the real pick count, not a hardcoded five', () => {
    expect(flat({ ...KONGERS, picksRequired: 3 })).toContain('pick 3 games')
    expect(flat(KONGERS)).toContain('pick 5 games')
  })

  it('states the real push value', () => {
    expect(flat(KONGERS)).toContain('scores 0.5 points')
    expect(flat({ ...KONGERS, scoringConfig: { ...KONGERS.scoringConfig, pushPoints: 0 } }))
      .toContain('scores no points')
  })

  it('never says "0.5 point" singular', () => {
    expect(flat(KONGERS)).not.toMatch(/0\.5 point\b/)
  })

  it('states the real week range', () => {
    expect(flat({ ...KONGERS, startWeek: 4, endWeek: 17 })).toContain('Week 4 through Week 17')
  })
})

describe('key pick', () => {
  it('is explained only when the pool uses one', () => {
    expect(flat(KONGERS)).toContain('key pick')
    const off = { ...KONGERS, scoringConfig: { ...KONGERS.scoringConfig, keyPick: false } }
    expect(describeRules(off).some((s) => s.heading === 'Key pick')).toBe(false)
  })

  it('says plainly that it earns no extra points', () => {
    expect(flat(KONGERS)).toContain('worth no extra points')
  })

  it('reflects keyPushCredit', () => {
    expect(flat(KONGERS)).toContain('does not count as a key win')
    const half = { ...KONGERS, scoringConfig: { ...KONGERS.scoringConfig, keyPushCredit: 0.5 } }
    expect(flat(half)).toContain('counts 0.5 toward your key total')
  })
})

describe('deadline', () => {
  it('explains that one deadline closes later games too', () => {
    // The single most surprising rule for a new member.
    expect(flat(KONGERS)).toContain('including ones that kick off later in the week')
  })

  it('warns that early games close at their own kickoff', () => {
    expect(flat(KONGERS)).toMatch(/Thursday, Friday or a holiday game/)
  })

  it('describes the auto-pick consequence in the member’s terms', () => {
    expect(flat(KONGERS)).toContain('chosen for you at random')
    expect(flat(KONGERS)).toContain('have not started yet')
  })

  it('renders an offset as hours before the anchor', () => {
    expect(flat({ ...KONGERS, deadlineOffsetMinutes: 60 }))
      .toContain('1 hour before the first Sunday afternoon kickoff')
  })

  it('mentions the reminder only when reminders are on', () => {
    expect(flat(KONGERS)).toContain('one reminder email')
    expect(flat({ ...KONGERS, reminderHoursBefore: null })).not.toContain('reminder email')
  })
})

describe('spreads section', () => {
  it('appears only for ATS pools', () => {
    expect(describeRules(KONGERS).some((s) => s.heading === 'The spreads')).toBe(true)
    const su = { ...KONGERS, spreadMode: 'straight_up' as const }
    expect(describeRules(su).some((s) => s.heading === 'The spreads')).toBe(false)
  })

  it('says who sets the numbers', () => {
    expect(flat(KONGERS)).toContain('sets the spreads for this pool by hand')
    expect(flat({ ...KONGERS, lineSource: 'api' })).toContain('come from the betting market')
  })

  it('states that everyone is graded on the published number', () => {
    expect(flat(KONGERS)).toContain('everyone plays the same numbers')
  })
})

describe('fair play', () => {
  it('states the pick privacy rule', () => {
    expect(flat(KONGERS)).toContain('only see your own picks until the deadline')
  })

  it('reflects the late-join setting', () => {
    expect(flat(KONGERS)).toContain('nobody else can join')
    expect(flat({ ...KONGERS, allowLateJoin: true })).toContain('score nothing for the weeks they missed')
  })

  it('reflects the entry cap', () => {
    expect(flat(KONGERS)).toContain('One entry per person')
    expect(flat({ ...KONGERS, maxEntriesPerUser: 3 })).toContain('up to 3 entries')
    expect(flat({ ...KONGERS, maxEntriesPerUser: null })).toContain('as many entries as you like')
  })
})

describe('other pool types', () => {
  it('describes survivor’s elimination rules from config', () => {
    const s = flat({
      ...KONGERS,
      poolType: 'survivor',
      spreadMode: 'straight_up',
      picksRequired: 1,
      scoringConfig: { maxStrikes: 2, tiePolicy: 'loss', missedPickPolicy: 'eliminate' },
    })
    expect(s).toContain('cannot pick the same team twice')
    expect(s).toContain('out after 2 wrong picks')
    expect(s).toContain('counts as a loss')
  })

  it('describes confidence ranking', () => {
    const s = flat({
      ...KONGERS,
      poolType: 'confidence',
      picksRequired: null,
      scoringConfig: { pushBehavior: 'award', tiebreaker: 'none' },
    })
    expect(s).toContain('rank them by how confident you are')
    expect(s).toContain('scores the ranking you gave it')
  })

  it('describes classic as every game', () => {
    const s = flat({ ...KONGERS, poolType: 'classic', picksRequired: null })
    expect(s).toContain('pick a winner in every game')
  })
})
