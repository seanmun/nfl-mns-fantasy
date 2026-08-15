import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { db } from '../_db.js'
import { verifyCron } from '../_middleware.js'
import { nflPoolWeeks, nflPools } from '../../src/lib/db/schema.js'
import { currentWeek, syncWeek } from '../../src/lib/sync/schedule.js'
import { autofillPoolWeek, duePoolWeeks } from '../../src/lib/scoring/autofill.js'
import { gradePoolWeek } from '../../src/lib/scoring/rollup.js'
import { dueForReminder, sendReminders } from '../../src/lib/email/reminders.js'
import type { SeasonTypeKey } from '../_espn.js'

// The hourly heartbeat. One ESPN call, then everything that follows from
// what it returned.
//
// Order matters. Deadlines are processed BEFORE grading so that a member
// who was auto-filled this hour is graded in the same pass rather than
// waiting another hour to see their week appear.
//
// The deadline itself is enforced on write, not here — a late tick can
// never let someone sneak a pick in, it only delays the fill. That is
// what makes hourly adequate precision for an exact cutoff.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const season = Number(process.env.NFL_SEASON) || new Date().getUTCFullYear()
  const appUrl = process.env.VITE_APP_URL || 'https://nfl.mnsfantasy.com'
  const started = Date.now()

  try {
    const week = await currentWeek(db, season)
    if (!week) {
      return res.status(200).json({ ok: true, note: 'No weeks seeded yet', season })
    }

    // Refreshes scores AND kickoff times — flexed games move deadlines,
    // so this is not only a scoring concern.
    const sync = await syncWeek(db, season, week.seasonType as SeasonTypeKey, week.week)

    const now = new Date()

    // Nudge first. A member who acts on the email still has until the
    // deadline, so reminders must go out on ticks BEFORE the fill runs —
    // and the two never overlap, since a pool-week is either still ahead
    // of its deadline or past it.
    const reminderDue = await dueForReminder(db, now)
    const reminded = []
    for (const { poolWeek } of reminderDue) {
      reminded.push(await sendReminders(db, poolWeek.id, appUrl))
    }

    const due = await duePoolWeeks(db, now)
    const filled = []
    for (const pw of due) {
      filled.push(await autofillPoolWeek(db, pw.id))
    }

    // Grade every active pool for this week. Cheap and idempotent — it
    // recomputes from game results rather than incrementing, so a pool
    // with nothing new simply lands on the same numbers.
    const activePools = await db
      .select({ id: nflPools.id })
      .from(nflPools)
      .where(eq(nflPools.status, 'active'))

    const graded = []
    for (const pool of activePools) {
      const [pw] = await db
        .select()
        .from(nflPoolWeeks)
        .where(eq(nflPoolWeeks.poolId, pool.id))
        .limit(1)
      if (!pw) continue
      graded.push(await gradePoolWeek(db, pool.id, week.id))
    }

    const problems = graded.flatMap((g) => g.problems)
    const shortfalls = filled.flatMap((f) => f.shortfalls)
    const emailFailures = reminded.flatMap((r) => r.failed)
    if (emailFailures.length) console.error('tick: reminder sends failed', emailFailures)
    if (problems.length) console.error('tick: ungraded picks', problems)
    if (shortfalls.length) console.error('tick: autofill shortfalls', shortfalls)
    if (sync.unknownTeams.length) console.error('tick: unknown teams', sync.unknownTeams)
    if (sync.kickoffsChanged.length) console.warn('tick: kickoffs moved', sync.kickoffsChanged)

    return res.status(200).json({
      ok: true,
      season,
      week: week.label,
      sync,
      remindersSent: reminded.reduce((n, r) => n + r.sent, 0),
      emailFailures,
      autofilled: filled.length,
      picksAssigned: filled.reduce((n, f) => n + f.picksAssigned, 0),
      poolsGraded: graded.length,
      picksGraded: graded.reduce((n, g) => n + g.picksGraded, 0),
      problems,
      shortfalls,
      ms: Date.now() - started,
    })
  } catch (error) {
    console.error('tick failed:', error)
    return res.status(500).json({ error: 'Tick failed', detail: String(error) })
  }
}
