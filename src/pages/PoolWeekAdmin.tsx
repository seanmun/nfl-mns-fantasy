import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api/client'
import { kickoffLabel, dayLabel } from '@/lib/utils'

// The manager's week builder: tick the games that count, set the
// numbers, publish. Until publish, members see nothing.
//
// Unlike the picks screen this does NOT auto-save. Half-applied slate
// edits are exactly what publishing is supposed to prevent — the whole
// week goes live as one act, so it is saved as one act too.

interface AdminTeam {
  id: string
  nickname: string
  primaryColor: string | null
}

interface AdminGame {
  gameId: string
  kickoffAt: string
  kickoffTbd: boolean
  home: AdminTeam | null
  away: AdminTeam | null
  isIncluded: boolean
  spread: number | null
  spreadSource: 'api' | 'manual'
  marketSpread: number | null
  started: boolean
}

interface WeekAdminResponse {
  pool: {
    id: string
    name: string
    spreadMode: 'straight_up' | 'ats'
    lineSource: 'api' | 'manual'
    deadlineAnchor: string
  }
  week: { id: string; week: number; label: string }
  publishedAt: string | null
  pickDeadlineAt: string | null
  suggestedDeadline: string | null
  slate: AdminGame[]
}

export function PoolWeekAdmin() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const qc = useQueryClient()

  const call = useMemo(
    () =>
      async <T,>(init: RequestInit = {}): Promise<T> => {
        const token = await getToken()
        const res = await fetch(`/api/pools/${poolId}/week`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new ApiError((body as { error?: string }).error ?? 'Request failed', res.status)
        return body as T
      },
    [getToken, poolId]
  )

  const { data, isLoading, error } = useQuery({
    queryKey: ['week-admin', poolId],
    queryFn: () => call<WeekAdminResponse>(),
  })

  const [slate, setSlate] = useState<AdminGame[]>([])
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (data) {
      setSlate(data.slate)
      setDirty(false)
    }
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      call({
        method: 'PUT',
        body: JSON.stringify({
          slate: slate.map((g) => ({
            gameId: g.gameId,
            isIncluded: g.isIncluded,
            spread: g.spread,
          })),
        }),
      }),
    onSuccess: () => {
      toast.success('Saved')
      qc.invalidateQueries({ queryKey: ['week-admin', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const publish = useMutation({
    // Saves the draft FIRST. Publishing without it would go live with
    // the previously saved slate while the manager's unticked Thursday
    // games sat unsaved on screen — his edits silently ignored, and no
    // way to tell from the result that it happened.
    mutationFn: async () => {
      await call({
        method: 'PUT',
        body: JSON.stringify({
          slate: slate.map((g) => ({
            gameId: g.gameId,
            isIncluded: g.isIncluded,
            spread: g.spread,
          })),
        }),
      })
      return call<{ pickDeadlineAt: string }>({ method: 'POST', body: JSON.stringify({}) })
    },
    onSuccess: (r) => {
      toast.success(`Published. Picks close ${kickoffLabel(r.pickDeadlineAt)}`)
      qc.invalidateQueries({ queryKey: ['week-admin', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading&hellip;</p>
  if (error || !data)
    return <p className="px-4 py-12">{(error as Error)?.message ?? 'Could not load that week.'}</p>

  const included = slate.filter((g) => g.isIncluded)
  const ats = data.pool.spreadMode === 'ats'
  const missingSpreads = ats ? included.filter((g) => g.spread == null) : []
  const canPublish = included.length > 0 && missingSpreads.length === 0

  const update = (gameId: string, patch: Partial<AdminGame>) => {
    setDirty(true)
    setSlate((s) => s.map((g) => (g.gameId === gameId ? { ...g, ...patch } : g)))
  }

  let lastDay = ''

  return (
    <div className="pb-44">
      <header className="px-4 pt-6 pb-4 border-b border-[var(--color-border)]">
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
          Manager &middot; {data.week.label}
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">{data.pool.name}</h1>
        <p className="mt-2 text-[var(--color-muted-foreground)]">
          {data.publishedAt ? (
            <>
              Published. Picks close{' '}
              <b className="text-[var(--color-foreground)]">
                {data.pickDeadlineAt ? kickoffLabel(data.pickDeadlineAt) : '\u2014'}
              </b>
            </>
          ) : (
            'Not published yet — members cannot pick until you publish.'
          )}
        </p>
      </header>

      <div className="px-4 pt-5 pb-1">
        <p className="text-[1.05rem] font-bold">Choose this week&rsquo;s games</p>
        <p className="text-[var(--color-muted-foreground)]">
          Untick anything this pool doesn&rsquo;t play.
          {ats ? ' Every game you keep needs a number.' : ''}
        </p>
      </div>

      {slate.map((g) => {
        const day = dayLabel(g.kickoffAt)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={g.gameId}>
            {showDay ? (
              <h2 className="mx-4 mt-5 mb-2 pb-1 text-[0.74rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                {day}
              </h2>
            ) : null}
            <AdminGameRow game={g} ats={ats} onChange={(patch) => update(g.gameId, patch)} />
          </div>
        )
      })}

      <div className="fixed left-0 right-0 bottom-0 bg-[var(--color-card)] border-t border-[var(--color-border-interactive)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-[1.05rem] tabular-nums">
            {included.length} games in
            {dirty ? (
              <span className="ml-2 font-normal text-[0.85rem] text-[var(--color-key)]">
                unsaved changes
              </span>
            ) : null}
          </b>
          {missingSpreads.length > 0 ? (
            <span className="text-[0.85rem] text-[var(--color-pick-loss)] font-semibold">
              {missingSpreads.length} still need a number
            </span>
          ) : data.suggestedDeadline && !data.publishedAt ? (
            <span className="text-[0.85rem] text-[var(--color-muted-foreground)]">
              Closes {kickoffLabel(data.suggestedDeadline)}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex-1 min-h-[var(--tap-target-min)] rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
          </button>
          <button
            onClick={() => publish.mutate()}
            disabled={!canPublish || publish.isPending}
            className="flex-1 min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold disabled:bg-[var(--color-border-interactive)] disabled:text-[var(--color-card)]"
          >
            {publish.isPending ? 'Publishing…' : data.publishedAt ? 'Re-publish' : 'Publish week'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AdminGameRow({
  game,
  ats,
  onChange,
}: {
  game: AdminGame
  ats: boolean
  onChange: (patch: Partial<AdminGame>) => void
}) {
  const drift =
    game.marketSpread != null && game.spread != null && game.marketSpread !== game.spread

  return (
    <div
      className={
        'mx-4 my-2 rounded-xl border bg-[var(--color-card)] p-3 flex flex-col gap-2 ' +
        (game.isIncluded
          ? 'border-[var(--color-border-interactive)]'
          : 'border-[var(--color-border)] opacity-55')
      }
    >
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={game.isIncluded}
          disabled={game.started}
          onChange={(e) => onChange({ isIncluded: e.target.checked })}
          className="w-6 h-6 accent-[var(--color-accent)]"
        />
        <span className="flex-1 font-bold">
          {game.away?.nickname} <span className="text-[var(--color-muted-foreground)]">@</span>{' '}
          {game.home?.nickname}
        </span>
        <span className="text-[0.8rem] text-[var(--color-muted-foreground)] text-right">
          {game.kickoffTbd ? 'Time TBA' : kickoffLabel(game.kickoffAt)}
          {game.started ? (
            <b className="block text-[var(--color-locked)] uppercase text-[0.7rem]">Started</b>
          ) : null}
        </span>
      </label>

      {ats && game.isIncluded ? (
        <div className="flex items-center gap-3 pl-9">
          <label className="text-[0.85rem] text-[var(--color-muted-foreground)]">
            {game.home?.nickname} line
          </label>
          <input
            type="number"
            step="0.5"
            inputMode="decimal"
            disabled={game.started}
            value={game.spread ?? ''}
            onChange={(e) =>
              onChange({ spread: e.target.value === '' ? null : Number(e.target.value) })
            }
            placeholder="—"
            className="w-24 min-h-[var(--tap-target-min)] px-3 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)] font-mono font-bold tabular-nums text-center"
          />
          {/* The market number is shown for comparison only. Grading
              reads the manager's number, never this one. */}
          {game.marketSpread != null ? (
            <span className={'text-[0.8rem] ' + (drift ? 'text-[var(--color-key)]' : 'text-[var(--color-muted-foreground)]')}>
              market {game.marketSpread > 0 ? `+${game.marketSpread}` : game.marketSpread}
              {drift ? ' (yours differs)' : ''}
            </span>
          ) : (
            <span className="text-[0.8rem] text-[var(--color-muted-foreground)]">no market line</span>
          )}
        </div>
      ) : null}
    </div>
  )
}
