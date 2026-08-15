import type { PoolType } from '../db/schema.js'
import { isPickable, isTbdKickoff } from '../scoring/deadline.js'

// Validation for a member submitting their picks for one week.
//
// Pure: every input is an argument, so the whole rule set is testable
// without a database. The endpoint's only job is to load state, call
// this, and persist `effective` if it comes back clean.
//
// The client sends the FULL desired set for the week, not a delta. A
// delta protocol makes "remove this pick" and "I didn't mention it"
// indistinguishable, which is how picks silently vanish.

export interface SlateGame {
  gameId: string
  homeTeamId: string
  awayTeamId: string
  kickoffAt: Date
  // Null is only legal in a straight-up pool. An ATS pool with a null
  // spread should never have been published.
  spread: number | null
}

export interface ProposedPick {
  gameId: string
  selectedTeamId: string
  confidencePoints?: number | null
  isKeyPick?: boolean
}

export interface ExistingPick extends ProposedPick {
  pickId: string
}

export interface ValidateInput {
  poolType: PoolType
  // Exactly what the pool requires each week. Null means "every game".
  picksRequired: number | null
  keyPickEnabled: boolean
  slate: SlateGame[]
  existing: ExistingPick[]
  proposed: ProposedPick[]
  now: Date
  linesPublishedAt: Date | null
  pickDeadlineAt: Date | null
  // Survivor only: teams this entry has already used in earlier weeks.
  usedTeamIds?: Set<string>
}

export interface ValidateResult {
  ok: boolean
  errors: string[]
  // The set to persist. Locked picks are carried through automatically,
  // so a client that only sends the still-open games cannot delete a
  // pick that has already kicked off.
  effective: ProposedPick[]
  // gameIds within `effective` whose game has already kicked off. The
  // caller MUST NOT delete and reinsert these: their rows may already
  // carry a grade, points and an isAuto flag, and rewriting them would
  // throw all of that away and leave the standings wrong until the next
  // grading pass. Only their key-pick designation may still change.
  carried: string[]
}

export function validatePicks(input: ValidateInput): ValidateResult {
  const errors: string[] = []
  const byId = new Map(input.slate.map((g) => [g.gameId, g]))

  // A TBD kickoff (midnight ET) never locks its own game — see
  // isTbdKickoff. Treating it as locked would make every unscheduled
  // late-season game unpickable for the whole day.
  const locked = (g: SlateGame) => !isTbdKickoff(g.kickoffAt) && input.now >= g.kickoffAt

  // ── Week-level gates ────────────────────────────────────────────
  if (!input.linesPublishedAt) {
    errors.push('This week has not been published yet.')
  }
  if (input.pickDeadlineAt && input.now >= input.pickDeadlineAt) {
    errors.push('The deadline for this week has passed.')
  }

  // ── Carry locked picks through untouched ────────────────────────
  const lockedExisting = input.existing.filter((p) => {
    const g = byId.get(p.gameId)
    return g ? locked(g) : false
  })

  const proposedById = new Map(input.proposed.map((p) => [p.gameId, p]))

  for (const p of lockedExisting) {
    const attempted = proposedById.get(p.gameId)
    if (attempted && attempted.selectedTeamId !== p.selectedTeamId) {
      errors.push('That game has already started — its pick can no longer be changed.')
    }
    // Confidence values on a locked pick are equally immovable.
    if (
      input.poolType === 'confidence' &&
      attempted &&
      attempted.confidencePoints != null &&
      attempted.confidencePoints !== p.confidencePoints
    ) {
      errors.push('That game has already started — its confidence points can no longer be changed.')
    }
  }

  const lockedIds = new Set(lockedExisting.map((p) => p.gameId))
  const open = input.proposed.filter((p) => !lockedIds.has(p.gameId))
  const effective: ProposedPick[] = [
    ...lockedExisting.map((p) => ({
      gameId: p.gameId,
      selectedTeamId: p.selectedTeamId,
      confidencePoints: p.confidencePoints,
      isKeyPick: p.isKeyPick,
    })),
    ...open,
  ]

  // ── Per-pick sanity ─────────────────────────────────────────────
  const seen = new Set<string>()
  for (const p of open) {
    const g = byId.get(p.gameId)
    if (!g) {
      errors.push('One of those games is not part of this pool this week.')
      continue
    }
    if (seen.has(p.gameId)) {
      errors.push('You can only pick one team per game.')
      continue
    }
    seen.add(p.gameId)

    if (p.selectedTeamId !== g.homeTeamId && p.selectedTeamId !== g.awayTeamId) {
      errors.push('That team is not playing in that game.')
    }
    // A game that kicked off with NO prior pick cannot be picked now —
    // otherwise a result already known could be picked after the fact.
    if (locked(g)) {
      errors.push('That game has already started.')
    }
    if (
      !isPickable({
        now: input.now,
        linesPublishedAt: input.linesPublishedAt,
        pickDeadlineAt: input.pickDeadlineAt,
        kickoffAt: g.kickoffAt,
      })
    ) {
      errors.push('That game is no longer open for picks.')
    }
  }

  // ── Count ───────────────────────────────────────────────────────
  // Partial saves are allowed on purpose: someone picking three games on
  // Saturday should not lose them because they could not decide on the
  // rest. The deadline job tops up whatever is short.
  const required = input.picksRequired ?? input.slate.length
  if (effective.length > required) {
    errors.push(`This pool takes ${required} picks a week — you have selected ${effective.length}.`)
  }

  // ── Type-specific rules ─────────────────────────────────────────
  if (input.poolType === 'survivor') {
    if (effective.length > 1) {
      errors.push('Survivor takes one pick a week.')
    }
    const used = input.usedTeamIds ?? new Set<string>()
    for (const p of effective) {
      if (used.has(p.selectedTeamId)) {
        errors.push('You have already used that team this season.')
      }
    }
  }

  if (input.poolType === 'confidence') {
    const values = effective
      .map((p) => p.confidencePoints)
      .filter((v): v is number => v != null)

    if (values.length !== effective.length) {
      errors.push('Every pick needs confidence points.')
    }
    if (new Set(values).size !== values.length) {
      errors.push('Each confidence value can only be used once.')
    }
    for (const v of values) {
      if (!Number.isInteger(v) || v < 1 || v > required) {
        errors.push(`Confidence points must be between 1 and ${required}.`)
      }
    }
  } else {
    if (effective.some((p) => p.confidencePoints != null)) {
      errors.push('This pool does not use confidence points.')
    }
  }

  // ── Key pick ────────────────────────────────────────────────────
  const keys = effective.filter((p) => p.isKeyPick)
  if (!input.keyPickEnabled && keys.length > 0) {
    errors.push('This pool does not use a key pick.')
  }
  if (input.keyPickEnabled && keys.length > 1) {
    errors.push('Only one pick can be your key pick.')
  }

  // Deliberately NOT requiring a key pick here. A member saving three of
  // five on Saturday has not chosen one yet, and refusing the save would
  // lose their work. The deadline job assigns one if it is still missing.

  return {
    ok: errors.length === 0,
    errors: dedupe(errors),
    effective,
    carried: lockedExisting.map((p) => p.gameId),
  }
}

// The same rule can trip on several picks at once; a member does not
// need to be told five times that the deadline has passed.
function dedupe(errors: string[]): string[] {
  return [...new Set(errors)]
}
