import type { DeadlineAnchor, PoolType, SpreadMode } from '../db/schema.js'
import type { ConfidenceScoring, PickNScoring, SurvivorScoring } from '../scoring/config.js'

// Plain-English rules, GENERATED FROM THE POOL'S OWN CONFIG.
//
// The point is that they cannot drift. A rules page typed by hand is
// correct exactly once — the first time an admin changes the pick count
// or the push value, the prose quietly starts lying, and nobody notices
// until it decides money. Everything here reads the same fields the
// engine reads, so the page and the behaviour move together.
//
// The admin's own free text (pools.rulesMarkdown) renders alongside
// this, for things the config cannot know: who collects, what the prize
// is, house etiquette.

export interface RuleSection {
  heading: string
  items: string[]
}

export interface DescribePoolInput {
  poolType: PoolType
  spreadMode: SpreadMode
  picksRequired: number | null
  startWeek: number
  endWeek: number
  allowLateJoin: boolean
  maxEntriesPerUser: number | null
  deadlineAnchor: DeadlineAnchor
  deadlineOffsetMinutes: number
  lineSource: 'api' | 'manual'
  reminderHoursBefore: number | null
  scoringConfig: Partial<PickNScoring & ConfidenceScoring & SurvivorScoring>
}

// "1 point" / "0.5 points" / "no points" — never "0.5 point".
function pts(n: number): string {
  if (n === 0) return 'no points'
  return `${n} ${n === 1 ? 'point' : 'points'}`
}

function anchorPhrase(anchor: DeadlineAnchor, offsetMinutes: number): string {
  const base =
    anchor === 'sunday_1pm_et'
      ? 'the first Sunday afternoon kickoff'
      : anchor === 'first_included_kickoff'
        ? 'the first game of the week'
        : 'a time the pool manager sets each week'

  if (anchor === 'manual' || offsetMinutes === 0) return base
  const h = offsetMinutes / 60
  const amount =
    offsetMinutes % 60 === 0
      ? `${h} ${h === 1 ? 'hour' : 'hours'}`
      : `${offsetMinutes} minutes`
  return `${amount} before ${base}`
}

