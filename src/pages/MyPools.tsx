import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'
import { Button, Card, EmptyState, Skeleton } from '@/ui/components'

export function MyPools() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const api = useMemo(() => createApi(getToken), [getToken])
  const { data, isLoading } = useQuery({ queryKey: ['my-pools'], queryFn: () => api.myPools() })
  const navigate = useNavigate()
  const location = useLocation()

  // One pool = no list page to wade through: land straight in it. The
  // pool's own "My pools" link passes stay:true, so backing out to this
  // list still works.
  const stay = (location.state as { stay?: boolean } | null)?.stay === true
  // The API returns one row per ENTRY; this page shows one card per
  // POOL. A second entry is another contestant in the same pool, not
  // another pool to scan past — it becomes a name on the subtitle.
  const rows = data?.pools ?? []
  const byPool = new Map<
    string,
    { pool: (typeof rows)[number]['pool']; entries: Array<{ id: string; entryName: string }> }
  >()
  for (const { pool, entry } of rows) {
    const seen = byPool.get(pool.id)
    if (seen) seen.entries.push(entry)
    else byPool.set(pool.id, { pool, entries: [entry] })
  }
  const pools = [...byPool.values()]
  // Finished pools live in the archive; only ACTIVE pools count toward
  // "you have one pool, go straight in".
  const activePools = pools.filter(({ pool }) => pool.status !== 'completed')
  const finishedPools = pools.filter(({ pool }) => pool.status === 'completed')
  const onlyPool = !isLoading && activePools.length === 1 ? activePools[0].pool.id : null
  useEffect(() => {
    if (onlyPool && !stay) navigate(`/pool/${onlyPool}`, { replace: true })
  }, [onlyPool, stay, navigate])

  return (
    <div className="px-4 py-8 flex flex-col gap-6">
      <h1 className="text-[1.7rem] font-extrabold leading-tight">My pools</h1>

      <div className="flex gap-3">
        <Button to="/create" className="flex-1">
          Create a pool
        </Button>
        <Button to="/join" variant="quiet" className="flex-1">
          Join a pool
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton h="8rem" />
          <Skeleton h="8rem" />
        </div>
      ) : !data?.pools.length ? (
        <EmptyState title="You're not in any pools yet">
          Create one, or join with a code someone sent you.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {activePools.map(({ pool, entries }) => (
            <li key={pool.id}>
              <Card className="flex flex-col gap-3">
                {/* The whole card leads to the pool page — standings,
                    pick status, make/edit picks all live there. */}
                <Link to={`/pool/${pool.id}`} className="block">
                  <b className="block text-[1.1rem] text-[var(--color-accent)]">{pool.name}</b>
                  <span className="text-[0.9rem] text-[var(--color-muted-foreground)]">
                    {entries.map((e) => e.entryName).join(' · ')} &middot; {pool.season}
                  </span>
                </Link>
                <div className="flex flex-wrap gap-2">
                  <Button to={`/pool/${pool.id}`}>Open pool</Button>
                  <Button to={`/pool/${pool.id}/picks`} variant="quiet">
                    Make picks
                  </Button>
                  {/* Manager tools only for whoever created it. */}
                  {user?.id === pool.createdBy ? (
                    <Button to={`/lm/${pool.id}/week`} variant="quiet">
                      Manage week
                    </Button>
                  ) : null}
                </div>
                {user?.id === pool.createdBy && pool.joinCode ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
                      Invite code:{' '}
                      <b className="font-mono tracking-[0.15em] text-[var(--color-foreground)]">
                        {pool.joinCode}
                      </b>
                    </p>
                    {/* The link form of the code — /join?code= prefills the
                        join page, so this is the thing to text people. */}
                    <Button
                      variant="quiet"
                      full
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/join?code=${pool.joinCode}`
                        )
                        toast.success('Invite link copied — text it to your pool')
                      }}
                    >
                      Copy invite link
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* ── Archive: finished pools, out of the way but never gone ── */}
      {finishedPools.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
            Finished pools
          </h2>
          <ul className="flex flex-col gap-2">
            {finishedPools.map(({ pool }) => (
              <li key={pool.id}>
                <Link
                  to={`/pool/${pool.id}/standings`}
                  className="flex items-baseline justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 opacity-80"
                >
                  <span className="truncate">
                    <b>{pool.name}</b>
                    <span className="text-[0.85rem] text-[var(--color-muted-foreground)]">
                      {' '}· {pool.season} · final standings
                    </span>
                  </span>
                  <span className="shrink-0 text-[var(--color-accent)] font-bold">&rsaquo;</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
