import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createApi,
  type ApiPick,
  type ApiSlateGame,
  type PicksResponse,
  type StandingsRow,
} from '@/lib/api/client'
import { kickoffLabel } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'

// The pool's front door. One hero per entry carries the week's answer —
// pick, locked in, live, graded — with the entry's rank riding on it.
// Below: one row of three stat tiles, then admin, note, actions. Info
// appears exactly once; the hero is visually the loudest thing here.
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

  const standings = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
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

  // Explicit second-entry flow — the ONLY way an extra entry exists.
  const [addingName, setAddingName] = useState<string | null>(null)
  const addEntry = useMutation({
    mutationFn: (name: string) => api.joinPool({ poolId, addEntry: true, entryName: name }),
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
  const deadlinePassed = data.deadline ? new Date() >= new Date(data.deadline) : false
  const anyLive = data.slate.some((g) => g.status === 'in_progress')
  const allFinal =
    data.slate.length > 0 &&
    data.slate.every((g) => g.status === 'final' || g.status === 'cancelled')
  const rowByEntry = new Map<string, StandingsRow>(
    (standings.data?.rows ?? []).map((r) => [r.entryId, r])
  )
  const leader = standings.data?.rows[0]
  const myBest = data.entries
    .map((e) => rowByEntry.get(e.id))
    .filter((r): r is StandingsRow => !!r)
    .sort((a, b) => a.rank - b.rank)[0]
  const recap = data.recaps[0] ?? null

  // The week's one status line — everything else stops repeating it.
  const statusLine = !data.published
    ? 'Not open yet — waiting on the manager'
    : anyLive
      ? 'Games are LIVE'
      : allFinal && deadlinePassed
        ? 'Week final'
        : deadlinePassed
          ? 'Picks are locked'
          : data.deadline
            ? `Picks close ${kickoffLabel(data.deadline)}`
            : 'Picks are open'

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
      {/* ── Header: title once, week once, state once ── */}
      <div>
        <Link
          to="/"
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; My pools
        </Link>
        <h1 className="text-[1.7rem] font-extrabold leading-tight text-balance">
          {data.pool.name}
        </h1>
        <p className="mt-1 text-[1.05rem]">
          <span className="font-bold text-[var(--color-accent)] uppercase tracking-[0.1em] text-[0.8rem]">
            {data.week.label}
          </span>
          <span className="mx-2 text-[var(--color-border-interactive)]">|</span>
          <span
            className={
              anyLive
                ? 'font-bold text-[var(--color-pick-win)]'
                : 'text-[var(--color-muted-foreground)]'
            }
          >
            {statusLine}
          </span>
        </p>
      </div>

      {justSubmitted ? (
        <div className="rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <b className="text-[1.05rem] text-[var(--color-accent)]">&#10003; Picks submitted</b>
          <p className="text-[var(--color-muted-foreground)] mt-1">
            You&rsquo;re locked in for {data.week.label}. Change your mind any time before
            the deadline — just resubmit after.
          </p>
        </div>
      ) : null}

      {/* ── HERO ── */}
      {data.entries.map((e) => (
        <EntryHero
          key={e.id}
          data={data}
          entry={e}
          need={need}
          deadlinePassed={deadlinePassed}
          anyLive={anyLive}
          standing={rowByEntry.get(e.id) ?? null}
          poolId={poolId}
          renaming={renaming?.id === e.id ? renaming : null}
          onRenameStart={() => setRenaming({ id: e.id, value: e.entryName })}
          onRenameChange={(v) => setRenaming({ id: e.id, value: v })}
          onRenameSave={() =>
            renaming && rename.mutate({ id: e.id, value: renaming.value.trim() })
          }
          onRenameCancel={() => setRenaming(null)}
          renamePending={rename.isPending}
        />
      ))}

      {/* ── Stat tiles: rank · last week · picks in ── */}
      <div className="grid grid-cols-3 gap-2">
        <Link
          to={`/pool/${poolId}/standings`}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col gap-0.5"
        >
          <span className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-muted-foreground)]">
            Rank
          </span>
          <b className="text-[1.5rem] leading-none tabular-nums">
            {myBest ? `#${myBest.rank}` : '—'}
          </b>
          <span className="text-[0.78rem] text-[var(--color-muted-foreground)]">
            {myBest && leader
              ? myBest.rank === 1
                ? 'leading'
                : `${leader.totalPoints - myBest.totalPoints} behind`
              : ''}
          </span>
        </Link>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col gap-0.5">
          <span className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-muted-foreground)]">
            Last week
          </span>
          <b className="text-[1.5rem] leading-none tabular-nums">
            {recap ? `${recap.correct}–${recap.incorrect}` : '—'}
          </b>
          <span className="text-[0.78rem] text-[var(--color-muted-foreground)]">
            {recap ? (
              <>
                +{recap.points} pts
                {recap.rankChange != null && recap.rankChange !== 0 ? (
                  <b
                    className={
                      recap.rankChange > 0
                        ? ' text-[var(--color-pick-win)]'
                        : ' text-[var(--color-pick-loss)]'
                    }
                  >
                    {' '}
                    {recap.rankChange > 0 ? `▲${recap.rankChange}` : `▼${-recap.rankChange}`}
                  </b>
                ) : null}
              </>
            ) : (
              'nothing graded yet'
            )}
          </span>
        </div>

        <Link
          to={`/pool/${poolId}/picks`}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col gap-0.5"
        >
          <span className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-muted-foreground)]">
            Picks in
          </span>
          <b className="text-[1.5rem] leading-none tabular-nums">
            {data.pulse.entriesComplete}/{data.pulse.entriesTotal}
          </b>
          <span className="text-[0.78rem] text-[var(--color-accent)] font-bold">
            {data.revealed ? 'see everyone’s ›' : 'entries'}
          </span>
        </Link>
      </div>

      {/* ── Admin ── */}
      {data.manager ? (
        <div className="rounded-xl border border-[var(--color-key)] bg-[var(--color-card)] p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-key)]">
              Admin
            </p>
            <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
              {data.published ? 'Published' : 'NOT published'}
              {!deadlinePassed && data.pulse.entriesComplete < data.pulse.entriesTotal
                ? ` · ${data.pulse.entriesTotal - data.pulse.entriesComplete} short on picks`
                : ''}
            </p>
          </div>
          <Link
            to={`/lm/${poolId}/week`}
            className="shrink-0 min-h-[var(--tap-target-min)] px-4 flex items-center rounded-lg border-2 border-[var(--color-key)] font-bold text-[var(--color-key)]"
          >
            Manage
          </Link>
        </div>
      ) : null}

      {data.pool.managerNote ? (
        <div className="rounded-xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <h2 className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-accent)] mb-2">
            Note from the manager
          </h2>
          <Markdown source={data.pool.managerNote} />
        </div>
      ) : null}

      {/* Second entries are explicit and named — never a side effect. */}
      {data.pool.maxEntriesPerUser == null ||
      data.entries.length < data.pool.maxEntriesPerUser ? (
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
    </div>
  )
}

