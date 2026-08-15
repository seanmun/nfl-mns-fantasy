import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createApi, type ApiSlateGame, type SavePick } from '@/lib/api/client'
import { useAutoSave } from '@/hooks/useAutoSave'
import { kickoffLabel, dayLabel, teamSpread } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'

export function PoolPicks() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const qc = useQueryClient()

  // Undefined asks the server for the current week; week navigation
  // arrives with the standings screen.
  const [weekNo] = useState<number | undefined>(undefined)
  const [entryId, setEntryId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['picks', poolId, weekNo],
    queryFn: () => api.getPicks(poolId, weekNo),
  })

  // Local pick state, keyed by gameId. Seeded from the server and then
  // owned by the screen, so a tap shows instantly rather than after a
  // round trip.
  const activeEntry = entryId ?? data?.entries[0]?.id ?? null
  const serverPicks = useMemo(() => {
    const map = new Map<string, { teamId: string; isKey: boolean }>()
    for (const p of data?.myPicks ?? []) {
      if (p.entryId === activeEntry) map.set(p.gameId, { teamId: p.selectedTeamId, isKey: p.isKeyPick })
    }
    return map
  }, [data, activeEntry])

  const [draft, setDraft] = useState<Map<string, { teamId: string; isKey: boolean }> | null>(null)
  const picks = draft ?? serverPicks

  const mutation = useMutation({
    mutationFn: (value: SavePick[]) =>
      api.savePicks(poolId, activeEntry!, data!.week.week, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picks', poolId] }),
  })

  const autoSave = useAutoSave<SavePick[]>(
    useCallback((value) => mutation.mutateAsync(value), [mutation])
  )

  const commit = useCallback(
    (next: Map<string, { teamId: string; isKey: boolean }>) => {
      setDraft(next)
      autoSave.save(
        [...next].map(([gameId, v]) => ({
          gameId,
          selectedTeamId: v.teamId,
          isKeyPick: v.isKey,
        }))
      )
    },
    [autoSave]
  )

  if (isLoading) return <Loading />
  if (error || !data) return <Problem message={(error as Error)?.message ?? 'Could not load this pool.'} />

  // ── Not published yet ───────────────────────────────────────────
  // A member arriving before the manager has published needs to be told
  // that plainly. An empty list would read as a broken app.
  if (!data.published) {
    return (
      <NotOpenYet poolName={data.pool.name} weekLabel={data.week.label} note={data.pool.managerNote} />
    )
  }

  const need = data.pool.picksRequired ?? data.slate.length
  const have = picks.size
  const keyChosen = [...picks.values()].some((p) => p.isKey)
  const wantsKey = data.pool.keyPick

  const toggleTeam = (game: ApiSlateGame, teamId: string) => {
    if (!game.open) return
    const next = new Map(picks)
    const current = next.get(game.gameId)
    if (current?.teamId === teamId) {
      next.delete(game.gameId)
    } else {
      if (!current && need != null && next.size >= need) return
      next.set(game.gameId, { teamId, isKey: current?.isKey ?? false })
    }
    commit(next)
  }

  const setKey = (gameId: string) => {
    const next = new Map(picks)
    const mine = next.get(gameId)
    if (!mine) return
    for (const [g, v] of next) next.set(g, { ...v, isKey: false })
    next.set(gameId, { ...mine, isKey: !mine.isKey })
    commit(next)
  }

  let lastDay = ''

  return (
    <div className="pb-40">
      <header className="px-4 pt-6 pb-4 border-b border-[var(--color-border)]">
        <Link
          to="/"
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; My pools
        </Link>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
          {data.week.label}
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight text-balance">{data.pool.name}</h1>
        {data.deadline ? (
          <p className="mt-2 text-[var(--color-muted-foreground)]">
            Picks close <b className="text-[var(--color-foreground)]">{kickoffLabel(data.deadline)}</b>
          </p>
        ) : null}
      </header>

      {data.entries.length > 1 ? (
        <EntryPicker
          entries={data.entries}
          active={activeEntry}
          onChange={(id) => {
            // Switching entries abandons the local draft — it belonged to
            // the other entry and was already saved on its own.
            setDraft(null)
            setEntryId(id)
          }}
        />
      ) : null}

      {data.pool.managerNote ? (
        <div className="mx-4 mt-4 rounded-xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-2">
            Note from the manager
          </h2>
          <Markdown source={data.pool.managerNote} />
        </div>
      ) : null}

      <p className="px-4 pt-6 pb-1 text-[1.05rem] font-bold">
        {data.pool.poolType === 'survivor'
          ? 'Pick one team.'
          : need === data.slate.length
            ? 'Pick a winner in every game.'
            : `Pick ${need} games.`}
      </p>
      {wantsKey ? (
        <p className="px-4 pb-2 text-[var(--color-muted-foreground)]">
          Then choose one as your key pick.
        </p>
      ) : null}

      {data.slate.map((game) => {
        const day = dayLabel(game.kickoffAt)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={game.gameId}>
            {showDay ? (
              <h2 className="mx-4 mt-6 mb-2 pb-1 text-[0.74rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                {day}
              </h2>
            ) : null}
            <GameCard
              game={game}
              picked={picks.get(game.gameId)}
              spreadMode={data.pool.spreadMode}
              wantsKey={wantsKey}
              atLimit={need != null && have >= need && !picks.has(game.gameId)}
              onPick={(teamId) => toggleTeam(game, teamId)}
              onKey={() => setKey(game.gameId)}
            />
          </div>
        )
      })}

      <StatusBar
        have={have}
        need={need}
        wantsKey={wantsKey}
        keyChosen={keyChosen}
        state={autoSave.state}
        error={autoSave.error}
        onRetry={autoSave.retry}
      />
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────

function EntryPicker({
  entries,
  active,
  onChange,
}: {
  entries: Array<{ id: string; entryName: string }>
  active: string | null
  onChange: (id: string) => void
}) {
  return (
    <div className="px-4 pt-4">
      <p className="text-[0.85rem] text-[var(--color-muted-foreground)] mb-2">
        You have {entries.length} entries in this pool. Picking for:
      </p>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <button
            key={e.id}
            onClick={() => onChange(e.id)}
            aria-pressed={e.id === active}
            className={
              'min-h-[var(--tap-target-min)] px-4 rounded-lg border-2 font-bold ' +
              (e.id === active
                ? 'bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]'
                : 'border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]')
            }
          >
            {e.entryName}
          </button>
        ))}
      </div>
    </div>
  )
}

