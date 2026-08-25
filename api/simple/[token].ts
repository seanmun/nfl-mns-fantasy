import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../_db.js'
import {
  nflEntryWeeks,
  nflGames,
  nflPicks,
  nflPoolGames,
  nflPools,
  nflPoolEntries,
  nflPoolWeeks,
  nflTeams,
} from '../../src/lib/db/schema.js'
import { isPickable } from '../../src/lib/scoring/deadline.js'
import { currentWeek } from '../../src/lib/sync/schedule.js'
import { validatePicks, type ProposedPick } from '../../src/lib/picks/validate.js'
import type { PickNScoring } from '../../src/lib/scoring/config.js'

// Simple Mode: the no-login pick flow. The token in the URL is the
// credential — 128 bits minted at enable time, scoped to exactly one
// entry's picks. Every rule the logged-in path enforces runs here too:
// same validator, same deadlines, same submit semantics. This endpoint
// can read one entry's slate and write one entry's picks, and nothing
// else — no emails, no roster, no other members.
//
// GET  /api/simple/:token   — slate + my picks for the current week
// PUT  /api/simple/:token   — save the full pick set
// POST /api/simple/:token   — submit (the big green Done)

export function mintSimpleToken(): string {
  return randomBytes(16).toString('hex')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '')
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return res.status(404).json({ error: 'This link is not valid.' })
  }

  const [entry] = await db
    .select()
    .from(nflPoolEntries)
    .where(eq(nflPoolEntries.simpleToken, token))
    .limit(1)
  if (!entry || !entry.simpleMode) {
    return res.status(404).json({ error: 'This link is not active. Ask your pool manager for a new one.' })
  }
  if (entry.status !== 'active') {
    return res.status(403).json({ error: 'This entry is not playing this season.' })
  }

  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, entry.poolId)).limit(1)
  if (!pool) return res.status(404).json({ error: 'This pool no longer exists.' })
  const config = pool.scoringConfig as unknown as PickNScoring

  const week = await currentWeek(db, pool.season, pool.seasonType)
  if (!week) return res.status(404).json({ error: 'The season has not started yet.' })

  const [poolWeek] = await db
    .select()
    .from(nflPoolWeeks)
    .where(and(eq(nflPoolWeeks.poolId, pool.id), eq(nflPoolWeeks.weekId, week.id)))
    .limit(1)
  const published = poolWeek?.linesPublishedAt ?? null
  const deadline = poolWeek?.pickDeadlineAt ?? null

  const slateRows = await db
    .select({
      gameId: nflGames.id,
      kickoffAt: nflGames.kickoffAt,
      status: nflGames.status,
      homeTeamId: nflGames.homeTeamId,
      awayTeamId: nflGames.awayTeamId,
      spread: nflPoolGames.spread,
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

  const now = new Date()
  const isOffBoard = (spread: number | null) =>
    pool.spreadMode === 'ats' && published != null && spread == null

  const myPicks = await db
    .select()
    .from(nflPicks)
    .where(and(eq(nflPicks.entryId, entry.id), eq(nflPicks.weekId, week.id)))

  const need =
    pool.poolType === 'survivor'
      ? 1
      : pool.picksRequired ?? config.picksRequired ?? slateRows.filter((g) => !isOffBoard(g.spread)).length

  // ── Save ────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { picks } = (req.body ?? {}) as { picks?: ProposedPick[] }
    if (!Array.isArray(picks)) return res.status(400).json({ error: 'No picks supplied.' })

    let usedTeamIds: Set<string> | undefined
    if (pool.poolType === 'survivor') {
      const prior = await db
        .select({ teamId: nflPicks.selectedTeamId, weekId: nflPicks.weekId })
        .from(nflPicks)
        .where(eq(nflPicks.entryId, entry.id))
      usedTeamIds = new Set(prior.filter((p) => p.weekId !== week.id).map((p) => p.teamId))
    }

    const result = validatePicks({
      poolType: pool.poolType,
      picksRequired: pool.picksRequired ?? config.picksRequired ?? null,
      keyPickEnabled: config.keyPick === true,
      slate: slateRows
        .filter((g) => !isOffBoard(g.spread))
        .map((g) => ({
          gameId: g.gameId,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          kickoffAt: g.kickoffAt,
          spread: g.spread,
        })),
      existing: myPicks.map((p) => ({
        pickId: p.id,
        gameId: p.gameId,
        selectedTeamId: p.selectedTeamId,
        confidencePoints: p.confidencePoints,
        isKeyPick: p.isKeyPick,
      })),
      proposed: picks,
      now,
      linesPublishedAt: published,
      pickDeadlineAt: deadline,
      usedTeamIds,
    })
    if (!result.ok) return res.status(400).json({ errors: result.errors })

    const carried = new Set(result.carried)
    const toDelete = myPicks.filter((p) => !carried.has(p.gameId)).map((p) => p.id)
    if (toDelete.length) await db.delete(nflPicks).where(inArray(nflPicks.id, toDelete))
    const replaceable = result.effective.filter((p) => !carried.has(p.gameId))
    if (replaceable.length) {
      await db.insert(nflPicks).values(
        replaceable.map((p) => ({
          entryId: entry.id,
          gameId: p.gameId,
          weekId: week.id,
          selectedTeamId: p.selectedTeamId,
          confidencePoints: p.confidencePoints ?? null,
          isKeyPick: p.isKeyPick === true,
          isAuto: false,
          lineSpreadAtPick: slateRows.find((g) => g.gameId === p.gameId)?.spread ?? null,
        }))
      )
    }
    for (const gameId of carried) {
      const wanted = result.effective.find((p) => p.gameId === gameId)?.isKeyPick === true
      const row = myPicks.find((p) => p.gameId === gameId)
      if (row && row.isKeyPick !== wanted) {
        await db.update(nflPicks).set({ isKeyPick: wanted, updatedAt: new Date() }).where(eq(nflPicks.id, row.id))
      }
    }
    // Edited means no longer confirmed — same rule as the full app.
    await db
      .update(nflEntryWeeks)
      .set({ submittedAt: null })
      .where(and(eq(nflEntryWeeks.entryId, entry.id), eq(nflEntryWeeks.weekId, week.id)))
    return res.status(200).json({ ok: true, saved: result.effective.length })
  }

  // ── Submit ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!published) return res.status(400).json({ errors: ['This week is not open yet.'] })
    if (deadline && now >= deadline) {
      return res.status(400).json({ errors: ['Picks are closed for this week.'] })
    }
    if (myPicks.length < need) {
      return res.status(400).json({
        errors: [`You have ${myPicks.length} of ${need} picks in — finish before submitting.`],
      })
    }
    if (config.keyPick === true && !myPicks.some((p) => p.isKeyPick)) {
      return res.status(400).json({ errors: ['Choose your star pick before submitting.'] })
    }
    await db
      .insert(nflEntryWeeks)
      .values({ entryId: entry.id, weekId: week.id, submittedAt: now })
      .onConflictDoUpdate({
        target: [nflEntryWeeks.entryId, nflEntryWeeks.weekId],
        set: { submittedAt: now },
      })
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // ── The payload ─────────────────────────────────────────────────
  const teams = await db.select().from(nflTeams)
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const [entryWeek] = await db
    .select({ submittedAt: nflEntryWeeks.submittedAt })
    .from(nflEntryWeeks)
    .where(and(eq(nflEntryWeeks.entryId, entry.id), eq(nflEntryWeeks.weekId, week.id)))
    .limit(1)

  return res.status(200).json({
    poolName: pool.name,
    entryName: entry.entryName,
    week: { week: week.week, label: week.label },
    spreadMode: pool.spreadMode,
    keyPick: config.keyPick === true,
    need,
    published,
    deadline,
    submittedAt: entryWeek?.submittedAt ?? null,
    slate: slateRows.map((g) => ({
      gameId: g.gameId,
      kickoffAt: g.kickoffAt,
      spread: g.spread,
      offBoard: isOffBoard(g.spread),
      home: teamById.get(g.homeTeamId) ?? null,
      away: teamById.get(g.awayTeamId) ?? null,
      open:
        !isOffBoard(g.spread) &&
        isPickable({ now, linesPublishedAt: published, pickDeadlineAt: deadline, kickoffAt: g.kickoffAt }),
    })),
    myPicks: myPicks.map((p) => ({
      gameId: p.gameId,
      selectedTeamId: p.selectedTeamId,
      isKeyPick: p.isKeyPick,
    })),
  })
}
