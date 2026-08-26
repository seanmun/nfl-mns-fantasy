import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { createApi, type StandingsRow } from '@/lib/api/client'
import { PoolTabBar } from '@/components/layout/PoolTabBar'
import { Card, Chip, EmptyState, ListRow, PageHeader, Skeleton } from '@/ui/components'

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

// Season-end tab 2: the same rows re-ranked by the key-pick score.
// Competition ranking again — level entries share, the next skips.
function rankByKey(rows: StandingsRow[]): StandingsRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.keyPickScore - a.keyPickScore || b.totalPoints - a.totalPoints
  )
  let rank = 0
  return sorted.map((row, i) => {
    const prev = sorted[i - 1]
    const tied =
      prev && prev.keyPickScore === row.keyPickScore && prev.totalPoints === row.totalPoints
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

  const [tab, setTab] = useState<'points' | 'key'>('points')
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

  const graded = data.rows.some((r) => r.weekly.some((w) => w.points != null))
  const rows = data.final && tab === 'key' ? rankByKey(data.rows) : data.rows
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

      {data.final ? (
        <div className="flex gap-2" role="tablist" aria-label="Final rankings">
          {(
            [
              ['points', 'Season points'],
              ['key', 'Key picks ★'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={
                'flex-1 min-h-[var(--tap-target-min)] rounded-lg border-2 font-bold ' +
                (tab === key
                  ? 'bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]'
                  : 'border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]')
              }
            >
              {label}
            </button>
          ))}
        </div>
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
            const w = r.weekly.reduce((n, x) => n + x.correct, 0)
            const l = r.weekly.reduce((n, x) => n + x.incorrect, 0)
            const pp = r.weekly.reduce((n, x) => n + x.push, 0)
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
                      <b className="block text-[1.2rem] leading-tight">{r.totalPoints}</b>
                      <span className="block text-[0.78rem] text-[var(--color-muted-foreground)]">
                        <span className="text-[var(--color-key)]">★{r.keyPickScore}</span> · {w}-{l}-{pp}
                      </span>
                    </span>
                  }
                />
              </li>
            )
          })}
        </ul>
      ) : null}

      <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
        Ties break on the key ★ column. A key pick scores no extra points during the
        week — it only decides ties.
      </p>

      <PoolTabBar />
    </div>
  )
}
