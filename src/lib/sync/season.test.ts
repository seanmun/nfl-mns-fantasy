import { describe, expect, it } from 'vitest'
import type { GameStatus } from '../db/schema.js'
import { pickCurrentWeek, unsettledKickedOff } from './schedule.js'
import { SCHEDULE_2026 } from './fixtures/schedule2026.js'

// Replays the real 2026 season through the tick's week selection, one
// hourly tick at a time, from before Week 1 to after Week 18. The feed
// is simulated: a game is in progress from kickoff and final 3.5 hours
// later. A week is fetched only when the rule under test names it, and
// a game reaches 'final' in our table only when its week is fetched
// after the feed has it final — exactly the production mechanism.
//
// Two rules are replayed side by side:
//   'current-week' — what tick.ts did until 2026-09-24: fetch only
//                    currentWeek(), which rolls at the last KICKOFF.
//   'game-state'   — what it does now: every week holding a kicked-off,
//                    unsettled game, plus the current week.
//
// The first loses the last kickoff of every week that has a successor.
// The second loses nothing, through Thanksgiving, Christmas, Week 18's
// placeholder kickoffs, a three-day tick outage and a postponement.

const HOUR = 3_600_000
const GAME_MS = 3.5 * HOUR

type Rule = 'current-week' | 'game-state'

interface Row {
  name: string
  week: number
  weekId: string
  status: GameStatus
  kickoffAt: Date
}
interface Week {
  id: string
  week: number
  lastKickoffAt: Date | null
}

// What the feed says about a game at an instant: its (possibly moved)
// kickoff and its status.
type Feed = (row: Row, now: Date) => { kickoffAt: Date; status: GameStatus }

function statusAt(kickoff: Date, now: Date): GameStatus {
  if (now.getTime() < kickoff.getTime()) return 'scheduled'
  if (now.getTime() < kickoff.getTime() + GAME_MS) return 'in_progress'
  return 'final'
}

// The season as seeded, then Week 18's real times arriving on Jan 5 —
// most at 1pm ET, one late-afternoon, one Sunday night — as the NFL
// sets them once playoff implications are known.
const WEEK18_FIRM_AT = new Date('2027-01-05T15:00:00Z')
const seeded = new Map(SCHEDULE_2026.map((g) => [`${g.away}@${g.home}`, new Date(g.kickoff)]))
const realFeed: Feed = (row, now) => {
  let kickoff = seeded.get(row.name)!
  if (row.week === 18 && now >= WEEK18_FIRM_AT) {
    const i = SCHEDULE_2026.filter((g) => g.week === 18).findIndex((g) => `${g.away}@${g.home}` === row.name)
    kickoff =
      i === 15
        ? new Date('2027-01-11T01:20:00Z')
        : i === 14
          ? new Date('2027-01-10T21:25:00Z')
          : new Date('2027-01-10T18:00:00Z')
  }
  return { kickoffAt: kickoff, status: statusAt(kickoff, now) }
}

function simulate(rule: Rule, feed: Feed, skipTick?: (now: Date) => boolean): string[] {
  const rows: Row[] = SCHEDULE_2026.map((g) => ({
    name: `${g.away}@${g.home}`,
    week: g.week,
    weekId: `week-${g.week}`,
    status: 'scheduled',
    kickoffAt: new Date(g.kickoff),
  }))
  const weeks: Week[] = [...new Set(rows.map((r) => r.week))]
    .sort((a, b) => a - b)
    .map((w) => ({ id: `week-${w}`, week: w, lastKickoffAt: null }))
  const refreshBounds = () => {
    for (const w of weeks) {
      const ks = rows.filter((r) => r.weekId === w.id).map((r) => r.kickoffAt.getTime())
      w.lastKickoffAt = ks.length ? new Date(Math.max(...ks)) : null
    }
  }
  refreshBounds()

  const from = new Date('2026-09-01T00:00:00Z').getTime()
  const to = new Date('2027-01-20T00:00:00Z').getTime()
  for (let t = from; t <= to; t += HOUR) {
    const now = new Date(t)
    if (skipTick?.(now)) continue

    const targets = new Set<string>()
    const current = pickCurrentWeek(weeks, now)
    if (current) targets.add(current.id)
    if (rule === 'game-state') {
      for (const g of unsettledKickedOff(rows, now)) targets.add(g.weekId)
    }

    for (const id of targets) {
      for (const row of rows) {
        if (row.weekId !== id) continue
        const f = feed(row, now)
        row.status = f.status
        row.kickoffAt = f.kickoffAt
      }
    }
    refreshBounds()
  }
  return rows.filter((r) => r.status !== 'final').map((r) => `Week ${r.week} ${r.name}`)
}

