import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { createApi, type StandingsRow } from '@/lib/api/client'
import { PoolTabBar } from '@/components/layout/PoolTabBar'
import { Button, Card, Chip, EmptyState, ListRow, PageHeader, Skeleton } from '@/ui/components'

function WinnersBlock({
  title,
  rows,
  unit,
}: {
  title: string
  rows: Array<{ entryId: string; entryName: string; ownerName: string | null; points: number; rank: number }>
  unit: string
}) {
  return (
    <div>
      <p className="font-bold mb-1">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li
            key={r.entryId}
            className="flex items-baseline justify-between gap-2 rounded bg-[var(--color-muted)] px-2.5 py-1.5 tabular-nums"
          >
            <span className="truncate">
              <b>
                {r.rank}. {r.entryName}
              </b>
              {r.ownerName ? (
                <span className="text-[0.8rem] text-[var(--color-muted-foreground)]">
                  {' '}
                  · {r.ownerName}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-[var(--color-muted-foreground)]">
              {r.points} {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
    refetchInterval: 60_000,
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

  // Weeks ANY row has graded points for, in order.
  const gradedWeeks = [
    ...new Set(
      data.rows.flatMap((r) => r.weekly.filter((w) => w.points != null).map((w) => w.week))
    ),
  ].sort((a, b) => a - b)
  const graded = gradedWeeks.length > 0
  const lastWk = graded ? gradedWeeks[gradedWeeks.length - 1] : null
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
    ['key', 'Key ★'],
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
        status="Most points wins. The key ★ total only breaks ties."
      />

      {data.final && champions.length ? (
        <div className="rounded-xl border-2 border-[var(--color-key)] bg-[var(--color-card)] p-5 text-center">
          <p className="text-[2rem] leading-none" aria-hidden="true">
            &#127942;
          </p>
          <p className="mt-2 text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-key)]">
            {champions.length > 1 ? 'Champions' : 'Champion'}
          </p>
          <p className="text-[1.4rem] font-extrabold">
            {champions.map((c) => c.entryName).join(' & ')}
          </p>
          <p className="text-[var(--color-muted-foreground)] tabular-nums">
            {champions[0].totalPoints} points · key ★ {champions[0].keyPickScore}
          </p>
        </div>
      ) : null}

      {data.winners &&
      (data.final || data.winners.segments.some((s) => s.complete)) ? (
        <Card admin className="flex flex-col gap-3">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-key)]">
            Winners circle
          </h2>

          {data.final && data.winners.season.length ? (
            <WinnersBlock
              title={`Season points — top ${data.winners.seasonPlaces}`}
              rows={data.winners.season}
              unit="pts"
            />
          ) : null}

          {data.final && data.winners.key.length ? (
            <WinnersBlock
              title={`Key picks ★ — top ${data.winners.keyPlaces}`}
              rows={data.winners.key}
              unit="key ★"
            />
          ) : null}

          {data.final && data.winners.lastPlace.length ? (
            <WinnersBlock
              title="Last place"
              rows={data.winners.lastPlace}
              unit="pts"
            />
          ) : null}

          {data.winners.segments.map((s) =>
            s.complete && s.winners.length ? (
              <WinnersBlock
                key={s.name}
                title={`${s.name} (weeks ${s.startWeek}–${s.endWeek}) — top ${s.places}`}
                rows={s.winners}
                unit="pts"
              />
            ) : null
          )}

          {!data.final &&
          data.winners.segments.every((s) => !s.complete) ? null : !data.final ? (
            <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
              Season prizes land here when the last week is decided.
            </p>
          ) : null}
        </Card>
      ) : null}

      {graded ? (
        // View control — VIEWS of the same list, never a second page.
        // Points is the default and the pool's true ranking.
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Show standings by">
          {views.map(([key, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() => setView(key)}
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
            onClick={() => setWeekNo(gradedWeeks[weekIdx - 1])}
          >
            &lsaquo; Prev
          </Button>
          <b className="text-[1.1rem] text-center">
            {data.weeks.find((w) => w.week === shownWeek)?.label ?? `Week ${shownWeek}`}
          </b>
          <Button
            variant="quiet"
            disabled={weekIdx >= gradedWeeks.length - 1}
            onClick={() => setWeekNo(gradedWeeks[weekIdx + 1])}
          >
            Next &rsaquo;
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
                  <span className="text-[var(--color-key)]">★{r.keyPickScore}</span> · wk{' '}
                  {lwPoints(r)} · {record(r.weekly)}
                </>
              )
            return (
              <li key={r.entryId}>
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
                    <span>
                      <b className="block text-[1.2rem] leading-tight">{big}</b>
                      <span className="block text-[0.78rem] text-[var(--color-muted-foreground)]">
                        {rest}
                      </span>
                    </span>
                  }
                />
              </li>
            )
          })}
        </ul>
      ) : null}

      {view === 'points' || view === 'key' ? (
        <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
          Ties break on the key ★ column. A key pick scores no extra points during the
          week — it only decides ties.
        </p>
      ) : null}

      <PoolTabBar />
    </div>
  )
}
