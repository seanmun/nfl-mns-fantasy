import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createApi, type ApiOtherPick, type ApiSlateGame, type SavePick } from '@/lib/api/client'
import { useAutoSave } from '@/hooks/useAutoSave'
import { kickoffLabel, dayLabel, teamSpread } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'
import { PoolTabBar } from '@/components/layout/PoolTabBar'

export function PoolPicks() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const qc = useQueryClient()

  // Undefined asks the server for the current week; the switcher below
  // sets a specific one.
  const [weekNo, setWeekNo] = useState<number | undefined>(undefined)
  const [entryId, setEntryId] = useState<string | null>(null)
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['picks', poolId, weekNo],
    queryFn: () => api.getPicks(poolId, weekNo),
    // Scores move on game day. A minute of staleness is fine; a screen
    // someone leaves open through the 1 o'clock games should not be.
    refetchInterval: 60_000,
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

  // Post-lock the page becomes a viewer with two tabs: the games (with
  // scores and pick counts) and the entries (everyone's picks, in
  // standings order).
  const [tab, setTab] = useState<'games' | 'entries'>('games')
  const standings = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
    enabled: data?.revealed === true,
  })

  const mutation = useMutation({
    mutationFn: (value: SavePick[]) =>
      api.savePicks(poolId, activeEntry!, data!.week.week, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picks', poolId] }),
  })

  const submit = useMutation({
    mutationFn: () => api.submitPicks(poolId, activeEntry!, data!.week.week),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picks', poolId] })
      navigate(`/pool/${poolId}`, { state: { justSubmitted: true } })
    },
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

  const switchWeek = (n: number) => {
    setDraft(null)
    setWeekNo(n)
  }

  // Rendered on BOTH branches below — an unpublished week must still
  // carry the switcher, or whoever pages into it is stranded there.
  const pageHeader = (
    <header className="px-4 pt-6 pb-4 border-b border-[var(--color-border)]">
      <Link
        to="/"
        className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
      >
        &larr; My pools
      </Link>
      <div className="flex items-center gap-1">
        <button
          onClick={() => switchWeek(data.week.week - 1)}
          disabled={data.week.week <= data.pool.startWeek}
          aria-label="Previous week"
          className="min-h-[var(--tap-target-min)] min-w-[var(--tap-target-min)] rounded-lg font-black text-[var(--color-accent)] disabled:opacity-30"
        >
          &lsaquo;
        </button>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
          {data.week.label}
        </p>
        <button
          onClick={() => switchWeek(data.week.week + 1)}
          disabled={data.week.week >= data.pool.endWeek}
          aria-label="Next week"
          className="min-h-[var(--tap-target-min)] min-w-[var(--tap-target-min)] rounded-lg font-black text-[var(--color-accent)] disabled:opacity-30"
        >
          &rsaquo;
        </button>
      </div>
      <h1 className="text-[1.7rem] font-extrabold leading-tight text-balance">{data.pool.name}</h1>
      {data.deadline ? (
        <p className="mt-2 text-[var(--color-muted-foreground)]">
          Picks close <b className="text-[var(--color-foreground)]">{kickoffLabel(data.deadline)}</b>
        </p>
      ) : null}
    </header>
  )

  // ── Not published yet ───────────────────────────────────────────
  // A member arriving before the manager has published needs to be told
  // that plainly. An empty list would read as a broken app.
  if (!data.published) {
    return (
      <div className="pb-28">
        {pageHeader}
        <NotOpenYet note={data.pool.managerNote} />
        <PoolTabBar />
      </div>
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

  // How many entries took each side — only meaningful (and only shown)
  // once the reveal is open.
  const countsByGame = new Map<string, Map<string, number>>()
  if (data.revealed) {
    for (const p of data.others) {
      const g = countsByGame.get(p.gameId) ?? new Map<string, number>()
      g.set(p.selectedTeamId, (g.get(p.selectedTeamId) ?? 0) + 1)
      countsByGame.set(p.gameId, g)
    }
  }

  let lastDay = ''

  return (
    <div className="pb-56">
      {pageHeader}

      {!data.revealed ? (
        // The one instruction, stated instead of implied.
        <p className="mx-4 mt-4 rounded-lg border-l-4 border-[var(--color-accent)] bg-[var(--color-card)] px-3 py-2 font-semibold">
          Pick {data.pool.poolType === 'survivor' ? 'one team' : need === data.slate.length ? 'every game' : `${need} games`}
          {wantsKey ? ', star ★ your surest one' : ''}, then tap{' '}
          <b className="text-[var(--color-accent)]">Submit</b>.
        </p>
      ) : null}

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


      {data.revealed ? (
        // Locked week: viewing, not picking. Tabs replace instructions.
        <div className="px-4 pt-5 flex gap-2" role="tablist" aria-label="Week views">
          {(
            [
              ['games', 'Games'],
              ['entries', 'Entries'],
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
      ) : (
        <>
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
        </>
      )}

      {data.revealed && tab === 'entries' ? (
        <Reveal
          others={data.others}
          slate={data.slate}
          rankByEntry={
            new Map((standings.data?.rows ?? []).map((r) => [r.entryId, r.rank]))
          }
        />
      ) : null}

      {(!data.revealed || tab === 'games') && data.slate.map((game) => {
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
              counts={countsByGame.get(game.gameId) ?? null}
              onPick={(teamId) => toggleTeam(game, teamId)}
              onKey={() => setKey(game.gameId)}
            />
          </div>
        )
      })}

      {/* The tick refreshes scores on this cadence; saying so stops
          "why is my score stale" messages to the manager. */}
      {data.slate.some((g) => g.status === 'in_progress') ? (
        <p className="px-4 pt-4 text-[0.85rem] text-[var(--color-muted-foreground)]">
          Scores update about every 15 minutes.
        </p>
      ) : null}

      {/* Once the week is locked there is nothing to save or submit —
          the bar would only cover content. */}
      {!data.revealed ? (
        <StatusBar
          have={have}
          need={need}
          wantsKey={wantsKey}
          keyChosen={keyChosen}
          state={autoSave.state}
          error={autoSave.error}
          onRetry={autoSave.retry}
          submitted={
            // A local draft means edits since load; the server clears the
            // stamp on save, so treat any draft as not-submitted rather
            // than showing a stale "Submitted" over changed picks.
            draft == null && !!data.entries.find((e) => e.id === activeEntry)?.submittedAt
          }
          submitting={submit.isPending}
          onSubmit={() => submit.mutate()}
          submitError={submit.error ? (submit.error as Error).message : null}
        />
      ) : null}

      <PoolTabBar />
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
  counts,
  onPick,
  onKey,
}: {
  game: ApiSlateGame
  picked?: { teamId: string; isKey: boolean }
  spreadMode: 'straight_up' | 'ats'
  wantsKey: boolean
  atLimit: boolean
  // Entries on each side, post-reveal only; null before the deadline.
  counts: Map<string, number> | null
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
        {game.status === 'in_progress' || game.status === 'final' ? (
          // Kickoff time gives way to the score once there is one.
          <span className="font-mono font-bold tabular-nums text-[var(--color-foreground)]">
            {game.away?.nickname} {game.awayScore ?? 0} &ndash; {game.homeScore ?? 0}{' '}
            {game.home?.nickname}
            <span
              className={
                'ml-2 uppercase tracking-wider text-[0.72rem] ' +
                (game.status === 'final'
                  ? 'text-[var(--color-muted-foreground)]'
                  : 'text-[var(--color-accent)]')
              }
            >
              {game.status === 'final' ? 'Final' : 'Live'}
            </span>
          </span>
        ) : game.status === 'postponed' || game.status === 'cancelled' ? (
          <span className="font-bold uppercase tracking-wider text-[0.72rem]">{game.status}</span>
        ) : (
          <span>{game.kickoffTbd ? 'Time to be announced' : kickoffLabel(game.kickoffAt)}</span>
        )}
        {game.offBoard ? (
          <span className="font-bold uppercase tracking-wider text-[0.72rem] text-[var(--color-key)]">
            Off the board
          </span>
        ) : !game.open ? (
          // Never colour alone — a padlock and the word, per WCAG 1.4.1.
          <span className="font-bold uppercase tracking-wider text-[0.72rem] text-[var(--color-locked)]">
            &#128274; Locked
          </span>
        ) : null}
      </div>

      {(() => {
        // FAVORITE on the left, underdog on the right, home carried by
        // the connector: "Giants at Eagles +3" = Eagles home AND dog.
        // Straight-up pools (and pick 'em lines) stay away-at-home.
        const homeFav = spreadMode === 'ats' && game.spread != null && game.spread < 0
        const left = homeFav ? game.home : game.away
        const right = homeFav ? game.away : game.home
        const leftSide: 'home' | 'away' = homeFav ? 'home' : 'away'
        const rightSide: 'home' | 'away' = homeFav ? 'away' : 'home'
        // Right side is home → the left team travels: "at". Otherwise
        // the favorite hosts: "vs".
        const connector = rightSide === 'home' ? 'at' : 'vs'
        const btn = (team: typeof left, side: 'home' | 'away') => (
          <TeamButton
            team={team}
            spread={
              spreadMode === 'ats' && !game.offBoard ? teamSpread(game.spread, side) : null
            }
            selected={picked?.teamId === team?.id}
            disabled={!game.open || (atLimit && picked?.teamId !== team?.id)}
            pickCount={counts && team ? counts.get(team.id) ?? 0 : null}
            onClick={() => team && onPick(team.id)}
          />
        )
        return (
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 p-2.5">
            {btn(left, leftSide)}
            <span className="self-center text-[0.8rem] font-bold text-[var(--color-muted-foreground)]">
              {connector}
            </span>
            {btn(right, rightSide)}
          </div>
        )
      })()}

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
  pickCount,
  onClick,
}: {
  team: ApiSlateGame['home']
  spread: string | null
  selected: boolean
  disabled: boolean
  // Post-reveal: how many entries took this side. Null pre-deadline —
  // showing the split while picks are open would tilt the picking.
  pickCount: number | null
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
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
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
      {pickCount != null ? (
        <span className="text-[0.78rem] text-[var(--color-muted-foreground)] tabular-nums">
          {pickCount === 1 ? '1 entry picked' : `${pickCount} entries picked`}
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
  submitted,
  submitting,
  onSubmit,
  submitError,
}: {
  have: number
  need: number
  wantsKey: boolean
  keyChosen: boolean
  state: string
  error: string | null
  onRetry: () => void
  submitted: boolean
  submitting: boolean
  onSubmit: () => void
  submitError: string | null
}) {
  // A failed save is the one thing that can silently cost someone their
  // week now that there is no Save button, so it takes over the bar
  // entirely rather than sitting as a small warning.
  if (state === 'error') {
    return (
      <div className="fixed left-0 right-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 bg-[var(--color-pick-loss)] text-[var(--color-background)] p-4 flex items-center gap-3">
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
          : submitted
            ? 'Submitted. Change anything and you will need to resubmit.'
            : 'All saved — now submit to lock them in'

  return (
    <div className="fixed left-0 right-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 bg-[var(--color-card)] border-t border-[var(--color-border-interactive)] px-4 py-3 flex items-center gap-3">
      <div className="flex-1">
        <b className={'block text-[1.15rem] tabular-nums ' + (done ? 'text-[var(--color-accent)]' : '')}>
          {have} of {need} picks
          {submitted ? <span className="ml-2 text-[var(--color-accent)]">&#10003; Submitted</span> : null}
        </b>
        <span className="text-[0.85rem] text-[var(--color-muted-foreground)]">
          {submitError ?? detail}
        </span>
      </div>
      {done && !submitted ? (
        <button
          onClick={onSubmit}
          disabled={submitting || state === 'saving'}
          className="min-h-[var(--tap-target-min)] px-6 rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit picks'}
        </button>
      ) : null}
    </div>
  )
}

// The post-deadline reveal — everyone's picks, one row per entry. Only
// rendered when the server says so; before the deadline `others` is
// empty by design and this section simply is not there.
function Reveal({
  others,
  slate,
  rankByEntry,
}: {
  others: ApiOtherPick[]
  slate: ApiSlateGame[]
  rankByEntry: Map<string, number>
}) {
  const nickById = new Map<string, string>()
  for (const g of slate) {
    if (g.home) nickById.set(g.home.id, g.home.nickname)
    if (g.away) nickById.set(g.away.id, g.away.nickname)
  }

  const byEntry = new Map<
    string,
    { id: string; name: string; owner: string | null; email: string | null; picks: ApiOtherPick[] }
  >()
  for (const p of others) {
    const e =
      byEntry.get(p.entryId) ??
      { id: p.entryId, name: p.entryName, owner: p.ownerName, email: p.ownerEmail, picks: [] }
    e.picks.push(p)
    byEntry.set(p.entryId, e)
  }
  // Standings order — the leaderboard is the pool's one true ordering.
  // Name order only breaks ties (and carries the pre-grading start).
  const entries = [...byEntry.values()].sort((a, b) => {
    const ra = rankByEntry.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rankByEntry.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name)
  })

  const badge = (r: ApiOtherPick['result']) =>
    r === 'win' ? ['W', 'var(--color-pick-win)'] :
    r === 'loss' ? ['L', 'var(--color-pick-loss)'] :
    r === 'push' ? ['P', 'var(--color-pick-push)'] : null

  return (
    <section className="mt-8 border-t-2 border-[var(--color-border-interactive)]">
      <div className="px-4 pt-5 pb-1">
        <h2 className="text-[1.05rem] font-bold">Everyone&rsquo;s picks</h2>
        <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
          Revealed now that picks are closed.
        </p>
      </div>
      <ul className="px-4 py-3 flex flex-col gap-3">
        {entries.map((e) => (
          <li
            key={e.id}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3"
          >
            <b className="block">
              {rankByEntry.has(e.id) ? (
                <span className="mr-2 text-[var(--color-muted-foreground)] tabular-nums">
                  {rankByEntry.get(e.id)}.
                </span>
              ) : null}
              {e.name}
            </b>
            <span className="block text-[0.8rem] text-[var(--color-muted-foreground)]">
              {/* Owner's username — public, so shared ownership shows.
                  Email rides along for the manager only. */}
              {e.owner ?? ''}
              {e.email ? ` · ${e.email}` : ''}
            </span>
            {/* One dot per pick: won, lost, pushed, or still to play —
                the week at a glance before reading a single chip. The
                key pick wears a ring. Colour never stands alone; the
                chips below carry the letters. */}
            <span className="flex items-center gap-1.5 mb-2 mt-1" aria-hidden="true">
              {e.picks.map((p) => {
                const fill =
                  p.result === 'win'
                    ? 'var(--color-pick-win)'
                    : p.result === 'loss'
                      ? 'var(--color-pick-loss)'
                      : p.result === 'push'
                        ? 'var(--color-pick-push)'
                        : 'var(--color-border-interactive)'
                return (
                  <span
                    key={p.gameId}
                    className="inline-block rounded-full"
                    style={{
                      width: '0.65rem',
                      height: '0.65rem',
                      background: fill,
                      boxShadow: p.isKeyPick ? `0 0 0 2px var(--color-card), 0 0 0 4px ${fill}` : undefined,
                    }}
                  />
                )
              })}
              <span className="ml-1 text-[0.78rem] text-[var(--color-muted-foreground)] tabular-nums">
                {e.picks.reduce((n, p) => n + p.pointsEarned, 0)} pts ·{' '}
                {e.picks.filter((p) => p.result === 'pending').length} to play
              </span>
            </span>
            <div className="flex flex-wrap gap-2">
              {e.picks.map((p) => {
                const b = badge(p.result)
                return (
                  <span
                    key={p.gameId}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-interactive)] px-2.5 py-1.5 font-bold text-[0.95rem]"
                  >
                    {p.isKeyPick ? (
                      <span aria-label="key pick" className="text-[var(--color-key)]">★</span>
                    ) : null}
                    {nickById.get(p.selectedTeamId) ?? p.selectedTeamId}
                    {b ? (
                      // Letter plus colour, never colour alone.
                      <b style={{ color: b[1] }}>{b[0]}</b>
                    ) : null}
                    {p.isAuto ? (
                      <span className="text-[0.72rem] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                        auto
                      </span>
                    ) : null}
                  </span>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NotOpenYet({ note }: { note: string | null }) {
  return (
    <div className="px-4 py-8 flex flex-col gap-4">
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
