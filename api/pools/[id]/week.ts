import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx, requirePoolAdmin } from '../../_pool.js'
import {
  nflGameLines,
  nflGames,
  nflPoolEntries,
  nflPoolAnnouncements,
  nflPoolGameLineEvents,
  nflPoolGames,
  nflPoolWeeks,
  nflTeams,
  nflWeeks,
  users,
} from '../../../src/lib/db/schema.js'
import { esc, sendAll, type Message } from '../../_email.js'
import {
  emailCard,
  emailNote,
  emailRow,
  emailSection,
  emailShell,
  fmtSpread,
} from '../../_emailTemplate.js'
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
            eq(nflWeeks.seasonType, pool.seasonType),
            eq(nflWeeks.week, requested)
          )
        )
        .limit(1)
    : [await currentWeek(db, pool.season, pool.seasonType)]

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

      // Publishing locks the SLATE, not the numbers. A published line can
      // still be corrected until its game kicks off — rare, but a
      // fat-fingered sign happens — and every such change is logged for
      // the whole pool to see. Fairness lives in the picks: each pick
      // grades on the line it was saved against, so an edit only applies
      // forward. What a publish does still forbid: changing which games
      // are in, taking a numbered game off the board, and touching
      // anything after kickoff.
      if (published) {
        const prior = existingByGame.get(row.gameId)
        if (!prior) continue
        if (prior.isIncluded !== row.isIncluded) {
          return res.status(409).json({
            error: 'The slate is locked once the week is published.',
          })
        }
        if (prior.spread != null && row.spread == null) {
          return res.status(409).json({
            error: 'A published line can change, but a game cannot go off the board after members have picked it.',
          })
        }
        if (row.spread !== prior.spread) {
          if (!isTbdKickoff(game.kickoffAt) && now >= game.kickoffAt) {
            return res.status(409).json({
              error: 'That game has already started — its line is settled.',
            })
          }
          await db.insert(nflPoolGameLineEvents).values({
            poolGameId: prior.id,
            prevSpread: prior.spread,
            spread: row.spread,
            changedBy: ctx.userId,
          })
        }
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
  // Publishing locks whatever numbers were entered and emails every
  // ACTIVE member the lines, with the admin's note on top when there is
  // one. A blank ATS spread is deliberate: that game goes out OFF THE
  // BOARD — unpickable — and a later fill-in triggers this same path,
  // another lock, another email. pool_announcements logs each blast.
  if (req.method === 'POST') {
    const { pickDeadlineAt, message } = (req.body ?? {}) as {
      pickDeadlineAt?: string
      message?: string
    }

    const rows = await db
      .select()
      .from(nflPoolGames)
      .where(and(eq(nflPoolGames.poolId, pool.id), eq(nflPoolGames.weekId, week.id)))
    const included = rows.filter((r) => r.isIncluded)

    if (included.length === 0) {
      return res.status(400).json({ error: 'Include at least one game before publishing.' })
    }

    const republish = ensuredPoolWeek.linesPublishedAt != null

    const kickoffs = included
      .map((r) => games.find((g) => g.id === r.gameId)?.kickoffAt)
      .filter((d): d is Date => !!d)

    // The deadline is FROZEN at first publish. A re-publish only fills
    // off-the-board lines; moving the cutoff under members who planned
    // around it is not on the table.
    let deadline = republish
      ? ensuredPoolWeek.pickDeadlineAt
      : pickDeadlineAt
        ? new Date(pickDeadlineAt)
        : computeDeadline(pool.deadlineAnchor, pool.deadlineOffsetMinutes, kickoffs)

    // A late publish must yield a WORKING week, never a dead one. If the
    // anchored deadline is already behind us (the admin published after
    // the anchor kickoff — the exact panic moment), fall back to the
    // last unplayed kickoff: the week opens, each game still locks at
    // its own kickoff, and only already-started games are lost. If every
    // game has started, the week publishes locked — honestly, not
    // accidentally.
    const now2 = new Date()
    if (!deadline || deadline <= now2) {
      const unplayed = kickoffs.filter((k) => !isTbdKickoff(k) && now2 < k)
      deadline = unplayed.length
        ? new Date(Math.max(...unplayed.map((k) => k.getTime())))
        : deadline ?? now2
    }

    await db
      .update(nflPoolWeeks)
      .set({
        linesPublishedAt: ensuredPoolWeek.linesPublishedAt ?? new Date(),
        linesPublishedBy: ctx.userId,
        pickDeadlineAt: deadline,
        updatedAt: new Date(),
      })
      .where(eq(nflPoolWeeks.id, ensuredPoolWeek.id))

    // ── The lines email ─────────────────────────────────────────
    const teams = await db.select().from(nflTeams)
    const nick = new Map(teams.map((t) => [t.id, t.nickname]))
    const gameById = new Map(games.map((g) => [g.id, g]))

    // Favorite on the left, underdog's points on the right, home side
    // carried by the connector: "Giants at Eagles +3" = Eagles home AND
    // underdog. Blank line = off the board.
    const lineText = (r: (typeof included)[number]): string => {
      const g = gameById.get(r.gameId)
      if (!g) return ''
      const home = nick.get(g.homeTeamId) ?? g.homeTeamId
      const away = nick.get(g.awayTeamId) ?? g.awayTeamId
      if (pool.spreadMode !== 'ats') return `${away} at ${home}`
      if (r.spread == null) return `${away} at ${home} — OFF THE BOARD`
      if (r.spread === 0) return `${away} at ${home} (pick 'em)`
      // spread is home-perspective: negative = home favoured.
      return r.spread < 0
        ? `${home} vs ${away} +${Math.abs(r.spread)}`
        : `${away} at ${home} +${r.spread}`
    }
    const linesList = included
      .slice()
      .sort((a, b) => {
        const ka = gameById.get(a.gameId)?.kickoffAt.getTime() ?? 0
        const kb = gameById.get(b.gameId)?.kickoffAt.getTime() ?? 0
        return ka - kb
      })
      .map(lineText)
      .filter(Boolean)

    const activeEntries = await db
      .select({ userId: nflPoolEntries.userId })
      .from(nflPoolEntries)
      .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.status, 'active')))
    const owners = activeEntries.length
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, [...new Set(activeEntries.map((e) => e.userId))]))
      : []

    const note = (message ?? '').trim()
    const subject = republish
      ? `${week.label} lines updated`
      : `${week.label} lines are out — picks are open`
    const appUrl = process.env.VITE_APP_URL || 'https://nfl.mnsfantasy.com'
    const deadlineEt = `${deadline.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })} ET`
    const textBody = [
      note,
      note ? '' : null,
      `${week.label} lines:`,
      ...linesList.map((l) => `  ${l}`),
      '',
      `Picks close ${deadlineEt}.`,
      `Make your picks: ${appUrl}/pool/${pool.id}/picks`,
    ]
      .filter((x): x is string => x != null)
      .join('\n')

    const kickEt = (d: Date) =>
      d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    const sortedIncluded = included
      .slice()
      .sort(
        (a, b) =>
          (gameById.get(a.gameId)?.kickoffAt.getTime() ?? 0) -
          (gameById.get(b.gameId)?.kickoffAt.getTime() ?? 0)
      )
    const lineRows = sortedIncluded
      .map((r, i) => {
        const g = gameById.get(r.gameId)
        if (!g) return ''
        const home = nick.get(g.homeTeamId) ?? g.homeTeamId
        const away = nick.get(g.awayTeamId) ?? g.awayTeamId
        return emailRow({
          title: `${esc(away)} at ${esc(home)}`,
          sub: kickEt(g.kickoffAt),
          value: pool.spreadMode === 'ats' ? (r.spread == null ? 'OFF' : fmtSpread(r.spread)) : undefined,
          caption:
            pool.spreadMode === 'ats' ? (r.spread == null ? 'the board' : home) : undefined,
          last: i === sortedIncluded.length - 1,
        })
      })
      .join('')
    const htmlBody = emailShell({
      preheader: `${week.label} lines — picks close ${deadlineEt}.`,
      heading: republish ? `${esc(week.label)} lines updated` : `${esc(week.label)} lines are out`,
      subheading: esc(pool.name),
      bodyHtml:
        (note ? emailNote(esc(note).replace(/\n/g, '<br />')) : '') +
        emailSection('The lines') +
        emailCard(lineRows) +
        emailNote(
          `${pool.spreadMode === 'ats' ? `The number is the <b style="color:#f0f4f8">home team's</b> line. ` : ''}Picks close <b style="color:#f0f4f8">${esc(deadlineEt)}</b> — early games lock at kickoff.`
        ),
      ctaLabel: 'Make your picks',
      ctaUrl: `${appUrl}/pool/${pool.id}/picks`,
      footerLine: `You're in ${esc(pool.name)} on nfl.mnsfantasy.com.`,
    })

    const messages: Message[] = owners
      .filter((o) => !!o.email)
      .map((o) => ({
        to: o.email,
        subject: `[${pool.name}] ${subject}`,
        html: htmlBody,
        text: textBody,
      }))
    const sent = await sendAll(messages)

    await db.insert(nflPoolAnnouncements).values({
      poolId: pool.id,
      weekId: week.id,
      subject,
      bodyMarkdown: note || `(lines only)`,
      includedLines: true,
      sentBy: ctx.userId,
      recipientCount: sent.sent,
      failedCount: sent.failed.length,
    })

    return res
      .status(200)
      .json({ ok: true, pickDeadlineAt: deadline, emailed: sent.sent, emailFailed: sent.failed.length })
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

  // Post-publish line changes, keyed by game, oldest first — shown to
  // the admin here and to members on the picks page.
  const events = rows.length
    ? await db
        .select()
        .from(nflPoolGameLineEvents)
        .where(inArray(nflPoolGameLineEvents.poolGameId, rows.map((r) => r.id)))
        .orderBy(asc(nflPoolGameLineEvents.changedAt))
    : []
  const poolGameToGame = new Map(rows.map((r) => [r.id, r.gameId]))
  const eventsByGame = new Map<string, typeof events>()
  for (const e of events) {
    const gameId = poolGameToGame.get(e.poolGameId)
    if (!gameId) continue
    const list = eventsByGame.get(gameId) ?? []
    list.push(e)
    eventsByGame.set(gameId, list)
  }

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
      // Published lines stay editable until their game kicks off; every
      // change is logged in lineEvents. Only kickoff settles a line.
      locked:
        ensuredPoolWeek.linesPublishedAt != null &&
        !isTbdKickoff(g.kickoffAt) &&
        now >= g.kickoffAt,
      lineEvents: (eventsByGame.get(g.id) ?? []).map((e) => ({
        prevSpread: e.prevSpread,
        spread: e.spread,
        changedAt: e.changedAt,
      })),
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
