import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../_db.js'
import { verifyCron } from '../_middleware.js'
import { nflGames, nflPoolGames, nflPools, nflPoolWeeks, nflWeeks } from '../../src/lib/db/schema.js'
import {
  currentWeek,
  syncTestWeeks,
  syncWeek,
  weeksNeedingSync,
  type SyncWeekResult,
} from '../../src/lib/sync/schedule.js'
import { autofillPoolWeek, duePoolWeeks } from '../../src/lib/scoring/autofill.js'
import { gradePoolWeek } from '../../src/lib/scoring/rollup.js'
import { dueForReminder, sendReminders } from '../../src/lib/email/reminders.js'
import { dueForResults, markResultsSkipped, sendResultsEmails } from '../../src/lib/email/results.js'
import type { SeasonTypeKey } from '../_espn.js'

// The hourly heartbeat. One scoreboard call per week that still needs
// one, then everything that follows from what came back.
//
// Which weeks need one is decided by GAME STATE, never by the calendar:
// every week holding a game that has kicked off and is not yet final or
// cancelled, plus the current week so kickoff moves are seen. Through
// Weeks 1-2 of 2026 this fetched only currentWeek(), which rolls forward
// the moment a week's last game kicks off — so the Monday night game was
// last fetched before it started, never reached 'final', and every pick
// on it stayed 'pending'. See POSTMORTEM-2026-09-24-monday-night-scores.md.
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

    const now = new Date()

    // Every week with an undecided game that has kicked off, plus the
    // current week (kickoff times move — flexed games move deadlines).
    // Normally one call; two from Monday night until that final lands.
    // Each week is fetched on its own so one bad response cannot stop
    // the others, or the grading below, from running this hour.
    const backlog = await weeksNeedingSync(db, season, now)
    const targets = new Map(backlog.weeks.map((w) => [w.id, w]))
    targets.set(week.id, week)

    const synced: Array<SyncWeekResult & { week: string }> = []
    const syncFailures: Array<{ week: string; error: string }> = []
    for (const w of targets.values()) {
      try {
        const r = await syncWeek(db, season, w.seasonType as SeasonTypeKey, w.week)
        synced.push({ week: w.label, ...r })
      } catch (err) {
        syncFailures.push({ week: w.label, error: String(err) })
      }
    }

    // What is STILL undecided after this pass. A game not settled six
    // hours after kickoff has outlived any NFL game plus a weather delay,
    // and the grader skips undecided games without comment — that
    // silence is how the Monday night gap went unseen for ten days.
    const STALE_MS = 6 * 60 * 60 * 1000
    const remaining = await weeksNeedingSync(db, season, now)
    const staleGames = remaining.games
      .filter((g) => now.getTime() - g.kickoffAt.getTime() > STALE_MS)
      .map((g) => `${g.label} ${g.awayTeamId}@${g.homeTeamId} ${g.status} kickoff ${g.kickoffAt.toISOString()}`)

    // QA weeks ride the same heartbeat. Free when none are pending.
    const testSynced = await syncTestWeeks(db, season)

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

    // Grade every PUBLISHED pool-week, each pool against its OWN weeks.
    // Cheap and idempotent — it recomputes from game results rather than
    // incrementing, so a week with nothing new lands on the same numbers.
    //
    // Two deliberate non-filters. Not pools.status: nothing maintains it
    // (every pool sits at 'open'), so filtering on 'active' graded
    // nothing, ever. Not the global current week: a pool's weeks are its
    // own — a QA pool on 'test' weeks never matches the league calendar,
    // and grading it against the regular-season week id graded nothing
    // too. Publish state is the real signal: published means members
    // could pick, so it is gradable; unpublished has nothing to grade.
    const publishedWeeks = await db
      .select({ poolId: nflPoolWeeks.poolId, weekId: nflPoolWeeks.weekId })
      .from(nflPoolWeeks)
      .where(isNotNull(nflPoolWeeks.linesPublishedAt))

    const graded = []
    for (const pw of publishedWeeks) {
      graded.push(await gradePoolWeek(db, pw.poolId, pw.weekId))
    }

    // ── Week results email ──────────────────────────────────────
    // After grading, so a week decided this hour goes out with its
    // final numbers. dueForResults enforces the morning-after window in
    // Eastern time and the results_email_sent_at stamp makes it
    // once-per-week. A week whose window has passed — decided late for
    // any reason, like the two weeks the 2026-09-24 sync fix caught up
    // on — is stamped and NEVER mailed. No late results email, ever.
    const results = await dueForResults(db, now)
    const resultsSent = []
    for (const r of results.due) {
      resultsSent.push(await sendResultsEmails(db, r.poolWeek.id, appUrl))
    }
    const resultsExpired: string[] = []
    for (const e of results.expired) {
      await markResultsSkipped(db, e.poolWeek.id)
      resultsExpired.push(`${e.pool.name} ${e.week}`)
    }

    // ── Archive finished pools ──────────────────────────────────
    // A pool whose LAST week is fully decided flips to 'completed':
    // it drops into the archive section of My Pools and stops counting
    // toward "which pool do I auto-open". Idempotent — already-completed
    // pools are skipped.
    const openPools = await db.select().from(nflPools).where(eq(nflPools.status, 'open'))
    let archived = 0
    for (const p of openPools) {
      const [lastWk] = await db
        .select({ id: nflWeeks.id })
        .from(nflWeeks)
        .where(
          and(
            eq(nflWeeks.season, p.season),
            eq(nflWeeks.seasonType, p.seasonType),
            eq(nflWeeks.week, p.endWeek)
          )
        )
        .limit(1)
      if (!lastWk) continue
      const slate = await db
        .select({ status: nflGames.status, isIncluded: nflPoolGames.isIncluded })
        .from(nflPoolGames)
        .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
        .where(and(eq(nflPoolGames.poolId, p.id), eq(nflPoolGames.weekId, lastWk.id)))
      const included = slate.filter((g) => g.isIncluded)
      let doneNow =
        included.length > 0 &&
        included.every((g) => g.status === 'final' || g.status === 'cancelled')
      // Fallback: a pool that will never reach its configured end week
      // (sim pools, abandoned seasons) still archives once every game
      // it EVER put in play is decided and its whole week range is in
      // the past. A mid-season pool never trips this — its later weeks'
      // kickoffs are still ahead.
      if (!doneNow) {
        const allSlate = await db
          .select({ status: nflGames.status, isIncluded: nflPoolGames.isIncluded })
          .from(nflPoolGames)
          .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
          .where(eq(nflPoolGames.poolId, p.id))
        const everIncluded = allSlate.filter((g) => g.isIncluded)
        const rangeWeeks = await db
          .select({ last: nflWeeks.lastKickoffAt })
          .from(nflWeeks)
          .where(and(eq(nflWeeks.season, p.season), eq(nflWeeks.seasonType, p.seasonType)))
        const rangeOver = rangeWeeks.every((w) => !w.last || w.last < now)
        doneNow =
          rangeOver &&
          everIncluded.length > 0 &&
          everIncluded.every((g) => g.status === 'final' || g.status === 'cancelled')
      }
      if (doneNow) {
        await db.update(nflPools).set({ status: 'completed' }).where(eq(nflPools.id, p.id))
        archived++
      }
    }

    const problems = graded.flatMap((g) => g.problems)
    const shortfalls = filled.flatMap((f) => f.shortfalls)
    const emailFailures = reminded.flatMap((r) => r.failed)
    if (emailFailures.length) console.error('tick: reminder sends failed', emailFailures)
    if (problems.length) console.error('tick: ungraded picks', problems)
    if (shortfalls.length) console.error('tick: autofill shortfalls', shortfalls)
    const unknownTeams = synced.flatMap((s) => s.unknownTeams)
    const kickoffsChanged = synced.flatMap((s) => s.kickoffsChanged)
    if (syncFailures.length) console.error('tick: week sync failed', syncFailures)
    if (staleGames.length) console.error('tick: games undecided long after kickoff', staleGames)
    if (resultsExpired.length) console.warn('tick: results emails skipped, window passed', resultsExpired)
    if (unknownTeams.length) console.error('tick: unknown teams', unknownTeams)
    if (kickoffsChanged.length) console.warn('tick: kickoffs moved', kickoffsChanged)

    return res.status(200).json({
      ok: true,
      season,
      week: week.label,
      synced,
      syncFailures,
      staleGames,
      testSynced,
      remindersSent: reminded.reduce((n, r) => n + r.sent, 0),
      resultsEmailsSent: resultsSent.reduce((n, r) => n + r.sent, 0),
      resultsEmailFailures: resultsSent.flatMap((r) => r.failed),
      resultsExpired,
      emailFailures,
      autofilled: filled.length,
      picksAssigned: filled.reduce((n, f) => n + f.picksAssigned, 0),
      poolsGraded: graded.length,
      archived,
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
