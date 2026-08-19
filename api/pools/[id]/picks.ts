import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx, othersPicksVisible } from '../../_pool.js'
import {
  nflEntryWeeks,
  nflGames,
  nflPicks,
  nflPoolEntries,
  nflPoolGames,
  nflPoolWeeks,
  nflTeams,
  nflWeeks,
  users,
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

  // A published ATS game with no number is OFF THE BOARD — the admin
  // couldn't or wouldn't hang a line on it. Shown, never pickable, and
  // it can come back on the board if the admin fills it in later.
  const isOffBoard = (spread: number | null) =>
    pool.spreadMode === 'ats' && published != null && spread == null

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
    offBoard: isOffBoard(g.spread),
    open:
      !isOffBoard(g.spread) &&
      isPickable({
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

  // Submission stamps for this user's entries this week. Missing row =
  // never submitted.
  const myEntryWeeks = await db
    .select({ entryId: nflEntryWeeks.entryId, submittedAt: nflEntryWeeks.submittedAt })
    .from(nflEntryWeeks)
    .where(and(inArray(nflEntryWeeks.entryId, myEntryIds), eq(nflEntryWeeks.weekId, week.id)))
  const submittedByEntry = new Map(myEntryWeeks.map((r) => [r.entryId, r.submittedAt]))

  // Everyone else's picks are withheld until the deadline. Single
  // source of truth for that rule — see othersPicksVisible.
  const revealed = await othersPicksVisible(pool.id, week.id)
  let others: unknown[] = []
  if (revealed) {
    const allEntries = (
      await db.select().from(nflPoolEntries).where(eq(nflPoolEntries.poolId, pool.id))
    ).filter((e) => e.status === 'active')
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

    // Owner handles are PUBLIC (the pool sees shared ownership); emails
    // stay MANAGER-ONLY.
    const owners = allEntries.length
      ? await db
          .select({ id: users.id, email: users.email, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, [...new Set(allEntries.map((e) => e.userId))]))
      : []
    const ownerByUser = new Map(owners.map((o) => [o.id, o]))
    const handleByEntry = new Map<string, string>()
    const emailByEntry = new Map<string, string>()
    for (const e of allEntries) {
      const o = ownerByUser.get(e.userId)
      if (!o) continue
      handleByEntry.set(e.id, o.displayName)
      // Manager sees the full email ONLY while the owner has no real
      // username (displayName == email local part is the fallback tell).
      if (ctx.isPoolAdmin && o.displayName === o.email.split('@')[0]) {
        emailByEntry.set(e.id, o.email)
      }
    }

    others = rows.map((p) => ({
      entryId: p.entryId,
      entryName: nameById.get(p.entryId) ?? 'Entry',
      ownerName: handleByEntry.get(p.entryId) ?? null,
      ownerEmail: emailByEntry.get(p.entryId) ?? null,
      gameId: p.gameId,
      selectedTeamId: p.selectedTeamId,
      confidencePoints: p.confidencePoints,
      isKeyPick: p.isKeyPick,
      isAuto: p.isAuto,
      result: p.result,
      pointsEarned: p.pointsEarned,
    }))
  }

  // ── Pool pulse ──────────────────────────────────────────────────
  // "9 of 12 entries in" — counts only, so it leaks no picks before the
  // reveal. An entry is "in" when it holds this week's full quota.
  const needCount =
    pool.poolType === 'survivor'
      ? 1
      : pool.picksRequired ?? config.picksRequired ?? slateRows.length
  const allPoolEntries = await db
    .select({ id: nflPoolEntries.id })
    .from(nflPoolEntries)
    .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.status, 'active')))
  const weekPickRows = allPoolEntries.length
    ? await db
        .select({ entryId: nflPicks.entryId })
        .from(nflPicks)
        .where(
          and(
            inArray(nflPicks.entryId, allPoolEntries.map((e) => e.id)),
            eq(nflPicks.weekId, week.id)
          )
        )
    : []
  const perEntry = new Map<string, number>()
  for (const r of weekPickRows) perEntry.set(r.entryId, (perEntry.get(r.entryId) ?? 0) + 1)
  const pulse = {
    entriesTotal: allPoolEntries.length,
    entriesComplete: [...perEntry.values()].filter((n) => n >= needCount).length,
  }

  // ── Last graded week, per caller entry ──────────────────────────
  // The recap card: how each of my entries did, and where it moved.
  const gradedRows = myEntryIds.length
    ? await db
        .select({
          entryId: nflEntryWeeks.entryId,
          weekId: nflEntryWeeks.weekId,
          points: nflEntryWeeks.points,
          correct: nflEntryWeeks.correctCount,
          incorrect: nflEntryWeeks.incorrectCount,
          push: nflEntryWeeks.pushCount,
          weeklyRank: nflEntryWeeks.weeklyRank,
          cumulativeRank: nflEntryWeeks.cumulativeRank,
          gradedAt: nflEntryWeeks.gradedAt,
        })
        .from(nflEntryWeeks)
        .where(inArray(nflEntryWeeks.entryId, myEntryIds))
    : []
  const weekNoById = new Map(
    (
      await db
        .select({ id: nflWeeks.id, week: nflWeeks.week, label: nflWeeks.label })
        .from(nflWeeks)
        .where(
          and(eq(nflWeeks.season, pool.season), eq(nflWeeks.seasonType, pool.seasonType))
        )
    ).map((w) => [w.id, w])
  )
  const recaps = myEntryIds.map((id) => {
    const mine = gradedRows
      // The week on screen is the hero's job — a recap of a half-graded
      // current week just repeats it. Recaps are PRIOR weeks only.
      .filter((r) => r.entryId === id && r.gradedAt != null && r.weekId !== week.id)
      .sort(
        (a, b) => (weekNoById.get(b.weekId)?.week ?? 0) - (weekNoById.get(a.weekId)?.week ?? 0)
      )
    const latest = mine[0]
    if (!latest) return null
    const prior = mine[1]
    return {
      entryId: id,
      weekLabel: weekNoById.get(latest.weekId)?.label ?? '',
      points: latest.points,
      correct: latest.correct,
      incorrect: latest.incorrect,
      push: latest.push,
      weeklyRank: latest.weeklyRank,
      rank: latest.cumulativeRank,
      // Positive = climbed since the week before.
      rankChange:
        prior?.cumulativeRank != null && latest.cumulativeRank != null
          ? prior.cumulativeRank - latest.cumulativeRank
          : null,
    }
  }).filter(Boolean)

  const shape = {
    pulse,
    recaps,
    pool: {
      id: pool.id,
      name: pool.name,
      poolType: pool.poolType,
      spreadMode: pool.spreadMode,
      picksRequired: pool.picksRequired ?? config.picksRequired ?? null,
      keyPick: config.keyPick === true,
      managerNote: pool.managerNote,
      // Week navigation bounds — the pool's own span, not the calendar's.
      startWeek: pool.startWeek,
      endWeek: pool.endWeek,
      // Null means uncapped. The pool home uses it to decide whether
      // "Add another entry" is on the table at all.
      maxEntriesPerUser: pool.maxEntriesPerUser,
    },
    // Whether the CALLER runs this pool, not a fact about the pool.
    manager: ctx.isPoolAdmin,
    week: { id: week.id, week: week.week, label: week.label },
    published,
    deadline,
    revealed,
    slate,
    entries: ctx.entries.map((e) => ({
      id: e.id,
      entryName: e.entryName,
      status: e.status,
      submittedAt: submittedByEntry.get(e.id) ?? null,
    })),
    myPicks,
    others,
  }

  if (req.method === 'GET') return res.status(200).json(shape)
  // ── Submit ──────────────────────────────────────────────────────
  // The explicit "I'm done" — allowed only while picks are open and only
  // on a complete set, so a confirmation can never be a lie. Autofill
  // never stamps this: an app-filled week reads as filled, not confirmed.
  if (req.method === 'POST') {
    const { entryId } = (req.body ?? {}) as { entryId?: string }
    if (!entryId || !myEntryIds.includes(entryId)) {
      return res.status(403).json({ error: 'That entry is not yours.' })
    }
    if (ctx.entries.find((e) => e.id === entryId)?.status !== 'active') {
      return res.status(403).json({ errors: ['This entry is not active this season.'] })
    }
    if (!published) {
      return res.status(400).json({ errors: ['This week is not open yet.'] })
    }
    if (deadline && now >= deadline) {
      return res.status(400).json({ errors: ['Picks are closed for this week.'] })
    }

    const mine = myPicks.filter((p) => p.entryId === entryId)
    const need =
      pool.poolType === 'survivor'
        ? 1
        : pool.picksRequired ?? config.picksRequired ?? slateRows.length
    if (mine.length < need) {
      return res.status(400).json({
        errors: [`You have ${mine.length} of ${need} picks in — finish before submitting.`],
      })
    }
    if (config.keyPick === true && !mine.some((p) => p.isKeyPick)) {
      return res.status(400).json({ errors: ['Choose your key pick before submitting.'] })
    }

    await db
      .insert(nflEntryWeeks)
      .values({ entryId, weekId: week.id, submittedAt: now })
      .onConflictDoUpdate({
        target: [nflEntryWeeks.entryId, nflEntryWeeks.weekId],
        set: { submittedAt: now },
      })
    return res.status(200).json({ ok: true, submittedAt: now.toISOString() })
  }

  // ── Rename an entry ─────────────────────────────────────────────
  // Owner-only, and the name stays unique in the pool. Names are the
  // leaderboard's identity, so the row itself never changes — history,
  // picks and points all ride along.
  if (req.method === 'PATCH') {
    const { entryId, entryName: newName } = (req.body ?? {}) as {
      entryId?: string
      entryName?: string
    }
    if (!entryId || !myEntryIds.includes(entryId)) {
      return res.status(403).json({ error: 'That entry is not yours.' })
    }
    const wanted = newName?.trim()
    if (!wanted) return res.status(400).json({ error: 'Give the entry a name.' })

    const poolEntries = await db
      .select({ id: nflPoolEntries.id, entryName: nflPoolEntries.entryName })
      .from(nflPoolEntries)
      .where(eq(nflPoolEntries.poolId, pool.id))
    if (
      poolEntries.some(
        (t) => t.id !== entryId && t.entryName.toLowerCase() === wanted.toLowerCase()
      )
    ) {
      return res.status(409).json({ error: `“${wanted}” is taken in this pool — pick another name.` })
    }

    await db
      .update(nflPoolEntries)
      .set({ entryName: wanted })
      .where(eq(nflPoolEntries.id, entryId))
    return res.status(200).json({ ok: true, entryName: wanted })
  }

  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })

  // ── Save ────────────────────────────────────────────────────────
  const { entryId, picks } = (req.body ?? {}) as { entryId?: string; picks?: ProposedPick[] }

  if (!entryId || !myEntryIds.includes(entryId)) {
    return res.status(403).json({ error: 'That entry is not yours.' })
  }
  if (ctx.entries.find((e) => e.id === entryId)?.status !== 'active') {
    return res.status(403).json({ error: 'This entry is not active this season.' })
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
    // Off-the-board games are simply not in the validator's slate, so a
    // pick on one fails the same way a pick on an excluded game does.
    slate: slateRows
      .filter((g) => !isOffBoard(g.spread))
      .map((g) => ({
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

    // Edited means no longer confirmed. Any successful save clears the
    // submission stamp; the member resubmits when they are done again.
    await db
      .update(nflEntryWeeks)
      .set({ submittedAt: null })
      .where(and(eq(nflEntryWeeks.entryId, entryId), eq(nflEntryWeeks.weekId, week.id)))

    return res.status(200).json({ ok: true, saved: result.effective.length })
  } catch (error) {
    console.error('PUT /api/pools/:id/picks failed:', error)
    return res.status(500).json({ error: 'Could not save those picks.' })
  }
}
