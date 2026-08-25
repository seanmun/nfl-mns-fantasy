import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx } from '../../_pool.js'
import { isAdmin as isSiteAdmin } from '../../_middleware.js'
import {
  nflEntryWeeks,
  nflGames,
  nflPools,
  nflPoolEntries,
  nflPoolGames,
  nflPoolWeeks,
  nflWeeks,
  users,
} from '../../../src/lib/db/schema.js'
import { rankStandings } from '../../../src/lib/scoring/standings.js'
import type { PrizesConfig } from '../../../src/lib/db/schema.js'

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

  // Only the CREATOR hands out admin (site admin as support override).
  // A co-admin helps run the pool; letting them mint more admins is how
  // admin quietly stops meaning anything.
  const canManageAdmins = ctx.pool.createdBy === ctx.userId || isSiteAdmin(ctx.userId)

  // ── Bench / ban / reactivate an entry ───────────────────────────
  // POST { entryId, status } — any pool admin. Benched entries sit the
  // season out but stay for next year; banned are gone and cannot
  // rejoin. Per ENTRY, not per user: someone's serious entry can stay
  // active while a joke entry is benched.
  if (req.method === 'POST' && typeof req.body?.status === 'string') {
    if (!ctx.isPoolAdmin) {
      return res.status(403).json({ error: 'Only pool admins can do that.' })
    }
    const { entryId, status } = req.body as { entryId?: string; status?: string }
    if (!entryId || !['active', 'benched', 'banned'].includes(status ?? '')) {
      return res.status(400).json({ error: 'Say which entry, and active, benched or banned.' })
    }
    const [target] = await db
      .select({ userId: nflPoolEntries.userId })
      .from(nflPoolEntries)
      .where(and(eq(nflPoolEntries.id, entryId), eq(nflPoolEntries.poolId, poolId)))
      .limit(1)
    if (!target) return res.status(404).json({ error: 'That entry is not in this pool.' })
    if (target.userId === ctx.pool.createdBy) {
      return res.status(400).json({ error: 'The creator cannot be benched or banned.' })
    }
    await db
      .update(nflPoolEntries)
      .set({ status: status as 'active' | 'benched' | 'banned' })
      .where(eq(nflPoolEntries.id, entryId))
    return res.status(200).json({ ok: true })
  }

  // ── Archive / reopen the pool ───────────────────────────────────
  // POST { archive: true|false } — creator only. Archived = status
  // 'completed': drops to the Finished section, out of auto-open.
  if (req.method === 'POST' && typeof req.body?.archive === 'boolean') {
    if (ctx.pool.createdBy !== ctx.userId && !isSiteAdmin(ctx.userId)) {
      return res.status(403).json({ error: 'Only the pool creator can archive it.' })
    }
    await db
      .update(nflPools)
      .set({ status: req.body.archive ? 'completed' : 'open' })
      .where(eq(nflPools.id, poolId))
    return res.status(200).json({ ok: true })
  }

  // ── Edit pool settings ──────────────────────────────────────────
  // POST { settings: { name?, managerNote?, rulesMarkdown?, reminderHoursBefore? } }
  // Pool admins. The owner-verbs that were missing: rename your own
  // thing, edit its note and rules.
  if (req.method === 'POST' && req.body?.settings && typeof req.body.settings === 'object') {
    if (!ctx.isPoolAdmin) {
      return res.status(403).json({ error: 'Only pool admins can edit settings.' })
    }
    const sIn = req.body.settings as {
      name?: string
      managerNote?: string | null
      rulesMarkdown?: string | null
      reminderHoursBefore?: number | null
    }
    const patch: Record<string, unknown> = {}
    if (typeof sIn.name === 'string') {
      const name = sIn.name.trim()
      if (!name) return res.status(400).json({ error: 'The pool needs a name.' })
      patch.name = name.slice(0, 80)
    }
    if ('managerNote' in sIn) patch.managerNote = sIn.managerNote?.trim() || null
    if ('rulesMarkdown' in sIn) patch.rulesMarkdown = sIn.rulesMarkdown?.trim() || null
    if ('reminderHoursBefore' in sIn) {
      patch.reminderHoursBefore =
        sIn.reminderHoursBefore == null
          ? null
          : Math.max(1, Math.min(96, Number(sIn.reminderHoursBefore) || 24))
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' })
    await db.update(nflPools).set(patch).where(eq(nflPools.id, poolId))
    return res.status(200).json({ ok: true })
  }

  // ── Grant / revoke co-admin ─────────────────────────────────────
  // POST { entryId, isAdmin } — creator only. Writes every entry of
  // the target USER so admin-ness never depends on which entry you
  // look at. The creator is not demotable.
  if (req.method === 'POST') {
    if (!canManageAdmins) {
      return res.status(403).json({ error: 'Only the pool creator can manage admins.' })
    }
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

  const allEntries = await db
    .select()
    .from(nflPoolEntries)
    .where(eq(nflPoolEntries.poolId, poolId))
  // Only ACTIVE entries compete. Benched and banned vanish from every
  // ranking and count; admins get them in a separate list below.
  const entries = allEntries.filter((e) => e.status === 'active')

  // Owner handles are PUBLIC — shared ownership of several entries is
  // something the whole pool is entitled to see. Emails stay
  // MANAGER-ONLY; members never see each other's addresses.
  const owners = allEntries.length
    ? await db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...new Set(allEntries.map((e) => e.userId))]))
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

  // ── Winners circle ──────────────────────────────────────────────
  // Prize computation is read-only and summary-scale: winner rows only,
  // never full tables. Segments pay out as soon as THEIR weeks are all
  // decided; season/key/last-place wait for the whole season.
  const prizes = (ctx.pool.prizesConfig ?? null) as PrizesConfig | null
  let winners = null
  if (prizes) {
    const nameOf = (entryId: string) => {
      const e = byEntry.get(entryId)
      return {
        entryId,
        entryName: e?.entryName ?? 'Entry',
        ownerName: e ? nameByUser.get(e.userId) ?? null : null,
      }
    }

    // Per-week decidedness for segment payouts, one query for the pool.
    const slateStatus = await db
      .select({
        weekId: nflPoolGames.weekId,
        isIncluded: nflPoolGames.isIncluded,
        status: nflGames.status,
      })
      .from(nflPoolGames)
      .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
      .where(eq(nflPoolGames.poolId, poolId))
    const weekDecided = (weekId: string) => {
      const games = slateStatus.filter((g) => g.weekId === weekId && g.isIncluded)
      return (
        games.length > 0 &&
        games.every((g) => g.status === 'final' || g.status === 'cancelled')
      )
    }
    const weekIdByNo = new Map(weeksSorted.map((w) => [w.week, w.weekId]))

    const rankRows = (rows: Array<{ entryId: string; points: number }>) => {
      const sorted = [...rows].sort((a, b) => b.points - a.points)
      let rank = 0
      return sorted.map((row, i) => {
        if (!(i > 0 && sorted[i - 1].points === row.points)) rank = i + 1
        return { ...row, rank }
      })
    }

    const segments = prizes.segments.map((seg) => {
      const weekNos = Array.from(
        { length: seg.endWeek - seg.startWeek + 1 },
        (_, i) => seg.startWeek + i
      )
      const ids = weekNos.map((n) => weekIdByNo.get(n)).filter((x): x is string => !!x)
      // Every week in the span must exist AND be decided before a
      // segment pays — a "winner" with games outstanding is a lie.
      const complete = ids.length === weekNos.length && ids.every(weekDecided)
      const totals = entries.map((e) => ({
        entryId: e.id,
        points: weekRows
          .filter((r) => r.entryId === e.id && ids.includes(r.weekId))
          .reduce((n, r) => n + r.points, 0),
      }))
      const rankedSeg = rankRows(totals)
      return {
        name: seg.name,
        startWeek: seg.startWeek,
        endWeek: seg.endWeek,
        places: seg.places,
        complete,
        winners: complete
          ? rankedSeg
              .filter((r) => r.rank <= seg.places)
              .map((r) => ({ ...nameOf(r.entryId), points: r.points, rank: r.rank }))
          : [],
      }
    })

    // Key ranking mirrors the client's tab-2 order.
    const keyRanked = [...ranked].sort(
      (a, b) => b.keyPickScore - a.keyPickScore || b.totalPoints - a.totalPoints
    )
    let kRank = 0
    const keyWithRank = keyRanked.map((r, i) => {
      const prev = keyRanked[i - 1]
      if (!(prev && prev.keyPickScore === r.keyPickScore && prev.totalPoints === r.totalPoints))
        kRank = i + 1
      return { ...r, keyRank: kRank }
    })

    const bottomPoints = ranked.length
      ? Math.min(...ranked.map((r) => r.totalPoints))
      : null

    winners = {
      season: seasonOver
        ? ranked
            .filter((r) => r.rank <= prizes.seasonPlaces)
            .map((r) => ({ ...nameOf(r.entryId), points: r.totalPoints, rank: r.rank }))
        : [],
      seasonPlaces: prizes.seasonPlaces,
      key:
        seasonOver && prizes.keyPlaces > 0
          ? keyWithRank
              .filter((r) => r.keyRank <= prizes.keyPlaces)
              .map((r) => ({ ...nameOf(r.entryId), points: r.keyPickScore, rank: r.keyRank }))
          : [],
      keyPlaces: prizes.keyPlaces,
      lastPlace:
        seasonOver && prizes.lastPlace && bottomPoints != null
          ? ranked
              .filter((r) => r.totalPoints === bottomPoints)
              .map((r) => ({ ...nameOf(r.entryId), points: r.totalPoints, rank: r.rank }))
          : [],
      lastPlaceEnabled: prizes.lastPlace,
      segments,
    }
  }

  // Benched and banned, admins only — the roster's back room.
  const inactive = ctx.isPoolAdmin
    ? allEntries
        .filter((e) => e.status !== 'active')
        .map((e) => ({
          entryId: e.id,
          entryName: e.entryName,
          status: e.status,
          ownerName: nameByUser.get(e.userId) ?? null,
          ownerEmail: emailByUser.get(e.userId) ?? null,
        }))
    : []

  return res.status(200).json({
    final: seasonOver,
    winners,
    inactive,
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
        // Creator-only, never on the creator's rows, never on your own.
        canToggleAdmin:
          canManageAdmins &&
          entry.userId !== ctx.pool.createdBy &&
          entry.userId !== ctx.userId,
        // Any admin can bench/ban any non-creator entry but their own.
        canModerate:
          ctx.isPoolAdmin &&
          entry.userId !== ctx.pool.createdBy &&
          entry.userId !== ctx.userId,
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
