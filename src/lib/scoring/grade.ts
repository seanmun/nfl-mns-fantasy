import type { PickResult, PoolType, SpreadMode } from '../db/schema.js'
import type {
  ClassicScoring,
  ConfidenceScoring,
  PickNScoring,
  ScoringConfig,
  SurvivorScoring,
} from './config.js'

// Pure grading. No database, no clock, no feed — everything it needs is
// an argument, so the whole rule set is testable without a fixture and
// regrading a settled week is the same call as grading it live.
//
// The caller (the score cron / a manual regrade) is responsible for only
// passing FINAL games and for writing the results.

export interface FinalGame {
  homeTeamId: string
  awayTeamId: string
  homeScore: number
  awayScore: number
}

export interface GradedPick {
  result: PickResult
  pointsEarned: number
}

export class UngradableError extends Error {}

// Which side beat the number, from the home team's point of view.
//
// spread is home-perspective (-3.5 = home favoured by 3.5), so adding it
// to the home margin is the entire calculation:
//   home -3.5, home wins by 4  ->  4 + (-3.5) = +0.5  home covers
//   home -3.5, home wins by 3  ->  3 + (-3.5) = -0.5  away covers
//   home +3.5, home loses by 3 -> -3 + (+3.5) = +0.5  home covers
//
// Exactly 0 is a push, which only a whole-number spread can produce. In a
// straight-up pool spread is 0, so this collapses to the raw margin and a
// genuine NFL tie is the only push.
function homeOutcome(game: FinalGame, spread: number): 'home' | 'away' | 'push' {
  const adjusted = game.homeScore - game.awayScore + spread
  if (adjusted > 0) return 'home'
  if (adjusted < 0) return 'away'
  return 'push'
}

function sideOfPick(game: FinalGame, selectedTeamId: string): 'home' | 'away' {
  if (selectedTeamId === game.homeTeamId) return 'home'
  if (selectedTeamId === game.awayTeamId) return 'away'
  throw new UngradableError(
    `Pick references ${selectedTeamId}, which is not in this game`
  )
}

// win / loss / push for one pick, before any pool-type scoring is applied.
export function resolvePick(
  game: FinalGame,
  selectedTeamId: string,
  spreadMode: SpreadMode,
  officialSpread: number | null
): 'win' | 'loss' | 'push' {
  // An ATS pool with no published line cannot be graded. Falling through
  // to a 0 spread here would silently regrade the whole slate straight-up
  // and look like a scoring bug, so refuse instead.
  if (spreadMode === 'ats' && officialSpread == null) {
    throw new UngradableError('ATS pool has no official spread for this game')
  }
  const spread = spreadMode === 'ats' ? (officialSpread as number) : 0
  const winner = homeOutcome(game, spread)
  if (winner === 'push') return 'push'
  return winner === sideOfPick(game, selectedTeamId) ? 'win' : 'loss'
}

export interface GradeInput {
  poolType: PoolType
  spreadMode: SpreadMode
  config: ScoringConfig
  game: FinalGame
  selectedTeamId: string
  // Confidence pools only: the rank the user assigned this pick.
  confidencePoints?: number | null
  // From game_lines, never from the pick. One official number for
  // everyone is the point of publishing.
  officialSpread: number | null
}

export function gradePick(input: GradeInput): GradedPick {
  const result = resolvePick(
    input.game,
    input.selectedTeamId,
    input.spreadMode,
    input.officialSpread
  )

  switch (input.poolType) {
    case 'classic':
    case 'pick_n': {
      const c = input.config as ClassicScoring | PickNScoring
      const points = result === 'win' ? c.winPoints : result === 'push' ? c.pushPoints : 0
      return { result, pointsEarned: points }
    }

    case 'confidence': {
      const c = input.config as ConfidenceScoring
      // The rank IS the points, so a pick with no rank is a data bug, not
      // a zero — a silent 0 would quietly cost someone their week.
      if (input.confidencePoints == null) {
        throw new UngradableError('Confidence pick has no confidencePoints')
      }
      const points =
        result === 'win' || (result === 'push' && c.pushBehavior === 'award')
          ? input.confidencePoints
          : 0
      return { result, pointsEarned: points }
    }

    case 'survivor':
      // Survivor has no currency but survival; standings are strikes and
      // weeks lasted. Strike accounting is survivorStrike() below.
      return { result, pointsEarned: 0 }
  }
}

// Does this result cost the entry a strike? A tie is the only case that
// depends on pool settings.
export function survivorStrike(result: PickResult, config: SurvivorScoring): boolean {
  if (result === 'loss') return true
  if (result === 'missed') return config.missedPickPolicy === 'eliminate'
  if (result === 'push') return config.tiePolicy === 'loss'
  return false
}

export function isEliminated(strikes: number, config: SurvivorScoring): boolean {
  return strikes >= config.maxStrikes
}