describe('the 2026 season, replayed hourly through the tick’s week selection', () => {
  it('fixture is the full regular season', () => {
    expect(SCHEDULE_2026).toHaveLength(272)
    expect(new Set(SCHEDULE_2026.map((g) => g.week)).size).toBe(18)
  })

  it('the old rule loses the last kickoff of every week that has a week after it', () => {
    const lost = simulate('current-week', realFeed)
    // Weeks 1-17: whichever games share the week's final kickoff time.
    // Week 18 survives only because currentWeek() falls back to the last
    // week when nothing is ahead — luck, not design.
    const expected: string[] = []
    for (let w = 1; w <= 17; w++) {
      const games = SCHEDULE_2026.filter((g) => g.week === w)
      const last = Math.max(...games.map((g) => new Date(g.kickoff).getTime()))
      for (const g of games) {
        if (new Date(g.kickoff).getTime() === last) expected.push(`Week ${w} ${g.away}@${g.home}`)
      }
    }
    expect(lost).toEqual(expected)
    expect(lost.length).toBeGreaterThanOrEqual(17)
    expect(lost).toContain('Week 1 DEN@KC')
    expect(lost).toContain('Week 2 NYG@LAR')
  })

  it('the current rule brings all 272 games to final', () => {
    expect(simulate('game-state', realFeed)).toEqual([])
  })

  it('still does with no ticks at all for three days over a Monday night', () => {
    const outageStart = new Date('2026-09-28T12:00:00Z').getTime() // Week 3 Monday
    const outageEnd = outageStart + 72 * HOUR
    const down = (now: Date) => now.getTime() >= outageStart && now.getTime() < outageEnd
    expect(simulate('game-state', realFeed, down)).toEqual([])
    expect(simulate('current-week', realFeed, down)).toContain('Week 3 ' + lastOf(3))
  })

  it('still does when a Sunday game is postponed to after its week’s Monday night', () => {
    // Week 5: a 1pm ET Sunday game, moved on Sunday morning to Tuesday
    // 7pm ET — after the week's last kickoff, so the old rule never
    // sees it again.
    const week5 = SCHEDULE_2026.filter((g) => g.week === 5)
    const sunday = week5
      .filter((g) => new Date(g.kickoff).getUTCDay() === 0)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff))[0]
    const victim = `${sunday.away}@${sunday.home}`
    const moved = new Date('2026-10-13T23:00:00Z')
    const announcedAt = new Date('2026-10-11T12:00:00Z')
    const postponingFeed: Feed = (row, now) => {
      if (row.name !== victim || now < announcedAt) return realFeed(row, now)
      const status: GameStatus = now < moved ? 'postponed' : statusAt(moved, now)
      return { kickoffAt: moved, status }
    }
    expect(simulate('game-state', postponingFeed)).toEqual([])
    expect(simulate('current-week', postponingFeed)).toContain(`Week 5 ${victim}`)
  })
})

function lastOf(week: number): string {
  const games = SCHEDULE_2026.filter((g) => g.week === week)
  const last = games.reduce((a, b) => (a.kickoff >= b.kickoff ? a : b))
  return `${last.away}@${last.home}`
}
