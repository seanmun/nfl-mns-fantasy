import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'

// Joining. All four routes in — share link, code, email invite, public
// search — end at the same endpoint with the same checks, so this page
// only has to collect whichever one the member arrived with.
export function JoinPool() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const [params] = useSearchParams()

  // A share link carries the code, an emailed invite carries a token.
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase())
  const inviteToken = params.get('invite') ?? undefined
  const [query, setQuery] = useState('')

  const join = useMutation({
    mutationFn: (body: { joinCode?: string; poolId?: string; inviteToken?: string }) =>
      api.joinPool(body),
    onSuccess: (r) => {
      toast.success(`Joined ${r.pool.name}`)
      navigate(`/pool/${r.pool.id}/picks`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const search = useQuery({
    queryKey: ['pool-search', query],
    queryFn: () => api.searchPools(query),
    enabled: query.trim().length >= 2,
  })

  return (
    <div className="px-4 py-8 flex flex-col gap-8">
      <div>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-1">
          Join
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Join a pool</h1>
      </div>

      {inviteToken ? (
        <div className="rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-card)] p-5 flex flex-col gap-3">
          <p className="font-semibold">You were invited to a pool.</p>
          <button
            onClick={() => join.mutate({ inviteToken })}
            disabled={join.isPending}
            className="min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold"
          >
            {join.isPending ? 'Joining…' : 'Accept invite'}
          </button>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <label className="font-semibold" htmlFor="code">Have a code?</label>
        <p className="text-[0.9rem] text-[var(--color-muted-foreground)] -mt-2">
          The person running the pool can give you one.
        </p>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC123"
          autoCapitalize="characters"
          className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)] font-mono text-[1.3rem] tracking-[0.2em] text-center"
        />
        <button
          onClick={() => join.mutate({ joinCode: code.trim() })}
          disabled={code.trim().length < 4 || join.isPending}
          className="min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold disabled:bg-[var(--color-border-interactive)] disabled:text-[var(--color-card)]"
        >
          {join.isPending ? 'Joining…' : 'Join with code'}
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <label className="font-semibold" htmlFor="q">Or find a public pool</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)]"
        />
        {search.data?.pools.length ? (
          <ul className="flex flex-col gap-2">
            {search.data.pools.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => join.mutate({ poolId: p.id })}
                  className="w-full text-left p-4 rounded-xl border-2 border-[var(--color-border-interactive)] bg-[var(--color-card)]"
                >
                  <b className="block">{p.name}</b>
                  <span className="text-[0.9rem] text-[var(--color-muted-foreground)]">
                    {p.season} season
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim().length >= 2 && !search.isLoading ? (
          <p className="text-[var(--color-muted-foreground)]">
            No public pools match that. You may need a code or an invite.
          </p>
        ) : null}
      </section>
    </div>
  )
}
