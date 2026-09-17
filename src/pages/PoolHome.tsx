import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Lock, Star, Unlock } from 'lucide-react'
import {
  createApi,
  type ApiPick,
  type ApiSlateGame,
  type PicksResponse,
  type StandingsRow,
} from '@/lib/api/client'
import { kickoffLabel, pickStanding, teamSpread, TONE_COLOR } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'
import { PoolTabBar } from '@/components/layout/PoolTabBar'
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  StatTile,
} from '@/ui/components'

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
    return (
      <div className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-3">
        <Skeleton h="2.2rem" w="70%" />
        <Skeleton h="9rem" />
        <Skeleton h="5rem" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <EmptyState title="Something went wrong">
        {(error as Error)?.message ?? 'Could not load this pool.'}
      </EmptyState>
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
    <div className="max-w-xl mx-auto w-full px-4 py-6 pb-28 flex flex-col gap-4">
      {/* ── Header: title once, week once, state once ── */}
      <PageHeader
        back="/"
        backLabel="My pools"
        backState={{ stay: true }}
        eyebrow={data.week.label}
        title={data.pool.name}
        status={
          <span className={anyLive ? 'font-bold text-[var(--color-pick-win)]' : undefined}>
            {statusLine}
          </span>
        }
      />

      {justSubmitted ? (
        <Banner tone="ok">
          <b className="inline-flex items-center gap-1 text-[var(--color-accent)]">
            <Check size={18} aria-hidden="true" /> Picks submitted
          </b> — you&rsquo;re
          locked in for {data.week.label}. Change your mind any time before the deadline,
          just resubmit after.
        </Banner>
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
        <StatTile
          label="Standings"
          value={myBest ? `#${myBest.rank}` : '—'}
          to={`/pool/${poolId}/standings`}
          sub={
            myBest && leader
              ? myBest.rank === 1
                ? 'my rank · leading'
                : `my rank · ${leader.totalPoints - myBest.totalPoints} behind`
              : ''
          }
        />

        <StatTile
          label="Last week"
          value={recap ? `${recap.correct}–${recap.incorrect}` : '—'}
          sub={
            recap ? (
              <>
                +{recap.points} pts
                {recap.rankChange != null && recap.rankChange !== 0 ? (
                  <b
                    className={
                      'inline-flex items-center align-[-0.15em] ' +
                      (recap.rankChange > 0
                        ? 'text-[var(--color-pick-win)]'
                        : 'text-[var(--color-pick-loss)]')
                    }
                  >
                    {recap.rankChange > 0 ? (
                      <ArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <ArrowDown size={14} aria-hidden="true" />
                    )}
                    {Math.abs(recap.rankChange)}
                  </b>
                ) : null}
              </>
            ) : (
              'nothing graded yet'
            )
          }
        />

        <StatTile
          label="Picks in"
          value={`${data.pulse.entriesComplete}/${data.pulse.entriesTotal}`}
          to={`/pool/${poolId}/picks`}
          sub={
            <span className="text-[var(--color-accent)] font-bold">
              {data.revealed ? 'see everyone’s ›' : 'entries'}
            </span>
          }
        />
      </div>

      {/* ── Admin ── */}
      {data.manager ? <AdminCard poolId={poolId} deadlinePassed={deadlinePassed} /> : null}

      {data.pool.managerNote ? (
        <Card hero>
          <h2 className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-accent)] mb-2">
            Note from the manager
          </h2>
          <Markdown source={data.pool.managerNote} />
        </Card>
      ) : null}

      {/* Second entries are explicit and named — never a side effect.
          Gone once the pool is closed to new entries. */}
      {data.pool.entriesOpen &&
      (data.pool.maxEntriesPerUser == null ||
        data.entries.length < data.pool.maxEntriesPerUser) ? (
        addingName == null ? (
          <button
            onClick={() => setAddingName('')}
            className="min-h-[var(--tap-target-min)] rounded-lg border-2 border-dashed border-[var(--color-border-interactive)] font-bold text-[var(--color-muted-foreground)]"
          >
            + Add another entry
          </button>
        ) : (
          <Card className="flex flex-col gap-3">
            <Field
              label="Name the new entry"
              hint="It competes on its own — its own picks, its own leaderboard row. Your username shows under it."
              htmlFor="new-entry-name"
            >
              <input
                id="new-entry-name"
                value={addingName}
                onChange={(e) => setAddingName(e.target.value)}
                placeholder="e.g. My upset special"
                maxLength={40}
                className="mns-input"
              />
            </Field>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => addEntry.mutate(addingName.trim())}
                disabled={!addingName.trim() || addEntry.isPending}
              >
                {addEntry.isPending ? 'Adding…' : 'Add entry'}
              </Button>
              <Button variant="quiet" onClick={() => setAddingName(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )
      ) : null}

      <PoolTabBar />
    </div>
  )
}

// ── The admin card ──────────────────────────────────────────────────
// Summary-first: a pool can hold 180 entries, so this is counts with
// the detail folded behind a tap, never a wall of rows.

