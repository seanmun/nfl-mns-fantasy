import { useMemo } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { createApi } from '@/lib/api/client'
import { kickoffLabel } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'

// The pool's front door, and where submitting drops you: this week at a
// glance — am I in, am I confirmed, when do picks close. Reuses the
// picks payload rather than growing its own endpoint; everything this
// page says is already in there.
export function PoolHome() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const location = useLocation()
  const justSubmitted = (location.state as { justSubmitted?: boolean } | null)?.justSubmitted

  const { data, isLoading, error } = useQuery({
    queryKey: ['picks', poolId, undefined],
    queryFn: () => api.getPicks(poolId),
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading&hellip;</p>
  }
  if (error || !data) {
    return (
      <div className="px-4 py-12">
        <h1 className="text-[1.3rem] font-bold mb-2">Something went wrong</h1>
        <p className="text-[var(--color-muted-foreground)]">
          {(error as Error)?.message ?? 'Could not load this pool.'}
        </p>
      </div>
    )
  }

  const need =
    data.pool.poolType === 'survivor' ? 1 : data.pool.picksRequired ?? data.slate.length

  return (
    <div className="px-4 py-6 flex flex-col gap-5">
      <div>
        <Link
          to="/"
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; My pools
        </Link>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
          {data.week.label}
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight text-balance">
          {data.pool.name}
        </h1>
        {data.deadline ? (
          <p className="mt-2 text-[var(--color-muted-foreground)]">
            Picks close{' '}
            <b className="text-[var(--color-foreground)]">{kickoffLabel(data.deadline)}</b>
          </p>
        ) : null}
      </div>

      {justSubmitted ? (
        <div className="rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <b className="text-[1.05rem] text-[var(--color-accent)]">&#10003; Picks submitted</b>
          <p className="text-[var(--color-muted-foreground)] mt-1">
            You&rsquo;re locked in for {data.week.label}. You can still change your mind
            until the deadline — just resubmit after.
          </p>
        </div>
      ) : null}

      {/* One card per entry: the week's standing answer to "am I in?" */}
      {data.entries.map((e) => {
        const mine = data.myPicks.filter((p) => p.entryId === e.id)
        const hasKey = mine.some((p) => p.isKeyPick)
        const anyAuto = mine.some((p) => p.isAuto)
        const complete = mine.length >= need && (!data.pool.keyPick || hasKey)
        return (
          <div
            key={e.id}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2"
          >
            {data.entries.length > 1 ? <b>{e.entryName}</b> : null}
            <p className="text-[1.05rem]">
              {e.submittedAt ? (
                <b className="text-[var(--color-accent)]">
                  &#10003; Confirmed — {mine.length} of {need} picks
                  {data.pool.keyPick && hasKey ? (
                    <span className="text-[var(--color-key)]"> + key ★</span>
                  ) : null}
                </b>
              ) : anyAuto ? (
                // Filled by the deadline job, not chosen. Saying
                // "confirmed" here would put words in the member's mouth.
                <b>{mine.length} of {need} picks — some filled by the app</b>
              ) : mine.length === 0 ? (
                <b className="text-[var(--color-pick-loss)]">No picks in yet</b>
              ) : (
                <b>
                  {mine.length} of {need} picks in
                  {complete ? ' — not submitted yet' : ''}
                </b>
              )}
            </p>
            <Link
              to={`/pool/${poolId}/picks`}
              className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold"
            >
              {mine.length === 0 ? 'Make picks' : 'View / edit picks'}
            </Link>
          </div>
        )
      })}

      <Link
        to={`/pool/${poolId}/standings`}
        className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
      >
        Standings
      </Link>

      {data.manager ? (
        <Link
          to={`/lm/${poolId}/week`}
          className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
        >
          Manager: set this week&rsquo;s games &amp; lines
        </Link>
      ) : null}

      {data.pool.managerNote ? (
        <div className="rounded-xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-2">
            Note from the manager
          </h2>
          <Markdown source={data.pool.managerNote} />
        </div>
      ) : null}
    </div>
  )
}
