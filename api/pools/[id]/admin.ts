import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../_db.js'
import { applyCors, loadCtx, requirePoolAdmin } from '../../_pool.js'
import { esc, sendAll, type Message } from '../../_email.js'
import { sendReminders } from '../../../src/lib/email/reminders.js'
import { currentWeek } from '../../../src/lib/sync/schedule.js'
import {
  nflGames,
  nflPicks,
  nflPoolAnnouncements,
  nflPoolEntries,
  nflPoolGames,
  nflPoolWeeks,
  users,
} from '../../../src/lib/db/schema.js'
import type { PickNScoring } from '../../../src/lib/scoring/config.js'

// The admin's surface for one pool. Summary-first by design: a pool can
// hold 180 entries, so everything here is a count with the detail behind
// it, never a wall of rows.
//
// GET  /api/pools/:id/admin                    — pulse detail for the card
// POST /api/pools/:id/admin {action:'remind'}  — nudge the short entries now
// POST /api/pools/:id/admin {action:'announce', subject, body}
//                                              — email every member, logged
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const poolId = String(req.query.id ?? '')
  const ctx = await loadCtx(req, res, poolId)
  if (!ctx) return
  if (!requirePoolAdmin(ctx, res)) return

  const { pool } = ctx
  const config = pool.scoringConfig as unknown as PickNScoring

  const week = await currentWeek(db, pool.season, pool.seasonType)
  if (!week) return res.status(404).json({ error: 'No weeks exist for this pool.' })

  const [poolWeek] = await db
    .select()
    .from(nflPoolWeeks)
    .where(and(eq(nflPoolWeeks.poolId, pool.id), eq(nflPoolWeeks.weekId, week.id)))
    .limit(1)

  const entries = await db
    .select()
    .from(nflPoolEntries)
    .where(eq(nflPoolEntries.poolId, pool.id))
  const owners = entries.length
    ? await db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...new Set(entries.map((e) => e.userId))]))
    : []
  const ownerById = new Map(owners.map((o) => [o.id, o]))

  // ── Send the pre-deadline nudge now ─────────────────────────────
  if (req.method === 'POST' && req.body?.action === 'remind') {
    if (!poolWeek?.linesPublishedAt) {
      return res.status(400).json({ error: 'This week is not published yet.' })
    }
    if (poolWeek.pickDeadlineAt && new Date() >= poolWeek.pickDeadlineAt) {
      return res.status(400).json({ error: 'The deadline has passed — nothing to nudge.' })
    }
    const appUrl = process.env.VITE_APP_URL || 'https://nfl.mnsfantasy.com'
    const result = await sendReminders(db, poolWeek.id, appUrl)
    return res.status(200).json({ ok: true, sent: result.sent, failed: result.failed })
  }

  // ── Announce: one email to every member, logged forever ─────────
  if (req.method === 'POST' && req.body?.action === 'announce') {
    const subject = String(req.body?.subject ?? '').trim()
    const body = String(req.body?.body ?? '').trim()
    if (!subject) return res.status(400).json({ error: 'Give the message a subject.' })
    if (!body) return res.status(400).json({ error: 'Write the message first.' })

    // One email per PERSON, not per entry — someone holding three
    // entries gets one copy.
    const recipients = [...new Set(entries.map((e) => e.userId))]
      .map((id) => ownerById.get(id))
      .filter((o): o is NonNullable<typeof o> => !!o && !!o.email)

    const html = `<p>${esc(body).replace(/\n/g, '<br />')}</p>
<p style="color:#888;font-size:12px">From the manager of ${esc(pool.name)} on MNS Fantasy NFL.</p>`
    const messages: Message[] = recipients.map((r) => ({
      to: r.email,
      subject: `[${pool.name}] ${subject}`,
      html,
      text: `${body}\n\n— the manager of ${pool.name} on MNS Fantasy NFL`,
    }))
    const result = await sendAll(messages)

    await db.insert(nflPoolAnnouncements).values({
      poolId: pool.id,
      weekId: week.id,
      subject,
      bodyMarkdown: body,
      sentBy: ctx.userId,
      recipientCount: result.sent,
      failedCount: result.failed.length,
    })

    return res
      .status(200)
      .json({ ok: true, sent: result.sent, failed: result.failed.length })
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // ── The pulse detail ────────────────────────────────────────────
  const need =
    pool.poolType === 'survivor' ? 1 : pool.picksRequired ?? config.picksRequired ?? null

  const slate = await db
    .select({
      gameId: nflPoolGames.gameId,
      isIncluded: nflPoolGames.isIncluded,
      spread: nflPoolGames.spread,
      status: nflGames.status,
    })
    .from(nflPoolGames)
    .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
    .where(and(eq(nflPoolGames.poolId, pool.id), eq(nflPoolGames.weekId, week.id)))
  const included = slate.filter((g) => g.isIncluded)
  const needCount = need ?? included.length

  const weekPicks = entries.length
    ? await db
        .select({
          entryId: nflPicks.entryId,
          gameId: nflPicks.gameId,
          result: nflPicks.result,
        })
        .from(nflPicks)
        .where(
          and(
            inArray(nflPicks.entryId, entries.map((e) => e.id)),
            eq(nflPicks.weekId, week.id)
          )
        )
    : []
  const perEntry = new Map<string, number>()
  for (const p of weekPicks) perEntry.set(p.entryId, (perEntry.get(p.entryId) ?? 0) + 1)

  // Names and emails, admin-only, for the members still short. This is
  // the contact list for the nudge, never anyone's picks.
  const short = entries
    .filter((e) => (perEntry.get(e.id) ?? 0) < needCount)
    .map((e) => ({
      entryName: e.entryName,
      picksIn: perEntry.get(e.id) ?? 0,
      ownerName: ownerById.get(e.userId)?.displayName ?? null,
      ownerEmail: ownerById.get(e.userId)?.email ?? null,
    }))
    .sort((a, b) => a.picksIn - b.picksIn || a.entryName.localeCompare(b.entryName))

  const finalGameIds = new Set(
    included.filter((g) => g.status === 'final').map((g) => g.gameId)
  )
  const gradingPending = weekPicks.filter(
    (p) => finalGameIds.has(p.gameId) && p.result === 'pending'
  ).length

  const recent = await db
    .select({
      subject: nflPoolAnnouncements.subject,
      sentAt: nflPoolAnnouncements.sentAt,
      recipientCount: nflPoolAnnouncements.recipientCount,
      failedCount: nflPoolAnnouncements.failedCount,
    })
    .from(nflPoolAnnouncements)
    .where(eq(nflPoolAnnouncements.poolId, pool.id))
    .orderBy(desc(nflPoolAnnouncements.sentAt))
    .limit(3)

  return res.status(200).json({
    week: { label: week.label },
    published: poolWeek?.linesPublishedAt ?? null,
    deadline: poolWeek?.pickDeadlineAt ?? null,
    readiness: {
      gamesIncluded: included.length,
      spreadsMissing:
        pool.spreadMode === 'ats' ? included.filter((g) => g.spread == null).length : 0,
    },
    memberCount: new Set(entries.map((e) => e.userId)).size,
    entriesTotal: entries.length,
    short,
    gradingPending,
    joinCode: pool.joinCode,
    recentAnnouncements: recent,
  })
}
