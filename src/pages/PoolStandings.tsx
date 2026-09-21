import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { createApi, type ApiOtherPick, type StandingsRow } from '@/lib/api/client'
import { teamSpread } from '@/lib/utils'
import { PoolTabBar } from '@/components/layout/PoolTabBar'
import { ChevronDown, ChevronLeft, ChevronRight, Star, Trophy } from 'lucide-react'
import { Button, Chip, EmptyState, ListRow, PageHeader, Skeleton } from '@/ui/components'

// Re-rank the same rows by any metric — a sort is a VIEW; the pool's
// real rank is the points order the server sent. Competition ranking
// again: level entries share, the next skips.
function rankBy(
  rows: StandingsRow[],
  primary: (r: StandingsRow) => number,
  secondary: (r: StandingsRow) => number
): StandingsRow[] {
  const sorted = [...rows].sort(
    (a, b) => primary(b) - primary(a) || secondary(b) - secondary(a)
  )
  let rank = 0
  return sorted.map((row, i) => {
    const prev = sorted[i - 1]
    const tied = prev && primary(prev) === primary(row) && secondary(prev) === secondary(row)
    if (!tied) rank = i + 1
    return { ...row, rank }
  })
}

// One entry's picks for the week on screen: team, the number it took,
// and a star on the key pick. Nothing else — the row above already
// carries the score. Only picks the server revealed are here, so a live
// week fills in game by game.
function WeekPicks({
  entryId,
  picks,
  slate,
  spreadMode,
  loading,
  failed,
}: {
  entryId: string
  picks: ApiOtherPick[]
  slate: Array<{ gameId: string; kickoffAt: string; home: { id: string; nickname: string } | null; away: { id: string; nickname: string } | null; spread: number | null }>
  spreadMode: 'straight_up' | 'ats'
  loading: boolean
  failed: boolean
}) {
  const gameById = new Map(slate.map((g) => [g.gameId, g]))
  const mine = picks
    .filter((p) => p.entryId === entryId)
    .sort((a, b) =>
      (gameById.get(a.gameId)?.kickoffAt ?? '').localeCompare(gameById.get(b.gameId)?.kickoffAt ?? '')
    )

  if (loading) {
    return <p className="py-1 text-[0.9rem] text-[var(--color-muted-foreground)]">Loading picks…</p>
  }
  if (failed) {
    return <p className="py-1 text-[0.9rem] text-[var(--color-muted-foreground)]">Couldn’t load those picks.</p>
  }
  if (!mine.length) {
    return (
      <p className="py-1 text-[0.9rem] text-[var(--color-muted-foreground)]">
        Nothing to show yet — picks appear as each game kicks off.
      </p>
    )
  }

  return (
    <ul className="py-1 flex flex-col gap-1">
      {mine.map((p) => {
        const game = gameById.get(p.gameId)
        const isHome = p.selectedTeamId === game?.home?.id
        const team = isHome ? game?.home : game?.away
        const line =
          spreadMode === 'ats'
            ? teamSpread(p.lineSpreadAtPick ?? game?.spread ?? null, isHome ? 'home' : 'away')
            : null
        return (
          <li key={p.gameId} className="flex items-center gap-1.5 text-[0.95rem]">
            {p.isKeyPick ? (
              <Star
                size={14}
                fill="currentColor"
                aria-label="key pick"
                className="shrink-0 text-[var(--color-key)]"
              />
            ) : null}
            <b>{team?.nickname ?? p.selectedTeamId}</b>
            {line ? (
              <span className="font-mono text-[0.9rem] text-[var(--color-muted-foreground)]">
                {line}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

// The leaderboard. Total points ranks it, key-pick score breaks ties —
// the same two columns the comparator uses, in the same order, so what
// members see is exactly what decides.
export function PoolStandings() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])

  // Which VIEW of the same entries: 'points' (the pool's true order),
  // 'key', 'week' (one week at a time), or 'seg-N' (one prize segment).
  const [view, setView] = useState('points')
  // The week the week view shows; null follows the latest graded week.
  const [weekNo, setWeekNo] = useState<number | null>(null)
  // Which entry's picks are unfolded in the week view. One at a time.
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
    refetchInterval: 60_000,
  })


  // Weeks ANY row has graded points for, in order. Computed before the
  // early returns because the picks query below keys on the week on
  // screen, and hooks cannot sit behind a return.
  const gradedWeeks = [
    ...new Set(
      (data?.rows ?? []).flatMap((r) =>
        r.weekly.filter((w) => w.points != null).map((w) => w.week)
      )
    ),
  ].sort((a, b) => a - b)
  const lastWk = gradedWeeks.length ? gradedWeeks[gradedWeeks.length - 1] : null
  const weekOnScreen = weekNo != null && gradedWeeks.includes(weekNo) ? weekNo : lastWk

  // The week's picks, loaded only once someone unfolds a row — and read
  // from the picks endpoint, so the reveal rule (each game at its own
  // kickoff, the rest at the deadline) is enforced in ONE place rather
  // than re-decided here.
  const weekPicks = useQuery({
    queryKey: ['picks', poolId, weekOnScreen ?? undefined],
    queryFn: () => api.getPicks(poolId, weekOnScreen ?? undefined),
    enabled: view === 'week' && openEntry != null && weekOnScreen != null,
  })

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-2">
        <Skeleton h="2.2rem" w="55%" />
        <Skeleton h="3.4rem" />
        <Skeleton h="3.4rem" />
        <Skeleton h="3.4rem" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <EmptyState title="Something went wrong">
        {(error as Error)?.message ?? 'Could not load the standings.'}
      </EmptyState>
    )
  }

  const graded = gradedWeeks.length > 0
  const cellOf = (r: StandingsRow, week: number | null) => r.weekly.find((w) => w.week === week)
  const lwPoints = (r: StandingsRow) => cellOf(r, lastWk)?.points ?? 0

  // The week view: the week asked for, else the latest graded one.
  const shownWeek = weekNo != null && gradedWeeks.includes(weekNo) ? weekNo : lastWk
  const weekIdx = shownWeek == null ? -1 : gradedWeeks.indexOf(shownWeek)
  const weekPoints = (r: StandingsRow) => cellOf(r, shownWeek)?.points ?? 0

  // Segments come from the pool's own prize settings — never hardcoded.
  const segments = data.winners?.segments ?? []
  const seg = view.startsWith('seg-') ? segments[Number(view.slice(4))] ?? null : null
  const segCells = (r: StandingsRow) =>
    seg ? r.weekly.filter((w) => w.week >= seg.startWeek && w.week <= seg.endWeek) : []
  const segPoints = (r: StandingsRow) => segCells(r).reduce((n, w) => n + (w.points ?? 0), 0)

  // Week and segment views rank on points alone, ties sharing a place —
  // the same way the winners circle pays a segment.
  const rows =
    view === 'key'
      ? rankBy(data.rows, (r) => r.keyPickScore, (r) => r.totalPoints)
      : view === 'week'
        ? rankBy(data.rows, weekPoints, () => 0)
        : seg
          ? rankBy(data.rows, segPoints, () => 0)
          : data.rows
  const views: Array<[string, string]> = [
    ['points', 'Points'],
    ['key', 'Key'],
    ['week', 'By week'],
    ...segments.map((s, i): [string, string] => [`seg-${i}`, `Wks ${s.startWeek}–${s.endWeek}`]),
  ]
  const champions = data.final ? data.rows.filter((r) => r.rank === 1) : []

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 pb-28 flex flex-col gap-4">
      <PageHeader
        back={`/pool/${poolId}`}
        backLabel="Pool home"
        title={data.final ? 'Final standings' : 'Standings'}
        status="Most points wins. The key-pick total only breaks ties."
      />

      {data.final && champions.length ? (
        <div className="rounded-xl border-2 border-[var(--color-key)] bg-[var(--color-card)] p-5 text-center">
          <p className="flex justify-center text-[var(--color-key)]">
            <Trophy size={34} aria-hidden="true" />
          </p>
          <p className="mt-2 text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-key)]">
            {champions.length > 1 ? 'Champions' : 'Champion'}
          </p>
          <p className="text-[1.4rem] font-extrabold">
            {champions.map((c) => c.entryName).join(' & ')}
          </p>
          <p className="text-[var(--color-muted-foreground)] tabular-nums">
            {champions[0].totalPoints} points · key <Star size={16} fill="currentColor" aria-hidden="true" className="inline-block align-[-0.1em]" /> {champions[0].keyPickScore}
          </p>
        </div>
      ) : null}

      {graded ? (
        // View control — VIEWS of the same list, never a second page.
        // Points is the default and the pool's true ranking.
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Show standings by">
          {views.map(([key, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() => {
                setView(key)
                setOpenEntry(null)
              }}
              className={
                'min-h-[var(--tap-target-min)] px-1 rounded-lg border-2 font-bold ' +
                (view === key
                  ? 'bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]'
                  : 'border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]')
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {graded && view === 'week' && shownWeek != null ? (
        // Arrows with words, not a swipe — a button is findable.
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="quiet"
            disabled={weekIdx <= 0}
            onClick={() => {
              setWeekNo(gradedWeeks[weekIdx - 1])
              setOpenEntry(null)
            }}
          >
            <ChevronLeft size={20} aria-hidden="true" /> Prev
          </Button>
          <b className="text-[1.1rem] text-center">
            {data.weeks.find((w) => w.week === shownWeek)?.label ?? `Week ${shownWeek}`}
          </b>
          <Button
            variant="quiet"
            disabled={weekIdx >= gradedWeeks.length - 1}
            onClick={() => {
              setWeekNo(gradedWeeks[weekIdx + 1])
              setOpenEntry(null)
            }}
          >
            Next <ChevronRight size={20} aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {graded && seg ? (
        <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
          Points from weeks {seg.startWeek}–{seg.endWeek} only
          {seg.complete ? ' — final.' : ', so far.'} Ties share a place.
        </p>
      ) : null}

      {!graded ? (
        // Before anything grades, a table of everyone tied at #1 reads
        // as broken. Show the field, not a fake ranking.
        <section className="flex flex-col gap-2">
          <p className="text-[var(--color-muted-foreground)] leading-relaxed">
            Nothing to rank yet — the board fills in as games finish. Here&rsquo;s
            who&rsquo;s in:
          </p>
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.entryId}>
                <ListRow
                  mine={r.isMine}
                  title={
                    <>
                      {r.entryName}
                      {r.isMine ? (
                        <span className="ml-1.5">
                          <Chip tone="accent">you</Chip>
                        </span>
                      ) : null}
                    </>
                  }
                  end={
                    <span className="text-[0.8rem] text-[var(--color-muted-foreground)]">
                      {r.ownerName ?? ''}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* One card per entry — no table, no sideways scroll, nothing
          bunched. Rank | name+username | points, and the admin detail
          (email, bench/ban/admin) folded behind a Manage tap. */}
      {graded ? (
        <ul className="flex flex-col gap-2 tabular-nums">
          {rows.map((r) => {
            // W-L-P over whatever span the view covers.
            const record = (cells: StandingsRow['weekly']) =>
              `${cells.reduce((n, x) => n + x.correct, 0)}-${cells.reduce((n, x) => n + x.incorrect, 0)}-${cells.reduce((n, x) => n + x.push, 0)}`
            const wk = cellOf(r, shownWeek)
            // Big number = whatever the view ranks by; the sub-line
            // carries the rest.
            const big =
              view === 'key'
                ? r.keyPickScore
                : view === 'week'
                  ? weekPoints(r)
                  : seg
                    ? segPoints(r)
                    : r.totalPoints
            const rest =
              view === 'key' ? (
                <>
                  {r.totalPoints} pts · wk {lwPoints(r)}
                </>
              ) : view === 'week' ? (
                <>{wk && wk.points != null ? record([wk]) : 'no picks graded'}</>
              ) : seg ? (
                <>{record(segCells(r))}</>
              ) : (
                <>
                  <span className="text-[var(--color-key)]"><Star size={13} fill="currentColor" aria-hidden="true" className="inline-block align-[-0.1em]" />{r.keyPickScore}</span> · wk{' '}
                  {lwPoints(r)} · {record(r.weekly)}
                </>
              )
            const open = view === 'week' && openEntry === r.entryId
            const row = (
              <ListRow
                mine={r.isMine}
                lead={r.rank}
                title={
                  <>
                    {r.entryName}
                    {r.isMine ? (
                      <span className="ml-1.5">
                        <Chip tone="accent">you</Chip>
                      </span>
                    ) : null}
                    {r.ownerIsAdmin ? (
                      <span className="ml-1.5">
                        <Chip tone="key">{r.ownerIsCreator ? 'mgr' : 'adm'}</Chip>
                      </span>
                    ) : null}
                    {r.isEliminated ? (
                      <span className="ml-1.5">
                        <Chip tone="loss">out</Chip>
                      </span>
                    ) : null}
                  </>
                }
                sub={r.ownerName ?? ''}
                end={
                  <span className="flex items-center gap-2">
                    <span>
                      <b className="block text-[1.2rem] leading-tight">{big}</b>
                      <span className="block text-[0.78rem] text-[var(--color-muted-foreground)]">
                        {rest}
                      </span>
                    </span>
                    {view === 'week' ? (
                      <ChevronDown
                        size={20}
                        aria-hidden="true"
                        className={
                          'shrink-0 text-[var(--color-muted-foreground)] transition-transform ' +
                          (open ? 'rotate-180' : '')
                        }
                      />
                    ) : null}
                  </span>
                }
              />
            )
            return (
              <li key={r.entryId}>
                {view === 'week' ? (
                  <button
                    onClick={() => setOpenEntry(open ? null : r.entryId)}
                    aria-expanded={open}
                    aria-controls={`picks-${r.entryId}`}
                    className="w-full text-left"
                  >
                    {row}
                  </button>
                ) : (
                  row
                )}
                {open ? (
                  <div id={`picks-${r.entryId}`} className="mt-1 mb-2 ml-3 pl-3 border-l-2 border-[var(--color-border-interactive)]">
                    <WeekPicks
                      entryId={r.entryId}
                      picks={weekPicks.data?.others ?? []}
                      slate={weekPicks.data?.slate ?? []}
                      spreadMode={weekPicks.data?.pool.spreadMode ?? 'straight_up'}
                      loading={weekPicks.isLoading}
                      failed={!!weekPicks.error}
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {view === 'points' || view === 'key' ? (
        <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
          Ties break on the key-pick column. A key pick scores no extra points during
          the week — it only decides ties.
        </p>
      ) : null}

      <PoolTabBar />
    </div>
  )
}