function GameCard({
  game,
  picked,
  spreadMode,
  wantsKey,
  atLimit,
  onPick,
  onKey,
}: {
  game: ApiSlateGame
  picked?: { teamId: string; isKey: boolean }
  spreadMode: 'straight_up' | 'ats'
  wantsKey: boolean
  atLimit: boolean
  onPick: (teamId: string) => void
  onKey: () => void
}) {
  return (
    <article
      className={
        'mx-4 my-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden ' +
        (game.open ? '' : 'opacity-60')
      }
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[0.85rem] text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
        <span>{game.kickoffTbd ? 'Time to be announced' : kickoffLabel(game.kickoffAt)}</span>
        {!game.open ? (
          // Never colour alone — a padlock and the word, per WCAG 1.4.1.
          <span className="font-bold uppercase tracking-wider text-[0.72rem] text-[var(--color-locked)]">
            &#128274; Locked
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 p-2.5">
        <TeamButton
          team={game.away}
          spread={spreadMode === 'ats' ? teamSpread(game.spread, 'away') : null}
          selected={picked?.teamId === game.away?.id}
          disabled={!game.open || (atLimit && picked?.teamId !== game.away?.id)}
          onClick={() => game.away && onPick(game.away.id)}
        />
        <span className="self-center text-[0.8rem] font-bold text-[var(--color-muted-foreground)]">@</span>
        <TeamButton
          team={game.home}
          spread={spreadMode === 'ats' ? teamSpread(game.spread, 'home') : null}
          selected={picked?.teamId === game.home?.id}
          disabled={!game.open || (atLimit && picked?.teamId !== game.home?.id)}
          onClick={() => game.home && onPick(game.home.id)}
        />
      </div>

      {wantsKey && picked ? (
        <div className="border-t border-[var(--color-border)] p-2.5">
          <button
            onClick={onKey}
            aria-pressed={picked.isKey}
            className={
              'w-full min-h-[var(--tap-target-min)] rounded-lg font-bold tracking-wide ' +
              (picked.isKey
                ? 'bg-[var(--color-key)] text-[var(--color-background)] border-2 border-[var(--color-key)]'
                : 'border-2 border-dashed border-[var(--color-border-interactive)] text-[var(--color-muted-foreground)]')
            }
          >
            {picked.isKey ? '★ THIS IS MY KEY PICK' : '☆ Make this my key pick'}
          </button>
        </div>
      ) : null}
    </article>
  )
}

function TeamButton({
  team,
  spread,
  selected,
  disabled,
  onClick,
}: {
  team: ApiSlateGame['home']
  spread: string | null
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  if (!team) return <div />
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={
        'relative flex flex-col justify-center gap-0.5 min-h-16 py-2.5 pl-3.5 pr-2.5 rounded-lg border-2 text-left ' +
        (selected
          ? 'border-[var(--color-accent)] bg-[#0d2a1c]'
          : 'border-[var(--color-border-interactive)] bg-[var(--color-muted)]') +
        (disabled ? ' opacity-45' : '')
      }
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[5px] rounded-l-md"
        style={{ background: team.primaryColor ?? 'var(--color-border-interactive)' }}
      />
      <span className="font-bold">{team.nickname}</span>
      {spread ? (
        <span
          className={
            'font-mono font-bold tabular-nums ' +
            (selected ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted-foreground)]')
          }
        >
          {spread}
        </span>
      ) : null}
      {selected ? (
        <span className="absolute top-1.5 right-2 w-6 h-6 rounded-full bg-[var(--color-accent)] text-[var(--color-background)] font-black text-center leading-6">
          &#10003;
        </span>
      ) : null}
    </button>
  )
}

function StatusBar({
  have,
  need,
  wantsKey,
  keyChosen,
  state,
  error,
  onRetry,
}: {
  have: number
  need: number
  wantsKey: boolean
  keyChosen: boolean
  state: string
  error: string | null
  onRetry: () => void
}) {
  // A failed save is the one thing that can silently cost someone their
  // week now that there is no Save button, so it takes over the bar
  // entirely rather than sitting as a small warning.
  if (state === 'error') {
    return (
      <div className="fixed left-0 right-0 bottom-0 bg-[var(--color-pick-loss)] text-[var(--color-background)] p-4 flex items-center gap-3">
        <div className="flex-1">
          <b className="block text-[1.05rem]">Not saved</b>
          <span className="text-[0.85rem]">{error ?? 'Your last change did not save.'}</span>
        </div>
        <button
          onClick={onRetry}
          className="min-h-[var(--tap-target-min)] px-5 rounded-lg bg-[var(--color-background)] text-[var(--color-foreground)] font-bold"
        >
          Try again
        </button>
      </div>
    )
  }

  const done = have >= need && (!wantsKey || keyChosen)
  const detail =
    have < need
      ? `${need - have} to go`
      : wantsKey && !keyChosen
        ? 'Now choose your key pick'
        : state === 'saving'
          ? 'Saving…'
          : 'All saved — you can change these until the deadline'

  return (
    <div className="fixed left-0 right-0 bottom-0 bg-[var(--color-card)] border-t border-[var(--color-border-interactive)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <b className={'block text-[1.15rem] tabular-nums ' + (done ? 'text-[var(--color-accent)]' : '')}>
        {have} of {need} picks
      </b>
      <span className="text-[0.85rem] text-[var(--color-muted-foreground)]">{detail}</span>
    </div>
  )
}

function NotOpenYet({
  poolName,
  weekLabel,
  note,
}: {
  poolName: string
  weekLabel: string
  note: string | null
}) {
  return (
    <div className="px-4 py-12 flex flex-col gap-4">
      <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
        {weekLabel}
      </p>
      <h1 className="text-[1.7rem] font-extrabold leading-tight">{poolName}</h1>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p className="text-[1.05rem] font-bold mb-2">This week isn&rsquo;t open yet</p>
        <p className="text-[var(--color-muted-foreground)] leading-relaxed">
          The pool manager sets the spreads and opens picks each week. You&rsquo;ll get an
          email when it&rsquo;s time to pick.
        </p>
      </div>
      {note ? (
        <div className="rounded-xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <Markdown source={note} />
        </div>
      ) : null}
    </div>
  )
}

function Loading() {
  return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading your picks&hellip;</p>
}

function Problem({ message }: { message: string }) {
  return (
    <div className="px-4 py-12">
      <h1 className="text-[1.3rem] font-bold mb-2">Something went wrong</h1>
      <p className="text-[var(--color-muted-foreground)]">{message}</p>
    </div>
  )
}
