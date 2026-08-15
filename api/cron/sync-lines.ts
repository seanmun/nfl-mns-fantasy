import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../_db.js'
import { verifyCron } from '../_middleware.js'
import { currentWeek, syncCalendar, syncWeek } from '../../src/lib/sync/schedule.js'
import { pruneSnapshots, snapshotEspnLines, syncLines } from '../../src/lib/sync/lines.js'
import type { SeasonTypeKey } from '../_espn.js'

// The weekly lines pull. Tuesday morning, one Odds API request, three
// credits — and the ONLY thing in this app that spends them.
//
// It writes reference lines into game_lines. It does NOT publish
// anything: each pool's admin still picks his slate, sets his own numbers
// and publishes his own week. See pool_games / pool_weeks.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const season = Number(process.env.NFL_SEASON) || new Date().getUTCFullYear()

  try {
    // Cheap, and it keeps the week structure right when the postseason
    // calendar firms up mid-season.
    await syncCalendar(db, season)

    const week = await currentWeek(db, season)
    if (!week) return res.status(200).json({ ok: true, note: 'No weeks seeded yet' })

    const seasonType = week.seasonType as SeasonTypeKey

    // Fixtures first — a line cannot be attached to a game we have not
    // stored yet, and this is the pull that runs before a new week opens.
    await syncWeek(db, season, seasonType, week.week)

    const lines = await syncLines(db, season, seasonType, week.week)
    const espnSnapshots = await snapshotEspnLines(db, season, seasonType, week.week)

    // Six weeks is well past any dispute window and keeps the audit table
    // from growing without bound.
    const cutoff = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000)
    await pruneSnapshots(db, cutoff)

    // Both of these mean an ATS pool could reach grading with no number,
    // which is unrecoverable after the fact. Loud on purpose.
    if (lines.unmatchedEvents.length) {
      console.error('sync-lines: Odds API teams did not match', lines.unmatchedEvents)
    }
    if (lines.gamesWithoutLines.length) {
      console.error('sync-lines: games with no line', lines.gamesWithoutLines)
    }
    if (lines.creditsRemaining != null && lines.creditsRemaining < 50) {
      console.error('sync-lines: Odds API credits running low', lines.creditsRemaining)
    }

    return res.status(200).json({ ok: true, season, week: week.label, lines, espnSnapshots })
  } catch (error) {
    console.error('sync-lines failed:', error)
    return res.status(500).json({ error: 'Sync failed', detail: String(error) })
  }
}
