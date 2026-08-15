import type { PoolType } from '../db/schema.js'

// THE single source of scoring defaults.
//
// pools.scoring_config has no column default on purpose. Golf keeps one
// default in its schema column and another in its scoring engine, and its
// CLAUDE.md has to warn that the two must be kept in step by hand. Here
// the create-pool endpoint reads DEFAULT_SCORING and writes it into the
// row, so there is exactly one place to change and every existing pool
// keeps the numbers it was created with.

// 'key_pick_score' is only meaningful when keyPick is on. It breaks ties
// on cumulative points using the season key total, which is what the
// second leaderboard column shows.
export type Tiebreaker = 'last_game_total' | 'key_pick_score' | 'none'

export interface ClassicScoring {
  winPoints: number
  // A half point is the standard ATS convention for a push, and the
  // reason pointsEarned and every total are `real` rather than integers.
  pushPoints: number
  tiebreaker: Tiebreaker
}

export interface PickNScoring extends ClassicScoring {
  picksRequired: number
  // When true, exactly one of the week's picks is designated the key
  // pick. It scores like any other pick — the key earns NO extra weekly
  // points. Key results accumulate across the season and break ties on
  // cumulative points, which is the only thing they affect.
  keyPick: boolean
  // What a key pick that PUSHES contributes to that season total. A key
  // win is always worth 1. Admin's call, because pools genuinely differ:
  //   0    a push is not a win (the common reading, and the default)
  //   0.5  mirrors the points column, which pays half for a push
  //   1    a push protects the key entirely
  // Fractional values are why the key total is `real` and is called a
  // score rather than a count of wins.
  keyPushCredit: number
}

export interface ConfidenceScoring {
  // A correct pick pays the confidence value the user assigned it, so
  // there is no winPoints here — the rank IS the points.
  // 'award' pays the confidence value on a push, 'void' pays nothing.
  pushBehavior: 'award' | 'void'
  tiebreaker: Tiebreaker
}

export interface SurvivorScoring {
  // Losses that eliminate an entry. 1 = out on your first wrong pick,
  // which is the classic rule. pool_entries.strikes counts losses, and an
  // entry is eliminated once strikes >= maxStrikes.
  maxStrikes: number
  // What a genuine NFL tie does to the entry that picked either side.
  // 'survive' is the kinder default; 'loss' is the stricter convention.
  tiePolicy: 'survive' | 'loss'
  // An entry that makes no pick before the week's last kickoff.
  // 'eliminate' is the classic rule. 'auto_favorite' assigns the biggest
  // home-perspective favourite still unplayed and unused.
  missedPickPolicy: 'eliminate' | 'auto_favorite'
}

export type ScoringConfig =
  | ClassicScoring
  | PickNScoring
  | ConfidenceScoring
  | SurvivorScoring

export const DEFAULT_SCORING: Record<PoolType, ScoringConfig> = {
  classic: {
    winPoints: 1,
    pushPoints: 0.5,
    tiebreaker: 'last_game_total',
  },
  pick_n: {
    winPoints: 1,
    pushPoints: 0.5,
    picksRequired: 5,
    keyPick: true,
    keyPushCredit: 0,
    tiebreaker: 'key_pick_score',
  },
  confidence: {
    pushBehavior: 'award',
    tiebreaker: 'last_game_total',
  },
  survivor: {
    maxStrikes: 1,
    tiePolicy: 'survive',
    missedPickPolicy: 'eliminate',
  },
}

// A push is only reachable in ATS pools, and only on a whole-number
// spread — a half-point line can never land exactly. Straight-up pools
// reach 'push' only through a genuine NFL tie.
export function isPushPossible(spread: number | null): boolean {
  return spread != null && Number.isInteger(spread)
}
