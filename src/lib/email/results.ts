import { and, eq, inArray, isNull, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/types.js'
import {
  nflEntryWeeks,
  nflGames,
  nflPicks,
  nflPoolEntries,
  nflPoolGames,
  nflPoolWeeks,
  nflPools,
  nflTeams,
  nflWeeks,
  users,
} from '../db/schema.js'
import { esc, sendAll, type Message } from '../../../api/_email.js'
import {
  emailCard,
  emailColors,
  emailRow,
  emailSection,
  emailShell,
  fmtSpread,
} from '../../../api/_emailTemplate.js'

export interface ResultsEmailResult {
  poolId: string
  weekId: string
  sent: number
  failed: Array<{ to: string; error: string }>
}

// "The morning after": the week's results go out on the first tick at or
// past 8am Eastern on a LATER Eastern calendar day than the last
// included kickoff. Sent once per pool-week (results_email_sent_at).
const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const ET_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  hour12: false,
})

// Pool-weeks whose results email should go out now: published, not yet
// sent, every included game decided, at least one pick graded, and the
// Eastern clock says it is morning-after.
export async function dueForResults(db: Db, now: Date) {
  const candidates = await db
    .select({ poolWeek: nflPoolWeeks, pool: nflPools })
    .from(nflPoolWeeks)
    .innerJoin(nflPools, eq(nflPools.id, nflPoolWeeks.poolId))
    .where(
      and(
        isNotNull(nflPoolWeeks.linesPublishedAt),
        isNull(nflPoolWeeks.resultsEmailSentAt),
        inArray(nflPools.status, ['open', 'completed'])
      )
    )
  if (candidates.length === 0) return []

  if (Number(ET_HOUR.format(now)) < 8) return []
  const today = ET_DAY.format(now)

  const due: typeof candidates = []
  for (const c of candidates) {
    const slate = await db
      .select({
        kickoffAt: nflGames.kickoffAt,
        status: nflGames.status,
      })
      .from(nflPoolGames)
      .innerJoin(nflGames, eq(nflGames.id, nflPoolGames.gameId))
      .where(
        and(
          eq(nflPoolGames.poolId, c.pool.id),
          eq(nflPoolGames.weekId, c.poolWeek.weekId),
          eq(nflPoolGames.isIncluded, true)
        )
      )
    if (slate.length === 0) continue
    const decided = slate.every((g) => g.status === 'final' || g.status === 'cancelled')
    if (!decided) continue
    const lastKick = new Date(Math.max(...slate.map((g) => g.kickoffAt.getTime())))
    if (ET_DAY.format(lastKick) >= today) continue

    // Grading actually ran — an ungraded week reads as everyone on zero.
    const [graded] = await db
      .select({ id: nflEntryWeeks.id })
      .from(nflEntryWeeks)
      .where(and(eq(nflEntryWeeks.weekId, c.poolWeek.weekId), isNotNull(nflEntryWeeks.gradedAt)))
      .limit(1)
    if (!graded) continue

    due.push(c)
  }
  return due
}

const RESULT_WORD: Record<string, { word: string; color: string }> = {
  win: { word: 'WON', color: emailColors.GREEN },
  loss: { word: 'LOST', color: emailColors.RED },
  push: { word: 'PUSH', color: emailColors.MUTED },
  missed: { word: 'MISSED', color: emailColors.MUTED },
  pending: { word: '—', color: emailColors.MUTED },
}

