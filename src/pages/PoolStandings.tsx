import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { createApi } from '@/lib/api/client'

// The leaderboard. Total points ranks it, key-pick score breaks ties —
// the same two columns the comparator uses, in the same order, so what
// members see is exactly what decides.
export function PoolStandings() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])

  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
    refetchInterval: 60_000,
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

  return (
    <div className="px-4 py-6 flex flex-col gap-4">
      <div>
        <Link
          to={`/pool/${poolId}`}
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; Pool home
        </Link>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Standings</h1>
      </div>

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
            {data.rows.map((r) => {
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
                    <span className="block text-[0.8rem] text-[var(--color-muted-foreground)]">
                      {/* Username is public; email manager-only. */}
                      {r.ownerName ?? ''}
                      {r.ownerEmail ? ` · ${r.ownerEmail}` : ''}
                    </span>
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
