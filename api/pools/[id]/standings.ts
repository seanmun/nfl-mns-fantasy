import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx } from '../../_pool.js'
import {
  nflEntryWeeks,
  nflPoolEntries,
  nflPoolWeeks,
  nflWeeks,
  users,
} from '../../../src/lib/db/schema.js'
import { rankStandings } from '../../../src/lib/scoring/standings.js'

// GET /api/pools/:id/standings — the leaderboard.
//
// Reads the grader's rollups (pool_entries totals, entry_weeks per week)
// and ranks them with the one comparator that is allowed to decide an
// outcome. Results are public within the pool the moment they are graded
// — pick CONTENTS stay hidden until the deadline, but points do not,
// which is the same rule the reveal follows.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const poolId = String(req.query.id ?? '')
  const ctx = await loadCtx(req, res, poolId)
  if (!ctx) return
  if (ctx.entries.length === 0 && !ctx.isPoolAdmin) {
    return res.status(403).json({ error: 'You are not in this pool.' })
  }

  const entries = await db
    .select()
    .from(nflPoolEntries)
    .where(eq(nflPoolEntries.poolId, poolId))

  // Owner handles are PUBLIC — shared ownership of several entries is
  // something the whole pool is entitled to see. Emails stay
  // MANAGER-ONLY; members never see each other's addresses.
  const owners = entries.length
    ? await db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...new Set(entries.map((e) => e.userId))]))
    : []
  const nameByUser = new Map(owners.map((o) => [o.id, o.displayName]))
  const emailByUser = new Map<string, string>()
  if (ctx.isPoolAdmin) {
    for (const o of owners) {
      // The full email backs up a missing username only. displayName
      // equal to the email's local part IS the no-username fallback, so
      // that's the tell; once a real username exists the email drops off.
      if (o.displayName === o.email.split('@')[0]) emailByUser.set(o.id, o.email)
    }
  }

  // Only weeks this pool actually runs, in order, with their labels —
  // the column headers of the weekly breakdown.
  const poolWeeks = await db
    .select({ weekId: nflPoolWeeks.weekId, week: nflWeeks.week, label: nflWeeks.label })
    .from(nflPoolWeeks)
    .innerJoin(nflWeeks, eq(nflWeeks.id, nflPoolWeeks.weekId))
    .where(eq(nflPoolWeeks.poolId, poolId))

  const entryIds = entries.map((e) => e.id)
  const weekRows = entryIds.length
    ? await db
        .select()
        .from(nflEntryWeeks)
        .where(
          and(
            inArray(nflEntryWeeks.entryId, entryIds),
            inArray(
              nflEntryWeeks.weekId,
              poolWeeks.map((w) => w.weekId)
            )
          )
        )
    : []

  const ranked = rankStandings(
    entries.map((e) => ({
      entryId: e.id,
      totalPoints: e.totalPoints,
      keyPickScore: e.keyPickScore,
    }))
  )

  const byEntry = new Map(entries.map((e) => [e.id, e]))
  const weeksSorted = [...poolWeeks].sort((a, b) => a.week - b.week)

  return res.status(200).json({
    weeks: weeksSorted.map((w) => ({ week: w.week, label: w.label })),
    rows: ranked.map((r) => {
      const entry = byEntry.get(r.entryId)!
      const weekly = weekRows.filter((x) => x.entryId === r.entryId)
      const byWeekId = new Map(weekly.map((x) => [x.weekId, x]))
      return {
        rank: r.rank,
        entryId: r.entryId,
        entryName: entry.entryName,
        ownerName: nameByUser.get(entry.userId) ?? null,
        ownerEmail: emailByUser.get(entry.userId) ?? null,
        isMine: ctx.entries.some((e) => e.id === r.entryId),
        totalPoints: r.totalPoints,
        keyPickScore: r.keyPickScore,
        strikes: entry.strikes,
        isEliminated: entry.isEliminated,
        weekly: weeksSorted.map((w) => {
          const ew = byWeekId.get(w.weekId)
          return ew
            ? {
                week: w.week,
                points: ew.points,
                correct: ew.correctCount,
                incorrect: ew.incorrectCount,
                push: ew.pushCount,
              }
            : { week: w.week, points: null, correct: 0, incorrect: 0, push: 0 }
        }),
      }
    }),
  })
}