// One results email per PERSON: every entry they own in the pool, each
// pick with its outcome, then where the season stands.
export async function sendResultsEmails(
  db: Db,
  poolWeekId: string,
  appUrl: string
): Promise<ResultsEmailResult> {
  const [poolWeek] = await db
    .select()
    .from(nflPoolWeeks)
    .where(eq(nflPoolWeeks.id, poolWeekId))
    .limit(1)
  if (!poolWeek) throw new Error(`No such pool week: ${poolWeekId}`)
  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolWeek.poolId)).limit(1)
  const [week] = await db.select().from(nflWeeks).where(eq(nflWeeks.id, poolWeek.weekId)).limit(1)
  if (!pool || !week) throw new Error('Pool or week missing')

  const result: ResultsEmailResult = { poolId: pool.id, weekId: week.id, sent: 0, failed: [] }

  const entries = await db
    .select({ entry: nflPoolEntries, email: users.email })
    .from(nflPoolEntries)
    .innerJoin(users, eq(users.id, nflPoolEntries.userId))
    .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.status, 'active')))
  if (entries.length === 0) {
    await stamp(db, poolWeekId)
    return result
  }
  const entryIds = entries.map((e) => e.entry.id)

  const teams = await db.select().from(nflTeams)
  const nick = new Map(teams.map((t) => [t.id, t.nickname]))
  const games = await db.select().from(nflGames).where(eq(nflGames.weekId, week.id))
  const gameById = new Map(games.map((g) => [g.id, g]))

  const picks = await db
    .select()
    .from(nflPicks)
    .where(and(inArray(nflPicks.entryId, entryIds), eq(nflPicks.weekId, week.id)))
  const picksByEntry = new Map<string, typeof picks>()
  for (const p of picks) {
    const list = picksByEntry.get(p.entryId) ?? []
    list.push(p)
    picksByEntry.set(p.entryId, list)
  }

  const weekRows = await db
    .select()
    .from(nflEntryWeeks)
    .where(and(inArray(nflEntryWeeks.entryId, entryIds), eq(nflEntryWeeks.weekId, week.id)))
  const weekByEntry = new Map(weekRows.map((r) => [r.entryId, r]))

  // Season order for the standings card, straight off the graded rollup.
  const nameByEntry = new Map(entries.map((e) => [e.entry.id, e.entry.entryName]))
  const seasonRows = [...weekRows].sort(
    (a, b) => (a.cumulativeRank ?? 999) - (b.cumulativeRank ?? 999)
  )

  const ats = pool.spreadMode === 'ats'
  const messages: Message[] = []

  // Group entries by owner: one email per person.
  const byOwner = new Map<string, { email: string; entries: Array<(typeof entries)[number]['entry']> }>()
  for (const { entry, email } of entries) {
    if (!email) continue
    const g = byOwner.get(entry.userId) ?? { email, entries: [] }
    g.entries.push(entry)
    byOwner.set(entry.userId, g)
  }

  for (const owner of byOwner.values()) {
    let body = ''
    const textLines: string[] = [`${week.label} results — ${pool.name}`, '']

    for (const entry of owner.entries) {
      const ew = weekByEntry.get(entry.id)
      const mine = (picksByEntry.get(entry.id) ?? []).sort((a, b) => {
        const ka = gameById.get(a.gameId)?.kickoffAt.getTime() ?? 0
        const kb = gameById.get(b.gameId)?.kickoffAt.getTime() ?? 0
        return ka - kb
      })

      body += emailSection(entry.entryName)
      const rows: string[] = []
      for (const p of mine) {
        const g = gameById.get(p.gameId)
        const my = nick.get(p.selectedTeamId) ?? p.selectedTeamId
        const opp =
          g == null
            ? ''
            : p.selectedTeamId === g.homeTeamId
              ? `vs ${nick.get(g.awayTeamId) ?? ''}`
              : `at ${nick.get(g.homeTeamId) ?? ''}`
        const score = g && g.homeScore != null ? ` · ${g.awayScore}–${g.homeScore}` : ''
        const line = ats && p.lineSpreadAtPick != null && g
          ? ` · your line ${fmtSpread(p.selectedTeamId === g.homeTeamId ? p.lineSpreadAtPick : -p.lineSpreadAtPick)}`
          : ''
        const r = RESULT_WORD[p.result] ?? RESULT_WORD.pending
        rows.push(
          emailRow({
            title: `${esc(my)}${p.isKeyPick ? ` <span style="color:${emailColors.AMBER};">★</span>` : ''}${p.isAuto ? ` <span style="color:${emailColors.MUTED}; font-size:10px;">AUTO</span>` : ''}`,
            sub: `${esc(opp)}${esc(score)}${esc(line)}`,
            value: r.word,
            valueColor: r.color,
            caption: `${p.pointsEarned} pts`,
          })
        )
        textLines.push(`${entry.entryName}: ${my} ${r.word} (${p.pointsEarned} pts)`)
      }
      rows.push(
        emailRow({
          title: 'Week total',
          sub: ew ? `${ew.correctCount}-${ew.incorrectCount}-${ew.pushCount}` : '',
          value: `${ew?.points ?? 0}`,
          caption: ew?.weeklyRank ? `#${ew.weeklyRank} this week` : 'pts',
          last: true,
        })
      )
      body += emailCard(rows.join(''))
      textLines.push(
        `${entry.entryName} week total: ${ew?.points ?? 0} pts (${ew?.correctCount ?? 0}-${ew?.incorrectCount ?? 0}-${ew?.pushCount ?? 0})`,
        ''
      )
    }

    // Season standings: top 5 plus each of this owner's entries.
    const ownIds = new Set(owner.entries.map((e) => e.id))
    const top = seasonRows.slice(0, 5)
    const alsoMine = seasonRows.filter((r) => ownIds.has(r.entryId) && !top.includes(r))
    body += emailSection('Standings now')
    const standingRows = [...top, ...alsoMine]
    body += emailCard(
      standingRows
        .map((r, i) =>
          emailRow({
            title: `${esc(nameByEntry.get(r.entryId) ?? 'Entry')}${ownIds.has(r.entryId) ? ` <span style="color:${emailColors.GREEN}; font-size:10px;">YOU</span>` : ''}`,
            sub: `#${r.cumulativeRank ?? '—'}`,
            value: `${r.cumulativePoints ?? 0}`,
            caption: 'pts',
            last: i === standingRows.length - 1,
          })
        )
        .join('')
    )

    textLines.push(`Standings: ${appUrl}/pool/${pool.id}/standings`)

    messages.push({
      to: owner.email,
      subject: `[${pool.name}] ${week.label} results`,
      html: emailShell({
        preheader: `${week.label} is final — here is how you did.`,
        heading: `${esc(week.label)} results`,
        subheading: esc(pool.name),
        bodyHtml: body,
        ctaLabel: 'See the full standings',
        ctaUrl: `${appUrl}/pool/${pool.id}/standings`,
        footerLine: `You're in ${esc(pool.name)} on nfl.mnsfantasy.com.`,
      }),
      text: textLines.join('\n'),
    })
  }

  if (messages.length > 0) {
    const sendResult = await sendAll(messages)
    result.sent = sendResult.sent
    result.failed = sendResult.failed
  }

  // Stamped whether or not anything sent, same rule as the reminder.
  await stamp(db, poolWeekId)
  return result
}

async function stamp(db: Db, poolWeekId: string): Promise<void> {
  await db
    .update(nflPoolWeeks)
    .set({ resultsEmailSentAt: new Date(), updatedAt: new Date() })
    .where(eq(nflPoolWeeks.id, poolWeekId))
}