function AdminCard({ poolId, deadlinePassed }: { poolId: string; deadlinePassed: boolean }) {
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const [showShort, setShowShort] = useState(false)
  const [confirmRemind, setConfirmRemind] = useState(false)

  const { data: pulse } = useQuery({
    queryKey: ['admin-pulse', poolId],
    queryFn: () => api.getAdminPulse(poolId),
    refetchInterval: 60_000,
  })

  const remind = useMutation({
    mutationFn: () => api.remindNow(poolId),
    onSuccess: (r) => {
      setConfirmRemind(false)
      toast.success(`Reminder sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`)
    },
    onError: (e: Error) => {
      setConfirmRemind(false)
      toast.error(e.message)
    },
  })

  if (!pulse) return null

  const problems: string[] = []
  if (!pulse.published) problems.push('not published')
  if (pulse.readiness.spreadsMissing > 0)
    problems.push(`${pulse.readiness.spreadsMissing} spreads missing`)
  if (pulse.gradingPending > 0) problems.push(`${pulse.gradingPending} picks ungraded`)

  return (
    <Card admin className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-[var(--color-key)]">
            Admin · {pulse.week.label}
          </p>
          <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
            {pulse.published
              ? `Published · ${pulse.readiness.gamesIncluded} games in play`
              : `${pulse.readiness.gamesIncluded} games ticked — not published`}
            {problems.length ? (
              <b className="text-[var(--color-pick-loss)]"> · {problems.join(' · ')}</b>
            ) : pulse.published ? (
              <span className="text-[var(--color-pick-win)]"> · all good</span>
            ) : null}
          </p>
        </div>
        <Link
          to={`/lm/${poolId}/week`}
          className="shrink-0 min-h-[var(--tap-target-min)] px-4 flex items-center rounded-lg border-2 border-[var(--color-key)] font-bold text-[var(--color-key)]"
        >
          Manage
        </Link>
      </div>

      {/* Who's short — count first, names behind a tap. */}
      {!deadlinePassed && pulse.short.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowShort((s) => !s)}
            aria-expanded={showShort}
            className="min-h-[var(--tap-target-min)] text-left font-bold text-[var(--color-muted-foreground)]"
          >
            <span className="inline-flex items-center gap-1.5">
              {pulse.short.length} of {pulse.entriesTotal} entries still short on picks
              {showShort ? (
                <ChevronUp size={18} aria-hidden="true" />
              ) : (
                <ChevronDown size={18} aria-hidden="true" />
              )}
            </span>
          </button>
          {showShort ? (
            <ul className="max-h-56 overflow-y-auto flex flex-col gap-1 text-[0.9rem]">
              {pulse.short.map((s) => (
                <li
                  key={s.entryName}
                  className="flex items-baseline justify-between gap-2 rounded bg-[var(--color-muted)] px-2.5 py-1.5"
                >
                  <span className="truncate">
                    <b>{s.entryName}</b>
                    <span className="text-[var(--color-muted-foreground)]">
                      {' '}
                      · {s.picksIn} in
                    </span>
                  </span>
                  {s.ownerEmail ? (
                    <span className="shrink-0 text-[0.8rem] text-[var(--color-muted-foreground)]">
                      {s.ownerEmail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {confirmRemind ? (
            <div className="flex items-center gap-2">
              <span className="text-[0.9rem] text-[var(--color-muted-foreground)]">
                Email {pulse.short.length} {pulse.short.length === 1 ? 'person' : 'people'}?
              </span>
              <button
                onClick={() => remind.mutate()}
                disabled={remind.isPending}
                className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-key)] text-[var(--color-background)] font-bold disabled:opacity-50"
              >
                {remind.isPending ? 'Sending…' : 'Yes, send'}
              </button>
              <Button variant="quiet" onClick={() => setConfirmRemind(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="quiet" full onClick={() => setConfirmRemind(true)}>
              Send reminder email now
            </Button>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button to={`/lm/${poolId}/message`} variant="quiet">
          Message members
        </Button>
        <Button to={`/lm/${poolId}/entries`} variant="quiet">
          Manage entries
        </Button>
        <Button to={`/lm/${poolId}/settings`} variant="quiet">
          Settings
        </Button>
        {pulse.joinCode ? (
          <Button
            variant="quiet"
            onClick={() => {
              navigator.clipboard.writeText(
                `${window.location.origin}/join?code=${pulse.joinCode}`
              )
              toast.success('Invite link copied')
            }}
          >
            Copy invite link ·{' '}
            <span className="font-mono tracking-[0.1em]">{pulse.joinCode}</span>
          </Button>
        ) : null}
      </div>
    </Card>
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
  const gameById = new Map(data.slate.map((g) => [g.gameId, g]))
  // Kickoff order, so the list reads the way the week plays out.
  const kickoffOf = (gameId: string) => gameById.get(gameId)?.kickoffAt ?? ''
  const mine = data.myPicks
    .filter((p) => p.entryId === entry.id)
    .sort((a, b) => kickoffOf(a.gameId).localeCompare(kickoffOf(b.gameId)))
  const hasKey = mine.some((p) => p.isKeyPick)
  const anyAuto = mine.some((p) => p.isAuto)
  const complete = mine.length >= need && (!data.pool.keyPick || hasKey)
  const pickList = (
    <div className="flex flex-col gap-2">
      {mine.map((p) => (
        <PickChip
          key={p.id}
          pick={p}
          game={gameById.get(p.gameId)}
          spreadMode={data.pool.spreadMode}
        />
      ))}
    </div>
  )

  return (
    <Card hero className="flex flex-col gap-3">
      {renaming ? (
        <div className="flex gap-2">
          <input
            value={renaming.value}
            onChange={(ev) => onRenameChange(ev.target.value)}
            maxLength={40}
            autoFocus
            className="mns-input flex-1"
          />
          <Button onClick={onRenameSave} disabled={!renaming.value.trim() || renamePending}>
            Save
          </Button>
          <Button variant="quiet" onClick={onRenameCancel}>
            Cancel
          </Button>
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
              <b className="inline-flex items-center gap-1.5 text-[var(--color-accent)]">
                <Check size={20} aria-hidden="true" />
                Locked in — {mine.length} of {need}
                {data.pool.keyPick && hasKey ? (
                  <span className="inline-flex items-center gap-1 text-[var(--color-key)]">
                    + key <Star size={16} fill="currentColor" aria-hidden="true" />
                  </span>
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
          {/* The same list the locked week shows, lock state per game —
              a Thursday pick reads 🔒 while Sunday's still read 🔓. */}
          {mine.length ? pickList : null}
          <Button to={`/pool/${poolId}/picks`} full>
            {mine.length === 0
              ? 'Make my picks'
              : entry.submittedAt && complete
                ? 'View / change picks'
                : 'Finish my picks'}
          </Button>
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
          {mine.length ? (
            pickList
          ) : (
            <p className="text-[var(--color-muted-foreground)]">No picks made this week.</p>
          )}
          <Button to={`/pool/${poolId}/picks`} variant="quiet" full>
            {anyLive ? 'Watch the week live' : 'See the full week'}
          </Button>
        </>
      )}
    </Card>
  )
}

// One picked game: lock icon, my team and its number, the state word,
// then the score or the kickoff underneath. The same row all week —
// open, locked, live, graded. The state is always a printed word
// (OPEN, LOCKED, AHEAD, WON…), never the icon or colour alone.
function PickChip({
  pick,
  game,
  spreadMode,
}: {
  pick: ApiPick
  game: ApiSlateGame | undefined
  spreadMode: 'straight_up' | 'ats'
}) {
  if (!game) return null
  const isHome = pick.selectedTeamId === game.home?.id
  const myTeam = isHome ? game.home : game.away
  const oppTeam = isHome ? game.away : game.home
  const myScore = isHome ? game.homeScore : game.awayScore
  const oppScore = isHome ? game.awayScore : game.homeScore
  // The number this pick grades on, from my team's side.
  const line =
    spreadMode === 'ats'
      ? teamSpread(pick.lineSpreadAtPick ?? game.spread, isHome ? 'home' : 'away')
      : null

  const standing = pickStanding(pick, game, spreadMode)
  const state = standing
    ? { word: standing.word, color: TONE_COLOR[standing.tone] }
    : game.open
      ? { word: 'OPEN', color: 'var(--color-accent)' }
      : // muted-foreground, not --color-locked: 4.34 on this tile in light.
        { word: 'LOCKED', color: 'var(--color-muted-foreground)' }

  const detail =
    game.status === 'in_progress' || game.status === 'final'
      ? `${myScore ?? 0}–${oppScore ?? 0} vs ${oppTeam?.nickname ?? ''} · ${game.status === 'final' ? 'Final' : 'Live'}`
      : game.status === 'postponed' || game.status === 'cancelled'
        ? `vs ${oppTeam?.nickname ?? ''} · ${game.status}`
        : `vs ${oppTeam?.nickname ?? ''} · ${game.kickoffTbd ? 'Time TBA' : kickoffLabel(game.kickoffAt)}`

  return (
    <div className="flex items-center gap-3 rounded-lg bg-[var(--color-muted)] px-3 py-2 tabular-nums">
      <span className="shrink-0 text-[var(--color-muted-foreground)]">
        {game.open ? (
          <Unlock size={18} aria-hidden="true" />
        ) : (
          <Lock size={18} aria-hidden="true" />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <b className="min-w-0 truncate">
            {pick.isKeyPick ? (
              <Star
                size={15}
                fill="currentColor"
                aria-hidden="true"
                className="inline-block align-[-0.12em] mr-1 text-[var(--color-key)]"
              />
            ) : null}
            {myTeam?.nickname ?? pick.selectedTeamId}
            {line ? (
              <span className="ml-1.5 font-mono text-[0.9rem] text-[var(--color-muted-foreground)]">
                {line}
              </span>
            ) : null}
          </b>
          <b className="shrink-0 text-[0.8rem] tracking-wider" style={{ color: state.color }}>
            {state.word}
          </b>
        </span>
        <span className="block text-[0.85rem] text-[var(--color-muted-foreground)]">
          {detail}
          {pick.isAuto ? ' · auto-pick' : ''}
        </span>
      </span>
    </div>
  )
}
