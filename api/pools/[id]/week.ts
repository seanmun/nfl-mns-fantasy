import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx, requirePoolAdmin } from '../../_pool.js'
import {
  nflGameLines,
  nflGames,
  nflPoolGames,
  nflPoolWeeks,
  nflTeams,
  nflWeeks,
} from '../../../src/lib/db/schema.js'
import { computeDeadline, isTbdKickoff } from '../../../src/lib/scoring/deadline.js'
import { currentWeek } from '../../../src/lib/sync/schedule.js'

// The pool manager's week: choose the slate, set the numbers, publish.
//
// GET    /api/pools/:id/week?week=3   — the builder view
// PUT    /api/pools/:id/week          — save slate + spreads (draft)
// POST   /api/pools/:id/week          — publish the week
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const poolId = String(req.query.id ?? '')
  const ctx = await loadCtx(req, res, poolId)
  if (!ctx) return
  if (!requirePoolAdmin(ctx, res)) return

  const { pool } = ctx
  const requested = Number(req.query.week ?? req.body?.week ?? 0)

  const [week] = requested
    ? await db
        .select()
        .from(nflWeeks)
        .where(
          and(
            eq(nflWeeks.season, pool.season),
            eq(nflWeeks.seasonType, 'regular'),
            eq(nflWeeks.week, requested)
          )
        )
        .limit(1)
    : [await currentWeek(db, pool.season)]

  if (!week) return res.status(404).json({ error: 'That week is not in this season.' })

  const games = await db
    .select()
    .from(nflGames)
    .where(eq(nflGames.weekId, week.id))
    .orderBy(asc(nflGames.kickoffAt))

  if (games.length === 0) {
    return res.status(404).json({ error: 'No games are loaded for that week yet.' })
  }

  // The slate materialises the first time a manager opens the week.
  // Idempotent upsert: every game gets a row, included by default and
  // prefilled from the market line, and the manager works from there.
  const lines = await db
    .select()
    .from(nflGameLines)
    .where(
      inArray(
        nflGameLines.gameId,
        games.map((g) => g.id)
      )
    )
  const lineByGame = new Map(lines.map((l) => [l.gameId, l]))

  const existingRows = await db
    .select()
    .from(nflPoolGames)
    .where(and(eq(nflPoolGames.poolId, pool.id), eq(nflPoolGames.weekId, week.id)))
  const existingByGame = new Map(existingRows.map((r) => [r.gameId, r]))

  const missing = games.filter((g) => !existingByGame.has(g.id))
  if (missing.length > 0) {
    await db.insert(nflPoolGames).values(
      missing.map((g) => ({
        poolId: pool.id,
        weekId: week.id,
        gameId: g.id,
        isIncluded: true,
        spread: lineByGame.get(g.id)?.spread ?? null,
        spreadSource: 'api' as const,
      }))
    )
  }

  const [poolWeek] =
    (await db
      .select()
      .from(nflPoolWeeks)
      .where(and(eq(nflPoolWeeks.poolId, pool.id), eq(nflPoolWeeks.weekId, week.id)))
      .limit(1)) ??
    []

  const ensuredPoolWeek =
    poolWeek ??
    (
      await db
        .insert(nflPoolWeeks)
        .values({ poolId: pool.id, weekId: week.id })
        .returning()
    )[0]

  // ── Save the draft ──────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { slate } = (req.body ?? {}) as {
      slate?: Array<{ gameId: string; isIncluded: boolean; spread: number | null }>
    }
    if (!Array.isArray(slate)) return res.status(400).json({ error: 'No slate supplied.' })

    const gameById = new Map(games.map((g) => [g.id, g]))
    const now = new Date()
    const published = ensuredPoolWeek.linesPublishedAt

    for (const row of slate) {
      const game = gameById.get(row.gameId)
      if (!game) continue

      // After publish, a number may still be corrected right up to that
      // game's own kickoff, and never after. Members have already picked
      // against it, so a change once it is under way would regrade a
      // result that is partly known.
      if (published && !isTbdKickoff(game.kickoffAt) && now >= game.kickoffAt) {
        const prior = existingByGame.get(row.gameId)
        if (prior && (prior.spread !== row.spread || prior.isIncluded !== row.isIncluded)) {
          return res.status(409).json({
            error: 'That game has already started — its line and slate cannot change now.',
          })
        }
        continue
      }

      await db
        .update(nflPoolGames)
        .set({
          isIncluded: row.isIncluded,
          spread: row.spread,
          // Once the manager types his own number it stays flagged as
          // his, so the review page can show what was overridden.
          spreadSource: row.spread !== lineByGame.get(row.gameId)?.spread ? 'manual' : 'api',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(nflPoolGames.poolId, pool.id),
            eq(nflPoolGames.gameId, row.gameId)
          )
        )
    }
    return res.status(200).json({ ok: true })
  }

  // ── Publish ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { pickDeadlineAt } = (req.body ?? {}) as { pickDeadlineAt?: string }

    const rows = await db
      .select()
      .from(nflPoolGames)
      .where(and(eq(nflPoolGames.poolId, pool.id), eq(nflPoolGames.weekId, week.id)))
    const included = rows.filter((r) => r.isIncluded)

    if (included.length === 0) {
      return res.status(400).json({ error: 'Include at least one game before publishing.' })
    }

    // An ATS game with no number cannot be graded, and discovering that
    // after the fact is unrecoverable. Blocked here rather than at
    // grading time.
    if (pool.spreadMode === 'ats') {
      const gameById = new Map(games.map((g) => [g.id, g]))
      const missingSpread = included.filter((r) => r.spread == null)
      if (missingSpread.length > 0) {
        const names = missingSpread
          .map((r) => {
            const g = gameById.get(r.gameId)
            return g ? `${g.awayTeamId}@${g.homeTeamId}` : r.gameId
          })
          .join(', ')
        return res.status(400).json({
          error: `These games still need a spread before you can publish: ${names}`,
        })
      }
    }

    const kickoffs = included
      .map((r) => games.find((g) => g.id === r.gameId)?.kickoffAt)
      .filter((d): d is Date => !!d)

    const deadline = pickDeadlineAt
      ? new Date(pickDeadlineAt)
      : computeDeadline(pool.deadlineAnchor, pool.deadlineOffsetMinutes, kickoffs)

    if (!deadline) {
      return res.status(400).json({
        error:
          'No kickoff matches this pool’s deadline rule this week, so the deadline has to be set by hand.',
      })
    }

    await db
      .update(nflPoolWeeks)
      .set({
        linesPublishedAt: new Date(),
        linesPublishedBy: ctx.userId,
        pickDeadlineAt: deadline,
        updatedAt: new Date(),
      })
      .where(eq(nflPoolWeeks.id, ensuredPoolWeek.id))

    return res.status(200).json({ ok: true, pickDeadlineAt: deadline })
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // ── Builder view ────────────────────────────────────────────────
  const rows = await db
    .select()
    .from(nflPoolGames)
    .where(and(eq(nflPoolGames.poolId, pool.id), eq(nflPoolGames.weekId, week.id)))
  const byGame = new Map(rows.map((r) => [r.gameId, r]))

  const teams = await db.select().from(nflTeams)
  const teamById = new Map(teams.map((t) => [t.id, t]))

  const now = new Date()
  const slate = games.map((g) => {
    const row = byGame.get(g.id)
    return {
      gameId: g.id,
      kickoffAt: g.kickoffAt,
      kickoffTbd: isTbdKickoff(g.kickoffAt),
      home: teamById.get(g.homeTeamId) ?? null,
      away: teamById.get(g.awayTeamId) ?? null,
      isIncluded: row?.isIncluded ?? true,
      spread: row?.spread ?? null,
      spreadSource: row?.spreadSource ?? 'api',
      // The market number, for comparison. Never what grading reads.
      marketSpread: lineByGame.get(g.id)?.spread ?? null,
      started: !isTbdKickoff(g.kickoffAt) && now >= g.kickoffAt,
    }
  })

  const included = slate.filter((s) => s.isIncluded)
  const suggested = computeDeadline(
    pool.deadlineAnchor,
    pool.deadlineOffsetMinutes,
    included.map((s) => s.kickoffAt)
  )

  return res.status(200).json({
    pool: {
      id: pool.id,
      name: pool.name,
      spreadMode: pool.spreadMode,
      lineSource: pool.lineSource,
      deadlineAnchor: pool.deadlineAnchor,
    },
    week: { id: week.id, week: week.week, label: week.label },
    publishedAt: ensuredPoolWeek.linesPublishedAt,
    pickDeadlineAt: ensuredPoolWeek.pickDeadlineAt,
    suggestedDeadline: suggested,
    slate,
  })
}
