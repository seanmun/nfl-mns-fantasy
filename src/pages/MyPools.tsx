import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'

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
  const onlyPool = !isLoading && data?.pools.length === 1 ? data.pools[0].pool.id : null
  useEffect(() => {
    if (onlyPool && !stay) navigate(`/pool/${onlyPool}`, { replace: true })
  }, [onlyPool, stay, navigate])

  return (
    <div className="px-4 py-8 flex flex-col gap-6">
      <h1 className="text-[1.7rem] font-extrabold leading-tight">My pools</h1>

      <div className="flex gap-3">
        <Link
          to="/create"
          className="flex-1 min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold"
        >
          Create a pool
        </Link>
        <Link
          to="/join"
          className="flex-1 min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
        >
          Join a pool
        </Link>
      </div>

      {isLoading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading&hellip;</p>
      ) : !data?.pools.length ? (
        <p className="text-[var(--color-muted-foreground)] leading-relaxed">
          You&rsquo;re not in any pools yet. Create one, or join with a code someone
          sent you.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.pools.map(({ pool, entry }) => (
            <li
              key={entry.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3"
            >
              {/* The whole card leads to the pool page — standings,
                  pick status, make/edit picks all live there. */}
              <Link to={`/pool/${pool.id}`} className="block">
                <b className="block text-[1.1rem] text-[var(--color-accent)]">{pool.name}</b>
                <span className="text-[0.9rem] text-[var(--color-muted-foreground)]">
                  {entry.entryName} &middot; {pool.season}
                </span>
              </Link>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/pool/${pool.id}`}
                  className="min-h-[var(--tap-target-min)] px-5 flex items-center rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-bold"
                >
                  Open pool
                </Link>
                <Link
                  to={`/pool/${pool.id}/picks`}
                  className="min-h-[var(--tap-target-min)] px-5 flex items-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
                >
                  Make picks
                </Link>
                {/* Manager tools only for whoever created it. */}
                {user?.id === pool.createdBy ? (
                  <Link
                    to={`/lm/${pool.id}/week`}
                    className="min-h-[var(--tap-target-min)] px-5 flex items-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
                  >
                    Manage week
                  </Link>
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
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${window.location.origin}/join?code=${pool.joinCode}`
                      )
                      toast.success('Invite link copied — text it to your pool')
                    }}
                    className="min-h-[var(--tap-target-min)] px-5 flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
                  >
                    Copy invite link
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
