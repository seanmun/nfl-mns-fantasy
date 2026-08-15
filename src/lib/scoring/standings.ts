// Cumulative standings ordering.
//
// The leaderboard shows two columns — total points and the key-pick score —
// and sorts by the first, breaking ties with the second. Key picks pay no
// extra points, so this comparator is the ONLY place they change an
// outcome. If key picks ever appear in the points maths, that is a bug.

export interface StandingRow {
  entryId: string
  totalPoints: number
  keyPickScore: number
}

export function compareStandings(a: StandingRow, b: StandingRow): number {
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
  return b.keyPickScore - a.keyPickScore
}

export interface RankedRow extends StandingRow {
  rank: number
}

// Competition ranking: entries level on BOTH keys share a rank and the
// next rank skips (1, 2, 2, 4). Two people genuinely tied should see the
// same number rather than be split by row order, which is what a naive
// index+1 would do — and in a pool where the standings decide money, an
// arbitrary split is the kind of thing members notice.
export function rankStandings(rows: StandingRow[]): RankedRow[] {
  const sorted = [...rows].sort(compareStandings)
  const out: RankedRow[] = []
  let rank = 0
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1]
    const tied =
      prev && prev.totalPoints === row.totalPoints && prev.keyPickScore === row.keyPickScore
    if (!tied) rank = i + 1
    out.push({ ...row, rank })
  })
  return out
}
