import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi, type ApiPick, type ApiSlateGame, type PicksResponse } from '@/lib/api/client'
import { kickoffLabel } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'

// The pool's front door, rebuilt around one question: what does a member
// need the moment they open it this week? The hero answers for the
// week's current state — pick, locked-in, live, or graded — and
// everything below it is glanceable context, not chrome.
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

  // Explicit second-entry flow: open the name field, name it, add. The
  // ONLY way an extra entry comes to exist.
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
  const myRows = (standings.data?.rows ?? []).filter((r) => r.isMine)
  const leader = standings.data?.rows[0]

  return (
    <div className="px-4 py-6 flex flex-col gap-5">
      <div>
        <Link
          to="/"
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; My pools
        </Link>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[1.7rem] font-extrabold leading-tight text-balance">
            {data.pool.name}
          </h1>
          <span className="shrink-0 text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
            {data.week.label}
          </span>
        </div>
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

      {/* ── The hero: one card per entry, tuned to the week's state ── */}
      {data.entries.map((e) => (
        <EntryHero
          key={e.id}
          data={data}
          entry={e}
          need={need}
          deadlinePassed={deadlinePassed}
          anyLive={anyLive}
          allFinal={allFinal}
          poolId={poolId}
          showName={data.entries.length > 1}
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

      {/* ── My standing strip ── */}
      {myRows.length > 0 && leader ? (
        <Link
          to={`/pool/${poolId}/standings`}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex items-center gap-4"
        >
          {myRows.slice(0, 1).map((r) => (
            <span key={r.entryId} className="flex-1 flex items-baseline gap-3 tabular-nums">
              <b className="text-[1.6rem]">#{r.rank}</b>
              <span className="text-[var(--color-muted-foreground)]">
                {r.totalPoints} pts
                {r.rank !== 1
                  ? ` · ${leader.totalPoints - r.totalPoints} behind the leader`
                  : ' · leading'}
              </span>
            </span>
          ))}
          <span className="text-[var(--color-accent)] font-bold">Standings &rsaquo;</span>
        </Link>
      ) : null}

      {/* ── Last week's recap ── */}
      {data.recaps.map((r) => (
        <div
          key={r.entryId}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        >
          <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)] mb-1">
            {r.weekLabel} result
          </p>
          <p className="text-[1.05rem] tabular-nums">
            <b>
              {r.correct}&ndash;{r.incorrect}
              {r.push ? <>&ndash;{r.push}</> : null}
            </b>{' '}
            · +{r.points} pts
            {r.rankChange != null && r.rankChange !== 0 ? (
              <span
                className={
                  'ml-2 font-bold ' +
                  (r.rankChange > 0
                    ? 'text-[var(--color-pick-win)]'
                    : 'text-[var(--color-pick-loss)]')
                }
              >
                {r.rankChange > 0 ? `▲ up ${r.rankChange}` : `▼ down ${-r.rankChange}`}
              </span>
            ) : null}
          </p>
        </div>
      ))}

      {/* ── Pool pulse ── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex items-center justify-between gap-3">
        <span className="tabular-nums">
          <b>
            {data.pulse.entriesComplete} of {data.pulse.entriesTotal}
          </b>{' '}
          <span className="text-[var(--color-muted-foreground)]">
            entries have their picks in
          </span>
        </span>
        {data.revealed ? (
          <Link to={`/pool/${poolId}/picks`} className="font-bold text-[var(--color-accent)]">
            See everyone&rsquo;s &rsaquo;
          </Link>
        ) : null}
      </div>

      {/* ── Admin card ── */}
      {data.manager ? (
        <div className="rounded-xl border border-[var(--color-key)] bg-[var(--color-card)] p-4 flex flex-col gap-2">
          <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-key)]">
            Admin
          </p>
          <p className="text-[var(--color-muted-foreground)]">
            {data.published
              ? `${data.week.label} is published${
                  data.deadline ? ` — picks close ${kickoffLabel(data.deadline)}` : ''
                }.`
              : `${data.week.label} is NOT published — members cannot pick until you publish.`}
            {!deadlinePassed && data.pulse.entriesComplete < data.pulse.entriesTotal
              ? ` ${data.pulse.entriesTotal - data.pulse.entriesComplete} still short.`
              : ''}
          </p>
          <Link
            to={`/lm/${poolId}/week`}
            className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-key)] font-bold text-[var(--color-key)]"
          >
            Manage this week
          </Link>
        </div>
      ) : null}

      {data.pool.managerNote ? (
        <div className="rounded-xl border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-card)] p-4">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-2">
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

      <Link
        to={`/pool/${poolId}/standings`}
        className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
      >
        Standings
      </Link>
    </div>
  )
}

// ── The state-aware hero card for one entry ─────────────────────────

function EntryHero({
  data,
  entry,
  need,
  deadlinePassed,
  anyLive,
  allFinal,
  poolId,
  showName,
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
  allFinal: boolean
  poolId: string
  showName: boolean
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
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
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
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-[1.05rem]">{entry.entryName}</b>
          <button
            onClick={onRenameStart}
            className="min-h-[var(--tap-target-min)] px-2 font-bold text-[0.85rem] text-[var(--color-accent)]"
          >
            Rename
          </button>
        </div>
      ) : null}

      {!deadlinePassed ? (
        // ── Picks open ──
        <>
          {entry.submittedAt && complete ? (
            <p className="text-[1.05rem]">
              <b className="text-[var(--color-accent)]">
                &#10003; Locked in — {mine.length} of {need}
                {data.pool.keyPick && hasKey ? (
                  <span className="text-[var(--color-key)]"> + key ★</span>
                ) : null}
              </b>
            </p>
          ) : (
            <p className="text-[1.05rem] tabular-nums">
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
          {data.deadline ? (
            <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
              Picks close <b>{kickoffLabel(data.deadline)}</b>
            </p>
          ) : null}
          <Link
            to={`/pool/${poolId}/picks`}
            className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold"
          >
            {mine.length === 0
              ? 'Make picks'
              : entry.submittedAt && complete
                ? 'View / change picks'
                : 'Finish my picks'}
          </Link>
        </>
      ) : (
        // ── Locked: live scores or results for MY games ──
        <>
          {anyAuto ? (
            <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
              Some picks were filled by the app at the deadline — they&rsquo;re marked
              below.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {mine.map((p) => (
              <PickChip key={p.id} pick={p} game={gameById.get(p.gameId)} />
            ))}
            {mine.length === 0 ? (
              <p className="text-[var(--color-muted-foreground)]">
                No picks made this week.
              </p>
            ) : null}
          </div>
          <Link
            to={`/pool/${poolId}/picks`}
            className="min-h-[var(--tap-target-min)] flex items-center justify-center rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
          >
            {anyLive ? 'Watch the week live' : allFinal ? 'See the full week' : 'See the week'}
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
  const myTeam =
    pick.selectedTeamId === game.home?.id ? game.home : game.away
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