// ── The hero card for one entry ─────────────────────────────────────
// Accent-edged and the biggest thing on the page. Carries the entry's
// name, its rank, and the week's state for THIS entry.

function EntryHero({
  data,
  entry,
  need,
  deadlinePassed,
  anyLive,
  standing,
  poolId,
  renaming,
  onRenameStart,
  onRenameChange,
  onRenameSave,
  onRenameCancel,
  renamePending,
}: {
  data: PicksResponse
  entry: PicksResponse['entries'][number]
  need: number
  deadlinePassed: boolean
  anyLive: boolean
  standing: StandingsRow | null
  poolId: string
  renaming: { id: string; value: string } | null
  onRenameStart: () => void
  onRenameChange: (v: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  renamePending: boolean
}) {
  const mine = data.myPicks.filter((p) => p.entryId === entry.id)
  const hasKey = mine.some((p) => p.isKeyPick)
  const anyAuto = mine.some((p) => p.isAuto)
  const complete = mine.length >= need && (!data.pool.keyPick || hasKey)
  const gameById = new Map(data.slate.map((g) => [g.gameId, g]))

  return (
    <div className="rounded-xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
      {renaming ? (
        <div className="flex gap-2">
          <input
            value={renaming.value}
            onChange={(ev) => onRenameChange(ev.target.value)}
            maxLength={40}
            autoFocus
            className="flex-1 min-h-[var(--tap-target-min)] px-3 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)]"
          />
          <button
            onClick={onRenameSave}
            disabled={!renaming.value.trim() || renamePending}
            className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-bold disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={onRenameCancel}
            className="min-h-[var(--tap-target-min)] px-3 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-baseline gap-2 min-w-0">
            <b className="text-[1.25rem] truncate">{entry.entryName}</b>
            {standing ? (
              <span className="shrink-0 text-[0.9rem] text-[var(--color-muted-foreground)] tabular-nums">
                #{standing.rank} · {standing.totalPoints} pts
              </span>
            ) : null}
          </span>
          <button
            onClick={onRenameStart}
            aria-label={`Rename ${entry.entryName}`}
            className="shrink-0 min-h-[var(--tap-target-min)] px-2 font-bold text-[0.85rem] text-[var(--color-muted-foreground)]"
          >
            &#9998; Rename
          </button>
        </div>
      )}

      {!deadlinePassed && data.published ? (
        // ── Picks open ──
        <>
          {entry.submittedAt && complete ? (
            <p className="text-[1.15rem]">
              <b className="text-[var(--color-accent)]">
                &#10003; Locked in — {mine.length} of {need}
                {data.pool.keyPick && hasKey ? (
                  <span className="text-[var(--color-key)]"> + key ★</span>
                ) : null}
              </b>
            </p>
          ) : (
            <p className="text-[1.15rem] tabular-nums">
              {mine.length === 0 ? (
                <b className="text-[var(--color-pick-loss)]">No picks in yet</b>
              ) : (
                <b>
                  {mine.length} of {need} picks in
                  {complete ? ' — not submitted yet' : ''}
                </b>
              )}
            </p>
          )}
          <Link
            to={`/pool/${poolId}/picks`}
            className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold text-[1.05rem]"
          >
            {mine.length === 0
              ? 'Make my picks'
              : entry.submittedAt && complete
                ? 'View / change picks'
                : 'Finish my picks'}
          </Link>
        </>
      ) : !data.published ? (
        <p className="text-[var(--color-muted-foreground)]">
          The manager hasn&rsquo;t opened this week yet — you&rsquo;ll get an email when
          picks are on.
        </p>
      ) : (
        // ── Locked: live scores or results for MY games ──
        <>
          {anyAuto ? (
            <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
              Some picks were filled by the app at the deadline — marked below.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {mine.map((p) => (
              <PickChip key={p.id} pick={p} game={gameById.get(p.gameId)} />
            ))}
            {mine.length === 0 ? (
              <p className="text-[var(--color-muted-foreground)]">No picks made this week.</p>
            ) : null}
          </div>
          <Link
            to={`/pool/${poolId}/picks`}
            className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
          >
            {anyLive ? 'Watch the week live' : 'See the full week'}
          </Link>
        </>
      )}
    </div>
  )
}

// One picked game as a live chip: my team, the score, and whether the
// pick is winning right now (or won). Colour never carries the meaning
// alone — the state word is always printed.
function PickChip({ pick, game }: { pick: ApiPick; game: ApiSlateGame | undefined }) {
  if (!game) return null
  const myTeam = pick.selectedTeamId === game.home?.id ? game.home : game.away
  const oppTeam = pick.selectedTeamId === game.home?.id ? game.away : game.home
  const myScore = pick.selectedTeamId === game.home?.id ? game.homeScore : game.awayScore
  const oppScore = pick.selectedTeamId === game.home?.id ? game.awayScore : game.homeScore

  let state: { word: string; cls: string } | null = null
  if (pick.result === 'win') state = { word: 'WON', cls: 'text-[var(--color-pick-win)]' }
  else if (pick.result === 'loss') state = { word: 'LOST', cls: 'text-[var(--color-pick-loss)]' }
  else if (pick.result === 'push') state = { word: 'PUSH', cls: 'text-[var(--color-pick-push)]' }
  else if (game.status === 'in_progress' && myScore != null && oppScore != null) {
    state =
      myScore > oppScore
        ? { word: 'AHEAD', cls: 'text-[var(--color-pick-win)]' }
        : myScore < oppScore
          ? { word: 'BEHIND', cls: 'text-[var(--color-pick-loss)]' }
          : { word: 'TIED', cls: 'text-[var(--color-pick-push)]' }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-muted)] px-3 py-2 tabular-nums">
      <span className="font-bold">
        {pick.isKeyPick ? <span className="text-[var(--color-key)]">★ </span> : null}
        {myTeam?.nickname ?? pick.selectedTeamId}
        {pick.isAuto ? (
          <span className="ml-1.5 text-[0.7rem] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            auto
          </span>
        ) : null}
      </span>
      <span className="text-[0.95rem] text-[var(--color-muted-foreground)]">
        {game.status === 'scheduled'
          ? kickoffLabel(game.kickoffAt)
          : `${myScore ?? 0}–${oppScore ?? 0} ${oppTeam ? `vs ${oppTeam.nickname}` : ''}`}
        {state ? <b className={`ml-2 ${state.cls}`}>{state.word}</b> : null}
        {game.status === 'in_progress' ? (
          <span className="ml-1 text-[0.72rem] uppercase tracking-wider text-[var(--color-accent)]">
            live
          </span>
        ) : null}
      </span>
    </div>
  )
}
