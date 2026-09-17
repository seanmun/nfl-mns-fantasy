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

// Prize rules for a pool created before prize settings existed: one
// season winner. Also what a first pot save builds on.
const DEFAULT_PRIZE_RULES: PrizesConfig = {
  seasonPlaces: 1,
  keyPlaces: 0,
  lastPlace: false,
  segments: [],
}

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
      prizePool?: { potUsd?: unknown; shares?: Record<string, unknown> }
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
    // The tracked prize pool: the pot's dollar value and each paid
    // place's percent of it, keyed exactly as GET's prizePool.items.
    // Absorbs rather than refuses — shares that don't total 100 save
    // (the page shows what's unassigned), and an unreadable pot keeps
    // the last good value.
    if (sIn.prizePool && typeof sIn.prizePool === 'object') {
      const current = (ctx.pool.prizesConfig as PrizesConfig | null) ?? DEFAULT_PRIZE_RULES
      const shares = sIn.prizePool.shares ?? {}
      const pct = (key: string): number | null => {
        const v = shares[key]
        if (v == null || v === '') return null
        const n = Number(v)
        return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100) / 100)) : null
      }
      const raw = sIn.prizePool.potUsd
      const potUsd =
        raw == null || raw === ''
          ? null
          : Number.isFinite(Number(raw))
            ? Math.max(0, Math.min(100_000_000, Math.round(Number(raw) * 100) / 100))
            : current.potUsd ?? null
      const next: PrizesConfig = {
        ...current,
        potUsd,
        potUpdatedAt:
          potUsd !== (current.potUsd ?? null) ? new Date().toISOString() : current.potUpdatedAt ?? null,
        seasonShares: Array.from({ length: current.seasonPlaces }, (_, i) => pct(`season-${i + 1}`)),
        keyShares: Array.from({ length: current.keyPlaces }, (_, i) => pct(`key-${i + 1}`)),
        lastPlaceShare: current.lastPlace ? pct('last') : null,
        segments: current.segments.map((seg, si) => ({
          ...seg,
          shares: Array.from({ length: seg.places }, (_, i) => pct(`seg-${si}-${i + 1}`)),
        })),
      }
      patch.prizesConfig = next
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
  // A pool that predates prize settings still has a prize page: one
  // season winner, nothing else, until the manager says otherwise.
  const rules: PrizesConfig = prizes ?? DEFAULT_PRIZE_RULES

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

  const segCalc = rules.segments.map((seg) => {
    const weekNos = Array.from(
      { length: seg.endWeek - seg.startWeek + 1 },
      (_, i) => seg.startWeek + i
    )
    const ids = weekNos.map((n) => weekIdByNo.get(n)).filter((x): x is string => !!x)
    // Every week in the span must exist AND be decided before a
    // segment pays — a "winner" with games outstanding is a lie.
    const complete = ids.length === weekNos.length && ids.every(weekDecided)
    const started = weekRows.some((r) => r.gradedAt != null && ids.includes(r.weekId))
    const totals = entries.map((e) => ({
      entryId: e.id,
      points: weekRows
        .filter((r) => r.entryId === e.id && ids.includes(r.weekId))
        .reduce((n, r) => n + r.points, 0),
    }))
    return { seg, complete, started, rankedSeg: rankRows(totals) }
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

  const winners = prizes
    ? {
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
        segments: segCalc.map(({ seg, complete, rankedSeg }) => ({
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
        })),
      }
    : null

  // ── Prize pool ──────────────────────────────────────────────────
  // One item per paid place: its share of the pot, and who holds it
  // RIGHT NOW (or who won it). TRACKED only — the app never holds or
  // moves the pot. A share the manager has not set shows as unset,
  // never guessed. Item keys are what the settings POST writes back.
  const pot = rules.potUsd ?? null
  const anyGraded = weekRows.some((r) => r.gradedAt != null)
  // Who holds place p in a competition ranking: the tied group whose
  // span covers p — two level at the top hold 1st AND 2nd between them.
  const holders = <T extends { entryId: string }>(
    rows: T[],
    rankOf: (r: T) => number,
    place: number
  ): T[] => {
    const size = new Map<number, number>()
    for (const r of rows) size.set(rankOf(r), (size.get(rankOf(r)) ?? 0) + 1)
    return rows.filter((r) => rankOf(r) <= place && place < rankOf(r) + (size.get(rankOf(r)) ?? 0))
  }
  const ordinal = (n: number) =>
    `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
  const amountOf = (share: number | null) =>
    pot != null && share != null ? Math.round(pot * share) / 100 : null
  type PrizeStatus = 'final' | 'live' | 'upcoming'
  const items: Array<{
    key: string
    label: string
    detail: string | null
    share: number | null
    amountUsd: number | null
    status: PrizeStatus
    unit: string
    leaders: Array<{ entryId: string; entryName: string; ownerName: string | null; points: number }>
  }> = []
  const seasonStatus: PrizeStatus = seasonOver ? 'final' : anyGraded ? 'live' : 'upcoming'

  for (let p = 1; p <= rules.seasonPlaces; p++) {
    const share = rules.seasonShares?.[p - 1] ?? null
    items.push({
      key: `season-${p}`,
      label: rules.seasonPlaces === 1 ? 'Season winner' : `Season ${ordinal(p)}`,
      detail: 'Most points all season',
      share,
      amountUsd: amountOf(share),
      status: seasonStatus,
      unit: 'pts',
      leaders: anyGraded
        ? holders(ranked, (r) => r.rank, p).map((r) => ({ ...nameOf(r.entryId), points: r.totalPoints }))
        : [],
    })
  }
  segCalc.forEach(({ seg, complete, started, rankedSeg }, si) => {
    for (let p = 1; p <= seg.places; p++) {
      const share = seg.shares?.[p - 1] ?? null
      items.push({
        key: `seg-${si}-${p}`,
        label: `Weeks ${seg.startWeek}–${seg.endWeek}${seg.places > 1 ? ` ${ordinal(p)}` : ''}`,
        detail: started || complete ? `Most points in weeks ${seg.startWeek}–${seg.endWeek}` : `Starts Week ${seg.startWeek}`,
        share,
        amountUsd: amountOf(share),
        status: complete ? 'final' : started ? 'live' : 'upcoming',
        unit: 'pts',
        leaders:
          started || complete
            ? holders(rankedSeg, (r) => r.rank, p).map((r) => ({ ...nameOf(r.entryId), points: r.points }))
            : [],
      })
    }
  })
  for (let p = 1; p <= rules.keyPlaces; p++) {
    const share = rules.keyShares?.[p - 1] ?? null
    items.push({
      key: `key-${p}`,
      label: rules.keyPlaces === 1 ? 'Key picks ★' : `Key picks ★ ${ordinal(p)}`,
      detail: 'Best key-pick record all season',
      share,
      amountUsd: amountOf(share),
      status: seasonStatus,
      unit: 'key ★',
      leaders: anyGraded
        ? holders(keyWithRank, (r) => r.keyRank, p).map((r) => ({ ...nameOf(r.entryId), points: r.keyPickScore }))
        : [],
    })
  }
  if (rules.lastPlace) {
    const share = rules.lastPlaceShare ?? null
    items.push({
      key: 'last',
      label: 'Last place',
      detail: 'Fewest points all season',
      share,
      amountUsd: amountOf(share),
      status: seasonStatus,
      unit: 'pts',
      leaders:
        anyGraded && bottomPoints != null
          ? ranked
              .filter((r) => r.totalPoints === bottomPoints)
              .map((r) => ({ ...nameOf(r.entryId), points: r.totalPoints }))
          : [],
    })
  }
  const prizePool = { potUsd: pot, potUpdatedAt: rules.potUpdatedAt ?? null, items }

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
    // Whether the CALLER runs this pool — the prize page offers the
    // pot and payout editor only to them.
    manager: ctx.isPoolAdmin,
    winners,
    prizePool,
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
          // A row can exist before any grading — submitting picks creates
          // it with zero points — so only a GRADED row has points. Null
          // keeps an ungraded week from ranking everyone on a fake 0.
          return ew?.gradedAt
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
