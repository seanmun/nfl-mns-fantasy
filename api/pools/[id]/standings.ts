import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx, requirePoolAdmin } from '../../_pool.js'
import {
  nflEntryWeeks,
  nflGames,
  nflPoolEntries,
  nflPoolGames,
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

  const poolId = String(req.query.id ?? '')
  const ctx = await loadCtx(req, res, poolId)
  if (!ctx) return
  if (ctx.entries.length === 0 && !ctx.isPoolAdmin) {
    return res.status(403).json({ error: 'You are not in this pool.' })
  }

  // ── Grant / revoke co-admin ─────────────────────────────────────
  // POST { entryId, isAdmin } — pool admins only. Writes every entry of
  // the target USER so admin-ness never depends on which entry you
  // look at. The creator is not demotable.
  if (req.method === 'POST') {
    if (!requirePoolAdmin(ctx, res)) return
    const { entryId, isAdmin: wantAdmin } = (req.body ?? {}) as {
      entryId?: string
      isAdmin?: boolean
    }
    if (!entryId || typeof wantAdmin !== 'boolean') {
      return res.status(400).json({ error: 'Say which entry, and admin on or off.' })
    }
    const [target] = await db
      .select({ userId: nflPoolEntries.userId })
      .from(nflPoolEntries)
      .where(and(eq(nflPoolEntries.id, entryId), eq(nflPoolEntries.poolId, poolId)))
      .limit(1)
    if (!target) return res.status(404).json({ error: 'That entry is not in this pool.' })
    if (target.userId === ctx.pool.createdBy) {
      return res.status(400).json({ error: 'The pool creator is always an admin.' })
    }
    await db
      .update(nflPoolEntries)
      .set({ isAdmin: wantAdmin })
      .where(and(eq(nflPoolEntries.poolId, poolId), eq(nflPoolEntries.userId, target.userId)))
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

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
  // Pool admins see every owner's email on the standings — it is their
  // contact sheet for running the pool. Members never do.
  const emailByUser = new Map<string, string>()
  if (ctx.isPoolAdmin) {
    for (const o of owners) emailByUser.set(o.id, o.email)
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

  // ── Is the season over? ─────────────────────────────────────────
  // Over means the pool's LAST week is fully decided: its slate exists
  // and every included game is final (or cancelled), with no pick still
  // pending a grade. Only then do the standings become "final" — a
  // legitimate-looking final table with one game outstanding is exactly
  // the wrong thing to publish.
  let seasonOver = false
  const [lastWeek] = await db
    .select({ id: nflWeeks.id })
    .from(nflWeeks)
    .where(
      and(
        eq(nflWeeks.season, ctx.pool.season),
        eq(nflWeeks.seasonType, ctx.pool.seasonType),
        eq(nflWeeks.week, ctx.pool.endWeek)
      )
    )
    .limit(1)
  if (lastWeek) {
    const lastSlate = await db
      .select({ status: nflGames.status, isIncluded: nflPoolGames.isIncluded })
      .from(nflPoolGames)
      .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
      .where(
        and(eq(nflPoolGames.poolId, poolId), eq(nflPoolGames.weekId, lastWeek.id))
      )
    const included = lastSlate.filter((g) => g.isIncluded)
    seasonOver =
      included.length > 0 &&
      included.every((g) => g.status === 'final' || g.status === 'cancelled')
  }

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
    final: seasonOver,
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
        // Who runs the pool, so the page can badge admins and offer the
        // grant/revoke to the right rows.
        ownerIsCreator: entry.userId === ctx.pool.createdBy,
        ownerIsAdmin: entry.userId === ctx.pool.createdBy || entry.isAdmin,
        canToggleAdmin: ctx.isPoolAdmin && entry.userId !== ctx.pool.createdBy,
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