export function describeRules(pool: DescribePoolInput): RuleSection[] {
  const c = pool.scoringConfig
  const ats = pool.spreadMode === 'ats'
  const sections: RuleSection[] = []

  // ── How to play ─────────────────────────────────────────────────
  const play: string[] = []
  const n = pool.picksRequired

  switch (pool.poolType) {
    case 'pick_n':
      play.push(
        `Each week you pick ${n ?? 'a set number of'} games from the pool's schedule. You choose which ones.`
      )
      break
    case 'classic':
      play.push('Each week you pick a winner in every game on the pool\'s schedule.')
      break
    case 'confidence':
      play.push(
        'Each week you pick a winner in every game, and rank them by how confident you are.'
      )
      play.push(
        'Your most confident pick is worth the most points, your least confident is worth 1. Each ranking is used once.'
      )
      break
    case 'survivor':
      play.push('Each week you pick one team to win.')
      play.push('You cannot pick the same team twice all season.')
      break
  }

  play.push(
    ats
      ? 'Picks are against the spread — your team has to beat the number shown next to it, not just win the game. In the rare case the manager corrects a published number before kickoff, the change is shown to everyone, and any pick already made keeps the number it was made against.'
      :'Picks are straight up — you just need your team to win the game.'
  )
  play.push(`The pool runs from Week ${pool.startWeek} through Week ${pool.endWeek}.`)
  sections.push({ heading: 'How it works', items: play })

  // ── Scoring ─────────────────────────────────────────────────────
  const scoring: string[] = []
  if (pool.poolType === 'survivor') {
    const strikes = c.maxStrikes ?? 1
    scoring.push(
      strikes === 1
        ? 'One wrong pick and you are out.'
        : `You are out after ${strikes} wrong picks.`
    )
    scoring.push(
      c.tiePolicy === 'loss'
        ? 'If your game ends in a tie, it counts as a loss.'
        : 'If your game ends in a tie, you survive the week.'
    )
    scoring.push(
      c.missedPickPolicy === 'auto_favorite'
        ? 'If you forget to pick, the biggest remaining favourite is picked for you.'
        : 'If you forget to pick, you are out.'
    )
  } else if (pool.poolType === 'confidence') {
    scoring.push('A correct pick scores the ranking you gave it. A wrong pick scores nothing.')
    scoring.push(
      c.pushBehavior === 'award'
        ? 'If a pick lands exactly on the number, it still scores its full ranking.'
        : 'If a pick lands exactly on the number, it scores nothing.'
    )
  } else {
    scoring.push(`A correct pick scores ${pts(c.winPoints ?? 1)}.`)
    if (ats) {
      scoring.push(
        `If your pick lands exactly on the number, that is a push and scores ${pts(c.pushPoints ?? 0)}.`
      )
    } else {
      scoring.push(`If the game ends in a tie, that is a push and scores ${pts(c.pushPoints ?? 0)}.`)
    }
    scoring.push('A wrong pick scores nothing.')
  }
  sections.push({ heading: 'Scoring', items: scoring })

  // ── Key pick ────────────────────────────────────────────────────
  if (c.keyPick) {
    const credit = c.keyPushCredit ?? 0
    sections.push({
      heading: 'Key pick',
      items: [
        'Each week you mark one of your picks as your key pick.',
        'It scores exactly like any other pick — the key is worth no extra points.',
        'What it does is break ties: if two people finish level on points, whoever won more key picks finishes higher.',
        credit === 0
          ? 'A key pick that pushes still scores its points, but does not count as a key win.'
          : `A key pick that pushes counts ${credit} toward your key total.`,
        'If you do not choose one before the deadline, one of your picks is chosen at random.',
      ],
    })
  }

  // ── Deadline ────────────────────────────────────────────────────
  const deadline: string[] = [
    `Picks for the whole week close at ${anchorPhrase(pool.deadlineAnchor, pool.deadlineOffsetMinutes)}.`,
    'That single deadline closes every game, including ones that kick off later in the week.',
    'A game that kicks off before the deadline — Thursday, Friday or a holiday game — closes when it starts. You have to pick it before then.',
    'You cannot pick at all until the pool manager has published that week.',
  ]
  if (n != null) {
    deadline.push(
      `If you have fewer than ${n} picks at the deadline, the rest are chosen for you at random — team included — from games that have not started yet.`
    )
  }
  if (pool.reminderHoursBefore != null) {
    const h = pool.reminderHoursBefore
    deadline.push(
      `You get one reminder email about ${h} ${h === 1 ? 'hour' : 'hours'} before the deadline if you are still short.`
    )
  }
  sections.push({ heading: 'Deadline', items: deadline })

  // ── Lines ───────────────────────────────────────────────────────
  if (ats) {
    sections.push({
      heading: 'The spreads',
      items: [
        pool.lineSource === 'manual'
          ? 'The pool manager sets the spreads for this pool by hand.'
          : 'The spreads come from the betting market and the pool manager can adjust them.',
        'Once a week is published, everyone plays the same numbers — you are graded on the published spread, not on whatever the line was when you picked.',
        'The manager can correct a spread up until that game kicks off. After kickoff it is fixed.',
      ],
    })
  }

  // ── Fair play ───────────────────────────────────────────────────
  const fair: string[] = [
    'You can only see your own picks until the deadline. Everyone\'s picks open up once it passes.',
  ]
  fair.push(
    pool.allowLateJoin
      ? 'People can join after the season starts. They score nothing for the weeks they missed.'
      : 'Once the pool starts, nobody else can join.'
  )
  if (pool.maxEntriesPerUser === 1) {
    fair.push('One entry per person.')
  } else if (pool.maxEntriesPerUser == null) {
    fair.push('You can hold as many entries as you like.')
  } else {
    fair.push(`You can hold up to ${pool.maxEntriesPerUser} entries in this pool.`)
  }
  sections.push({ heading: 'Fair play', items: fair })

  // ── Tiebreaker ──────────────────────────────────────────────────
  if (c.tiebreaker && c.tiebreaker !== 'none' && pool.poolType !== 'survivor') {
    sections.push({
      heading: 'Ties',
      items: [
        c.tiebreaker === 'key_pick_score'
          ? 'If two people are level on points, whoever won more key picks finishes higher.'
          : 'If two people are level on points, the closest guess on the last game\'s combined score finishes higher.',
        'If they are still level, they share the position.',
      ],
    })
  }

  return sections
}
