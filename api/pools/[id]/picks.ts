import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx, othersPicksVisible } from '../../_pool.js'
import {
  nflGames,
  nflPicks,
  nflPoolEntries,
  nflPoolGames,
  nflPoolWeeks,
  nflTeams,
  nflWeeks,
} from '../../../src/lib/db/schema.js'
import { isPickable, isTbdKickoff } from '../../../src/lib/scoring/deadline.js'
import { currentWeek } from '../../../src/lib/sync/schedule.js'
import { validatePicks, type ProposedPick } from '../../../src/lib/picks/validate.js'
import type { PickNScoring } from '../../../src/lib/scoring/config.js'

// GET /api/pools/:id/picks?week=3   — the slate, plus this user's picks
// PUT /api/pools/:id/picks          — save one entry's picks for a week
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const poolId = String(req.query.id ?? '')
  const ctx = await loadCtx(req, res, poolId)
  if (!ctx) return

  if (ctx.entries.length === 0) {
    return res.status(403).json({ error: 'You are not in this pool.' })
  }

  const { pool } = ctx
  const config = pool.scoringConfig as unknown as PickNScoring

  // ── Which week ──────────────────────────────────────────────────
  const requested = Number(req.query.week ?? req.body?.week ?? 0)
  const [week] = requested
    ? await db
        .select()
        .from(nflWeeks)
        .where(
          and(
            eq(nflWeeks.season, pool.season),
            eq(nflWeeks.seasonType, pool.seasonType),
            eq(nflWeeks.week, requested)
          )
        )
        .limit(1)
    // No week asked for means "the one we're in". Defaulting to the
    // first week of the season would drop a member into Week 1 every
    // time they opened the app in November.
    : [await currentWeek(db, pool.season, pool.seasonType)]

  if (!week) return res.status(404).json({ error: 'That week is not in this season.' })

  const [poolWeek] = await db
    .select()
    .from(nflPoolWeeks)
    .where(and(eq(nflPoolWeeks.poolId, pool.id), eq(nflPoolWeeks.weekId, week.id)))
    .limit(1)

  // ── The pool's slate for that week ──────────────────────────────
  const slateRows = await db
    .select({
      gameId: nflGames.id,
      kickoffAt: nflGames.kickoffAt,
      status: nflGames.status,
      homeScore: nflGames.homeScore,
      awayScore: nflGames.awayScore,
      homeTeamId: nflGames.homeTeamId,
      awayTeamId: nflGames.awayTeamId,
      spread: nflPoolGames.spread,
      isIncluded: nflPoolGames.isIncluded,
    })
    .from(nflPoolGames)
    .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
    .where(
      and(
        eq(nflPoolGames.poolId, pool.id),
        eq(nflPoolGames.weekId, week.id),
        eq(nflPoolGames.isIncluded, true)
      )
    )
    .orderBy(asc(nflGames.kickoffAt))

  const teams = await db.select().from(nflTeams)
  const teamById = new Map(teams.map((t) => [t.id, t]))

  const now = new Date()
  const published = poolWeek?.linesPublishedAt ?? null
  const deadline = poolWeek?.pickDeadlineAt ?? null

  const slate = slateRows.map((g) => ({
    gameId: g.gameId,
    kickoffAt: g.kickoffAt,
    kickoffTbd: isTbdKickoff(g.kickoffAt),
    status: g.status,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    spread: g.spread,
    home: teamById.get(g.homeTeamId) ?? null,
    away: teamById.get(g.awayTeamId) ?? null,
    open: isPickable({
      now,
      linesPublishedAt: published,
      pickDeadlineAt: deadline,
      kickoffAt: g.kickoffAt,
    }),
  }))

  // ── Picks ───────────────────────────────────────────────────────
  const myEntryIds = ctx.entries.map((e) => e.id)
  const myPicks = await db
    .select()
    .from(nflPicks)
    .where(and(inArray(nflPicks.entryId, myEntryIds), eq(nflPicks.weekId, week.id)))

  // Everyone else's picks are withheld until the deadline. Single
  // source of truth for that rule — see othersPicksVisible.
  const revealed = await othersPicksVisible(pool.id, week.id)
  let others: unknown[] = []
  if (revealed) {
    const allEntries = await db
      .select()
      .from(nflPoolEntries)
      .where(eq(nflPoolEntries.poolId, pool.id))
    const rows = await db
      .select()
      .from(nflPicks)
      .where(
        and(
          inArray(
            nflPicks.entryId,
            allEntries.map((e) => e.id)
          ),
          eq(nflPicks.weekId, week.id)
        )
      )
    const nameById = new Map(allEntries.map((e) => [e.id, e.entryName]))
    others = rows.map((p) => ({
      entryId: p.entryId,
      entryName: nameById.get(p.entryId) ?? 'Entry',
      gameId: p.gameId,
      selectedTeamId: p.selectedTeamId,
      confidencePoints: p.confidencePoints,
      isKeyPick: p.isKeyPick,
      isAuto: p.isAuto,
      result: p.result,
      pointsEarned: p.pointsEarned,
    }))
  }

  const shape = {
    pool: {
      id: pool.id,
      name: pool.name,
      poolType: pool.poolType,
      spreadMode: pool.spreadMode,
      picksRequired: pool.picksRequired ?? config.picksRequired ?? null,
      keyPick: config.keyPick === true,
      managerNote: pool.managerNote,
    },
    week: { id: week.id, week: week.week, label: week.label },
    published,
    deadline,
    revealed,
    slate,
    entries: ctx.entries.map((e) => ({ id: e.id, entryName: e.entryName })),
    myPicks,
    others,
  }

  if (req.method === 'GET') return res.status(200).json(shape)
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })

  // ── Save ────────────────────────────────────────────────────────
  const { entryId, picks } = (req.body ?? {}) as { entryId?: string; picks?: ProposedPick[] }

  if (!entryId || !myEntryIds.includes(entryId)) {
    return res.status(403).json({ error: 'That entry is not yours.' })
  }
  if (!Array.isArray(picks)) {
    return res.status(400).json({ error: 'No picks supplied.' })
  }

  const existing = myPicks
    .filter((p) => p.entryId === entryId)
    .map((p) => ({
      pickId: p.id,
      gameId: p.gameId,
      selectedTeamId: p.selectedTeamId,
      confidencePoints: p.confidencePoints,
      isKeyPick: p.isKeyPick,
    }))

  // Survivor's no-reuse rule spans the whole season, so it needs every
  // earlier week, not just this one.
  let usedTeamIds: Set<string> | undefined
  if (pool.poolType === 'survivor') {
    const prior = await db
      .select({ teamId: nflPicks.selectedTeamId, weekId: nflPicks.weekId })
      .from(nflPicks)
      .where(eq(nflPicks.entryId, entryId))
    usedTeamIds = new Set(prior.filter((p) => p.weekId !== week.id).map((p) => p.teamId))
  }

  const result = validatePicks({
    poolType: pool.poolType,
    picksRequired: pool.picksRequired ?? config.picksRequired ?? null,
    keyPickEnabled: config.keyPick === true,
    slate: slateRows.map((g) => ({
      gameId: g.gameId,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      kickoffAt: g.kickoffAt,
      spread: g.spread,
    })),
    existing,
    proposed: picks,
    now,
    linesPublishedAt: published,
    pickDeadlineAt: deadline,
    usedTeamIds,
  })

  if (!result.ok) return res.status(400).json({ errors: result.errors })

  const carried = new Set(result.carried)

  try {
    // Locked picks are NEVER deleted and reinserted. Their rows may
    // already hold a grade, points and an isAuto flag; rewriting them
    // would discard all of that and leave the standings wrong until the
    // next grading pass. Only the still-open picks are replaced.
    const replaceable = result.effective.filter((p) => !carried.has(p.gameId))

    const toDelete = existing
      .filter((p) => !carried.has(p.gameId))
      .map((p) => p.pickId)
    if (toDelete.length > 0) {
      await db.delete(nflPicks).where(inArray(nflPicks.id, toDelete))
    }

    if (replaceable.length > 0) {
      await db.insert(nflPicks).values(
        replaceable.map((p) => ({
          entryId,
          gameId: p.gameId,
          weekId: week.id,
          selectedTeamId: p.selectedTeamId,
          confidencePoints: p.confidencePoints ?? null,
          isKeyPick: p.isKeyPick === true,
          // Anything written here was chosen by a person. The deadline
          // job is the only thing that sets isAuto.
          isAuto: false,
          lineSpreadAtPick: slateRows.find((g) => g.gameId === p.gameId)?.spread ?? null,
        }))
      )
    }

    // A locked pick's team is fixed, but which pick carries the KEY is
    // still the member's to change until the deadline — so that one flag
    // is synced onto the carried rows rather than left stale.
    for (const gameId of carried) {
      const wanted = result.effective.find((p) => p.gameId === gameId)?.isKeyPick === true
      const row = existing.find((p) => p.gameId === gameId)
      if (row && row.isKeyPick !== wanted) {
        await db
          .update(nflPicks)
          .set({ isKeyPick: wanted, updatedAt: new Date() })
          .where(eq(nflPicks.id, row.pickId))
      }
    }

    return res.status(200).json({ ok: true, saved: result.effective.length })
  } catch (error) {
    console.error('PUT /api/pools/:id/picks failed:', error)
    return res.status(500).json({ error: 'Could not save those picks.' })
  }
}
