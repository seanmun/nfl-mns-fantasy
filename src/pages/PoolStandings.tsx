import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi, type StandingsRow } from '@/lib/api/client'

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
    <div className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
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
        <p className="text-[var(--color-muted-foreground)] leading-relaxed">
          Nothing graded yet — standings fill in as games go final.
        </p>
      ) : null}

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full min-w-[24rem] border-collapse tabular-nums">
          <thead>
            <tr className="text-left text-[0.74rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-3">Entry</th>
              <th className="py-2 pr-3 text-right">Points</th>
              <th className="py-2 pr-3 text-right" title="Key pick score — breaks ties">
                Key ★
              </th>
              <th className="py-2 text-right">W-L-P</th>
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
                    {r.canToggleAdmin ? (
                      <button
                        onClick={() =>
                          setAdmin.mutate({ entryId: r.entryId, isAdmin: !r.ownerIsAdmin })
                        }
                        disabled={setAdmin.isPending}
                        className="mt-1 min-h-[2rem] px-2 rounded border-2 border-[var(--color-border-interactive)] text-[0.78rem] font-bold text-[var(--color-muted-foreground)]"
                      >
                        {r.ownerIsAdmin ? 'Remove admin' : 'Make admin'}
                      </button>
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

      <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
        Ties break on the key ★ column. A key pick scores no extra points during the
        week — it only decides ties.
      </p>
    </div>
  )
}
