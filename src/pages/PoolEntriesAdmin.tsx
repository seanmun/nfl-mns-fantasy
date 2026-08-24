import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'
import { PoolTabBar } from '@/components/layout/PoolTabBar'

// The admin's roster tool — the ONLY place entries are moderated. The
// standings stay a leaderboard; this page carries entry name, username,
// email, status, and the levers: admin, bench, ban, reactivate.
export function PoolEntriesAdmin() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
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
    return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading&hellip;</p>
  }
  if (error || !data) {
    return (
      <div className="px-4 py-12">
        <h1 className="text-[1.3rem] font-bold mb-2">Managers only</h1>
        <p className="text-[var(--color-muted-foreground)]">
          {(error as Error)?.message ?? 'Only this pool’s admins can manage entries.'}
        </p>
      </div>
    )
  }

  const btn =
    'min-h-[var(--tap-target-min)] px-3 rounded-lg border-2 text-[0.85rem] font-bold '

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 pb-28 flex flex-col gap-4">
      <div>
        <Link
          to={`/pool/${poolId}`}
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; Pool home
        </Link>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-key)]">
          Admin
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Manage entries</h1>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          {data.rows.length} active
          {data.inactive.length ? ` · ${data.inactive.length} benched or banned` : ''}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {data.rows.map((r) => (
          <li
            key={r.entryId}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col gap-2"
          >
            <div>
              <b className="text-[1.05rem]">
                {r.entryName}
                {r.ownerIsAdmin ? (
                  <span className="ml-2 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--color-key)]">
                    {r.ownerIsCreator ? 'manager' : 'admin'}
                  </span>
                ) : null}
              </b>
              <span className="block text-[0.85rem] text-[var(--color-muted-foreground)]">
                {r.ownerName ?? ''}
                {r.ownerEmail ? ` · ${r.ownerEmail}` : ''}
              </span>
            </div>
            {r.canToggleAdmin || r.canModerate ? (
              <div className="flex flex-wrap gap-2">
                {r.canToggleAdmin ? (
                  <button
                    onClick={() => setAdmin.mutate({ entryId: r.entryId, isAdmin: !r.ownerIsAdmin })}
                    disabled={setAdmin.isPending}
                    className={btn + 'border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]'}
                  >
                    {r.ownerIsAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                ) : null}
                {r.canModerate ? (
                  <>
                    <button
                      onClick={() => setStatus.mutate({ entryId: r.entryId, status: 'benched' })}
                      disabled={setStatus.isPending}
                      className={btn + 'border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]'}
                    >
                      Bench
                    </button>
                    <button
                      onClick={() => setStatus.mutate({ entryId: r.entryId, status: 'banned' })}
                      disabled={setStatus.isPending}
                      className={btn + 'border-[var(--color-pick-loss)] text-[var(--color-pick-loss)]'}
                    >
                      Ban
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {data.inactive.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
            Benched &amp; banned
          </h2>
          <ul className="flex flex-col gap-2">
            {data.inactive.map((e) => (
              <li
                key={e.entryId}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col gap-2"
              >
                <div>
                  <b className="text-[1.05rem]">
                    {e.entryName}
                    <span
                      className={
                        'ml-2 text-[0.68rem] font-bold uppercase tracking-wider ' +
                        (e.status === 'banned'
                          ? 'text-[var(--color-pick-loss)]'
                          : 'text-[var(--color-pick-push)]')
                      }
                    >
                      {e.status}
                    </span>
                  </b>
                  <span className="block text-[0.85rem] text-[var(--color-muted-foreground)]">
                    {e.ownerName ?? ''}
                    {e.ownerEmail ? ` · ${e.ownerEmail}` : ''}
                  </span>
                </div>
                <div>
                  <button
                    onClick={() => setStatus.mutate({ entryId: e.entryId, status: 'active' })}
                    disabled={setStatus.isPending}
                    className={btn + 'border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]'}
                  >
                    Reactivate
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PoolTabBar />
    </div>
  )
}
