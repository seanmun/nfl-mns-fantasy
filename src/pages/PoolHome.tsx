import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['picks', poolId, undefined],
    queryFn: () => api.getPicks(poolId),
    refetchInterval: 60_000,
  })

  // Inline rename, one entry at a time.
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const rename = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.renameEntry(poolId, id, value),
    onSuccess: (r) => {
      toast.success(`Renamed to “${r.entryName}”`)
      setRenaming(null)
      qc.invalidateQueries({ queryKey: ['picks', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Explicit second-entry flow: open the name field, name it, add. The
  // ONLY way an extra entry comes to exist.
  const [addingName, setAddingName] = useState<string | null>(null)
  const addEntry = useMutation({
    mutationFn: (name: string) =>
      api.joinPool({ poolId, addEntry: true, entryName: name }),
    onSuccess: (r) => {
      toast.success(`Added “${(addingName ?? '').trim()}” to ${r.pool.name}`)
      setAddingName(null)
      qc.invalidateQueries({ queryKey: ['picks', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
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
            {renaming?.id === e.id ? (
              <div className="flex gap-2">
                <input
                  value={renaming.value}
                  onChange={(ev) => setRenaming({ id: e.id, value: ev.target.value })}
                  maxLength={40}
                  autoFocus
                  className="flex-1 min-h-[var(--tap-target-min)] px-3 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)]"
                />
                <button
                  onClick={() => rename.mutate({ id: e.id, value: renaming.value.trim() })}
                  disabled={!renaming.value.trim() || rename.isPending}
                  className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-bold disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setRenaming(null)}
                  className="min-h-[var(--tap-target-min)] px-3 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-baseline justify-between gap-2">
                <b>{e.entryName}</b>
                <button
                  onClick={() => setRenaming({ id: e.id, value: e.entryName })}
                  className="min-h-[var(--tap-target-min)] px-2 font-bold text-[0.85rem] text-[var(--color-accent)]"
                >
                  Rename
                </button>
              </div>
            )}
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

      {/* Second entries are explicit and named — never a side effect. */}
      {data.pool.maxEntriesPerUser == null || data.entries.length < data.pool.maxEntriesPerUser ? (
        addingName == null ? (
          <button
            onClick={() => setAddingName('')}
            className="min-h-[var(--tap-target-min)] rounded-lg border-2 border-dashed border-[var(--color-border-interactive)] font-bold text-[var(--color-muted-foreground)]"
          >
            + Add another entry
          </button>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
            <label className="font-semibold" htmlFor="new-entry-name">
              Name the new entry
            </label>
            <p className="text-[0.9rem] text-[var(--color-muted-foreground)] -mt-2">
              It competes on its own — its own picks, its own leaderboard row. Your
              username shows under it.
            </p>
            <input
              id="new-entry-name"
              value={addingName}
              onChange={(e) => setAddingName(e.target.value)}
              placeholder="e.g. My upset special"
              maxLength={40}
              className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)]"
            />
            <div className="flex gap-2">
              <button
                onClick={() => addEntry.mutate(addingName.trim())}
                disabled={!addingName.trim() || addEntry.isPending}
                className="flex-1 min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold disabled:opacity-50"
              >
                {addEntry.isPending ? 'Adding…' : 'Add entry'}
              </button>
              <button
                onClick={() => setAddingName(null)}
                className="min-h-[var(--tap-target-min)] px-5 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        )
      ) : null}

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
