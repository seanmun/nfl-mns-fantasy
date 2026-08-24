import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi, type StandingsRow } from '@/lib/api/client'
import { PoolTabBar } from '@/components/layout/PoolTabBar'

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

  const qc = useQueryClient()
  const [tab, setTab] = useState<'points' | 'key'>('points')
  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
    refetchInterval: 60_000,
  })

  const setStatus = useMutation({
    mutationFn: ({ entryId, status }: { entryId: string; status: 'active' | 'benched' | 'banned' }) =>
      api.setEntryStatus(poolId, entryId, status),
    onSuccess: (_r, v) => {
      toast.success(
        v.status === 'active' ? 'Back in the pool' : v.status === 'benched' ? 'Benched' : 'Banned'
      )
      qc.invalidateQueries({ queryKey: ['standings', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setAdmin = useMutation({
    mutationFn: ({ entryId, isAdmin }: { entryId: string; isAdmin: boolean }) =>
      api.setPoolAdmin(poolId, entryId, isAdmin),
    onSuccess: (_r, v) => {
      toast.success(v.isAdmin ? 'Made admin' : 'Admin removed')
      qc.invalidateQueries({ queryKey: ['standings', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading standings&hellip;</p>
  }
  if (error || !data) {
    return (
      <div className="px-4 py-12">
        <h1 className="text-[1.3rem] font-bold mb-2">Something went wrong</h1>
        <p className="text-[var(--color-muted-foreground)]">
          {(error as Error)?.message ?? 'Could not load the standings.'}
        </p>
      </div>
    )
  }

  const graded = data.rows.some((r) => r.weekly.some((w) => w.points != null))
  const rows = data.final && tab === 'key' ? rankByKey(data.rows) : data.rows
  const champions = data.final ? data.rows.filter((r) => r.rank === 1) : []

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 pb-28 flex flex-col gap-4">
      <div>
        <Link
          to={`/pool/${poolId}`}
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; Pool home
        </Link>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">
          {data.final ? 'Final standings' : 'Standings'}
        </h1>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          Most points wins. The key ★ total only breaks ties.
        </p>
      </div>

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
        <section className="rounded-xl border border-[var(--color-key)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
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
        </section>
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
              <li
                key={r.entryId}
                className={
                  'flex items-baseline justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 ' +
                  (r.isMine ? 'border-[var(--color-accent)]' : '')
                }
              >
                <span className="truncate">
                  <b>{r.entryName}</b>
                  {r.isMine ? (
                    <span className="ml-2 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--color-accent)]">
                      you
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[0.8rem] text-[var(--color-muted-foreground)]">
                  {r.ownerName ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={graded ? 'overflow-x-auto -mx-4 px-4' : 'hidden'}>
        <table className="w-full min-w-[24rem] border-collapse tabular-nums">
          <thead>
            <tr className="text-left text-[0.74rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
              <th className="py-2 pr-2">Place</th>
              <th className="py-2 pr-3">Entry</th>
              <th className="py-2 pr-3 text-right">Points</th>
              <th className="py-2 pr-3 text-right" title="Key pick score — breaks ties">
                Key ★
              </th>
              <th className="py-2 text-right">Record</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const w = r.weekly.reduce((n, x) => n + x.correct, 0)
              const l = r.weekly.reduce((n, x) => n + x.incorrect, 0)
              const p = r.weekly.reduce((n, x) => n + x.push, 0)
              return (
                <tr
                  key={r.entryId}
                  className={
                    'border-t border-[var(--color-border)] text-[1.05rem] ' +
                    (r.isMine ? 'bg-[var(--color-muted)]' : '')
                  }
                >
                  <td className="py-3 pr-2 font-bold">{r.rank}</td>
                  <td className="py-3 pr-3">
                    <b>{r.entryName}</b>
                    {r.ownerIsAdmin ? (
                      <span className="ml-2 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--color-key)]">
                        {r.ownerIsCreator ? 'manager' : 'admin'}
                      </span>
                    ) : null}
                    <span className="block text-[0.8rem] text-[var(--color-muted-foreground)]">
                      {/* Username is public; email admin-only. */}
                      {r.ownerName ?? ''}
                      {r.ownerEmail ? ` · ${r.ownerEmail}` : ''}
                    </span>
                    {r.canToggleAdmin || r.canModerate ? (
                      <span className="flex flex-wrap gap-1 mt-1">
                        {r.canToggleAdmin ? (
                          <button
                            onClick={() =>
                              setAdmin.mutate({ entryId: r.entryId, isAdmin: !r.ownerIsAdmin })
                            }
                            disabled={setAdmin.isPending}
                            className="min-h-[2rem] px-2 rounded border-2 border-[var(--color-border-interactive)] text-[0.78rem] font-bold text-[var(--color-muted-foreground)]"
                          >
                            {r.ownerIsAdmin ? 'Remove admin' : 'Make admin'}
                          </button>
                        ) : null}
                        {r.canModerate ? (
                          <>
                            <button
                              onClick={() =>
                                setStatus.mutate({ entryId: r.entryId, status: 'benched' })
                              }
                              disabled={setStatus.isPending}
                              className="min-h-[2rem] px-2 rounded border-2 border-[var(--color-border-interactive)] text-[0.78rem] font-bold text-[var(--color-muted-foreground)]"
                            >
                              Bench
                            </button>
                            <button
                              onClick={() =>
                                setStatus.mutate({ entryId: r.entryId, status: 'banned' })
                              }
                              disabled={setStatus.isPending}
                              className="min-h-[2rem] px-2 rounded border-2 border-[var(--color-pick-loss)] text-[0.78rem] font-bold text-[var(--color-pick-loss)]"
                            >
                              Ban
                            </button>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    {r.isMine ? (
                      <span className="ml-2 text-[0.74rem] font-bold uppercase tracking-wider text-[var(--color-accent)]">
                        you
                      </span>
                    ) : null}
                    {r.isEliminated ? (
                      <span className="ml-2 text-[0.74rem] font-bold uppercase tracking-wider text-[var(--color-pick-loss)]">
                        out
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-right font-bold">{r.totalPoints}</td>
                  <td className="py-3 pr-3 text-right text-[var(--color-key)]">{r.keyPickScore}</td>
                  <td className="py-3 text-right text-[var(--color-muted-foreground)]">
                    {w}-{l}-{p}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.inactive.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
            Benched &amp; banned
          </h2>
          <ul className="flex flex-col gap-1">
            {data.inactive.map((e) => (
              <li
                key={e.entryId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] px-3 py-2"
              >
                <span className="truncate">
                  <b>{e.entryName}</b>
                  <span className="text-[0.8rem] text-[var(--color-muted-foreground)]">
                    {' '}
                    · {e.ownerName ?? ''}
                    {e.ownerEmail ? ` · ${e.ownerEmail}` : ''}
                  </span>
                  <span
                    className={
                      'ml-2 text-[0.7rem] font-bold uppercase tracking-wider ' +
                      (e.status === 'banned'
                        ? 'text-[var(--color-pick-loss)]'
                        : 'text-[var(--color-pick-push)]')
                    }
                  >
                    {e.status}
                  </span>
                </span>
                <button
                  onClick={() => setStatus.mutate({ entryId: e.entryId, status: 'active' })}
                  disabled={setStatus.isPending}
                  className="min-h-[2rem] px-2 rounded border-2 border-[var(--color-border-interactive)] text-[0.78rem] font-bold text-[var(--color-muted-foreground)]"
                >
                  Reactivate
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
        Ties break on the key ★ column. A key pick scores no extra points during the
        week — it only decides ties.
      </p>

      <PoolTabBar />
    </div>
  )
}
