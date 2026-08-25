import { and, eq, isNull, isNotNull, gt } from 'drizzle-orm'
import type { Db } from '../db/types.js'
import {
  nflPoolEntries,
  nflPoolWeeks,
  nflPools,
  nflPicks,
  nflWeeks,
  users,
} from '../db/schema.js'
import type { PickNScoring } from '../scoring/config.js'
import { esc, sendAll, type Message } from '../../../api/_email.js'

export interface ReminderResult {
  poolId: string
  weekId: string
  sent: number
  failed: Array<{ to: string; error: string }>
  skippedOptedOut: number
}

// Pool-weeks inside their reminder window: published, deadline still
// ahead, nudge not yet sent.
//
// The window opens at (deadline - reminderHoursBefore) and closes at the
// deadline. A pool that was published late — after its own window has
// already opened — still gets one reminder on the next tick, which is
// the right behaviour: better a short-notice nudge than none.
export async function dueForReminder(db: Db, now: Date) {
  const rows = await db
    .select({ poolWeek: nflPoolWeeks, pool: nflPools })
    .from(nflPoolWeeks)
    .innerJoin(nflPools, eq(nflPools.id, nflPoolWeeks.poolId))
    .where(
      and(
        isNotNull(nflPoolWeeks.linesPublishedAt),
        isNotNull(nflPoolWeeks.pickDeadlineAt),
        isNull(nflPoolWeeks.remindersSentAt),
        gt(nflPoolWeeks.pickDeadlineAt, now),
        isNotNull(nflPools.reminderHoursBefore)
      )
    )

  return rows.filter(({ poolWeek, pool }) => {
    const deadline = poolWeek.pickDeadlineAt!.getTime()
    const opensAt = deadline - (pool.reminderHoursBefore ?? 0) * 3_600_000
    return now.getTime() >= opensAt
  })
}

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function deadlineLabel(d: Date): string {
  return `${ET.format(d)} ET`
}

// Deliberately plain: one sentence of status, the deadline, one button.
// The audience is older and largely non-technical, so the body is 18px,
// the button is a full-width block, and there is nothing else to read or
// decide. Inline styles because email clients discard <style> blocks.
function buildMessage(opts: {
  to: string
  entryName: string
  poolName: string
  weekLabel: string
  have: number
  need: number
  deadline: Date
  url: string
}): Message {
  const { entryName, poolName, weekLabel, have, need, deadline, url } = opts
  const when = deadlineLabel(deadline)
  const status = `You have ${have} of ${need} picks in for ${weekLabel}.`
  const consequence =
    have === 0
      ? 'If you do not pick, teams will be chosen for you at random.'
      : `Your remaining ${need - have} ${need - have === 1 ? 'pick' : 'picks'} will be chosen at random if you do not make them.`

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:18px;line-height:1.6;color:#111;max-width:560px;margin:0 auto;padding:24px">
  <p style="font-size:22px;font-weight:700;margin:0 0 16px">${esc(poolName)}</p>
  <p style="margin:0 0 12px">${esc(status)}</p>
  <p style="margin:0 0 12px">Picks close <strong>${esc(when)}</strong>.</p>
  <p style="margin:0 0 24px">${esc(consequence)}</p>
  <a href="${esc(url)}" style="display:block;text-align:center;background:#0a0a0f;color:#00ff87;font-size:20px;font-weight:700;text-decoration:none;padding:18px 24px;border-radius:8px">Make my picks</a>
  <p style="font-size:15px;color:#555;margin:24px 0 0">Sent to ${esc(entryName)}. You can turn these reminders off on your pool page.</p>
</div>`.trim()

  const text = [
    poolName,
    '',
    status,
    `Picks close ${when}.`,
    consequence,
    '',
    `Make your picks: ${url}`,
    '',
    `Sent to ${entryName}. You can turn these reminders off on your pool page.`,
  ].join('\n')

  return { to: opts.to, subject: `${poolName}: ${status}`, html, text }
}

// One nudge per pool-week, to entries still short of their picks.
export async function sendReminders(
  db: Db,
  poolWeekId: string,
  appUrl: string
): Promise<ReminderResult> {
  const [poolWeek] = await db
    .select()
    .from(nflPoolWeeks)
    .where(eq(nflPoolWeeks.id, poolWeekId))
    .limit(1)
  if (!poolWeek) throw new Error(`No such pool week: ${poolWeekId}`)

  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolWeek.poolId)).limit(1)
  const [week] = await db.select().from(nflWeeks).where(eq(nflWeeks.id, poolWeek.weekId)).limit(1)
  if (!pool || !week) throw new Error('Pool or week missing')

  const config = pool.scoringConfig as unknown as PickNScoring
  const need = pool.picksRequired ?? config.picksRequired ?? 0

  const result: ReminderResult = {
    poolId: pool.id,
    weekId: week.id,
    sent: 0,
    failed: [],
    skippedOptedOut: 0,
  }

  // No required count means nothing to be short of.
  if (!need) {
    await stamp(db, poolWeekId)
    return result
  }

  // ACTIVE entries only — benched and banned members get no nudges.
  const entries = await db
    .select({ entry: nflPoolEntries, email: users.email })
    .from(nflPoolEntries)
    .innerJoin(users, eq(users.id, nflPoolEntries.userId))
    .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.status, 'active')))

  const messages: Message[] = []

  for (const { entry, email } of entries) {
    if (entry.isEliminated) continue
    if (!entry.emailReminders) {
      result.skippedOptedOut++
      continue
    }
    if (!email) continue

    const made = await db
      .select({ id: nflPicks.id })
      .from(nflPicks)
      .where(and(eq(nflPicks.entryId, entry.id), eq(nflPicks.weekId, week.id)))

    if (made.length >= need) continue

    messages.push(
      buildMessage({
        to: email,
        entryName: entry.entryName,
        poolName: pool.name,
        weekLabel: week.label,
        have: made.length,
        need,
        deadline: poolWeek.pickDeadlineAt!,
        // Simple Mode entries get their one-tap link — the whole point
        // is never making them find the app.
        url:
          entry.simpleMode && entry.simpleToken
            ? `${appUrl}/simple/${entry.simpleToken}`
            : `${appUrl}/pool/${pool.id}/picks`,
      })
    )
  }

  if (messages.length > 0) {
    const sendResult = await sendAll(messages)
    result.sent = sendResult.sent
    result.failed = sendResult.failed
  }

  // Stamped whether or not anything sent. A pool where everyone had
  // already picked is done for the week — leaving it unstamped would
  // re-scan it every hour until the deadline.
  await stamp(db, poolWeekId)
  return result
}

async function stamp(db: Db, poolWeekId: string): Promise<void> {
  await db
    .update(nflPoolWeeks)
    .set({ remindersSentAt: new Date(), updatedAt: new Date() })
    .where(eq(nflPoolWeeks.id, poolWeekId))
}
