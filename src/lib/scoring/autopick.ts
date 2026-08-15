// Filling in members who did not pick by the deadline.
//
// Pure and RNG-injected so it is testable and, more importantly,
// REPRODUCIBLE: pass a seeded generator and the same seed always yields
// the same assignment. In a pool with money in it, "the app picked for me"
// needs to be something the admin can demonstrate rather than assert.

import { isTbdKickoff } from './deadline.js'

export interface AutoPickCandidate {
  gameId: string
  homeTeamId: string
  awayTeamId: string
  kickoffAt: Date
}

export interface AutoAssignedPick {
  gameId: string
  selectedTeamId: string
}

// Small deterministic PRNG. Seeded runs are reproducible; Math.random is
// the default when nobody cares.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface AutoPickInput {
  // Every game the pool included for this week.
  candidates: AutoPickCandidate[]
  // Games this entry has already picked, which are left alone.
  alreadyPickedGameIds: Set<string>
  // How many more picks the entry owes, e.g. 5 - picksMade.
  needed: number
  now: Date
  rng?: () => number
}

// Games already under way are excluded. The deadline is the Sunday
// afternoon kickoff, but a pool's slate can include Friday, Saturday and
// Thanksgiving games that kicked off days earlier — assigning one of
// those would hand somebody a pick on a game whose result is already
// known or partly known.
export function selectAutoPicks(input: AutoPickInput): AutoAssignedPick[] {
  const rng = input.rng ?? Math.random
  if (input.needed <= 0) return []

  const eligible = input.candidates.filter(
    (c) =>
      !input.alreadyPickedGameIds.has(c.gameId) &&
      // A TBD kickoff has not started — midnight would wrongly exclude
      // it, shrinking the pool the fill can draw from and manufacturing
      // shortfalls in exactly the late-season weeks that are all TBD.
      (isTbdKickoff(c.kickoffAt) || c.kickoffAt > input.now)
  )

  // Fewer eligible games than picks owed is possible — a short slate, or
  // a deadline set after most of the week has kicked off. Assign what
  // there is; the caller logs the shortfall rather than silently
  // reporting a full set.
  return shuffled(eligible, rng)
    .slice(0, input.needed)
    .map((c) => ({
      gameId: c.gameId,
      selectedTeamId: rng() < 0.5 ? c.homeTeamId : c.awayTeamId,
    }))
}

// The key pick, when the member never designated one. Chosen from the
// entry's whole week — auto-assigned picks included, since by the
// deadline they are just as much their picks as the deliberate ones.
export function selectKeyPick(pickIds: string[], rng: () => number = Math.random): string | null {
  if (pickIds.length === 0) return null
  return pickIds[Math.floor(rng() * pickIds.length)]
}
