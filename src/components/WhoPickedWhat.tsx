import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Search, Star } from 'lucide-react'
import type { ApiOtherPick, ApiPick, ApiSlateGame } from '@/lib/api/client'
import { kickoffLabel, teamSpread } from '@/lib/utils'

// Who picked what: one card per game, swiped sideways, each team's
// pickers in a column under it. Built for a pool of hundreds — the
// counts are the headline, the names are the detail, one search box
// filters every card at once, and the caller's own entries are pinned
// to the top of their column on every card.
//
// Everything it shows is already decided server-side: `others` holds
// only picks the reveal rule has made public (pickVisibility), and each
// pick's result is the grader's. Nothing here recomputes a cover.

const TONE = {
  win: { color: 'var(--color-pick-win)' },
  loss: { color: 'var(--color-pick-loss)' },
  push: { color: 'var(--color-pick-push)' },
} as const
type Result = keyof typeof TONE

function invert(r: Result | null): Result | null {
  return r === 'win' ? 'loss' : r === 'loss' ? 'win' : r
}

export function WhoPickedWhat({
  slate,
  others,
  myPicks,
  myEntries,
  spreadMode,
}: {
  slate: ApiSlateGame[]
  others: ApiOtherPick[]
  myPicks: ApiPick[]
  myEntries: Array<{ id: string; entryName: string }>
  spreadMode: 'straight_up' | 'ats'
}) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const stripRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([])

  const mine = useMemo(() => new Set(myEntries.map((e) => e.id)), [myEntries])
  const myName = useMemo(() => new Map(myEntries.map((e) => [e.id, e.entryName])), [myEntries])
  const q = query.trim().toLowerCase()
  const wonWord = spreadMode === 'ats' ? 'Covered' : 'Won'

  const byGame = useMemo(() => {
    const m = new Map<string, ApiOtherPick[]>()
    for (const p of others) m.set(p.gameId, [...(m.get(p.gameId) ?? []), p])
    return m
  }, [others])

  // Which card is in view drives the chip strip. Observed, not
  // computed from scrollLeft, so it survives resize and font loading.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.idx)
            setCurrent(i)
            chipRefs.current[i]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
          }
        }
      },
      { root: strip, threshold: 0.6 }
    )
    for (const el of cardRefs.current) if (el) io.observe(el)
    return () => io.disconnect()
  }, [slate.length])

  const go = (i: number) => {
    const el = cardRefs.current[Math.max(0, Math.min(slate.length - 1, i))]
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }
  const goToMe = () => {
    const i = slate.findIndex((g) => myPicks.some((p) => p.gameId === g.gameId))
    if (i >= 0) go(i)
  }

  return (
    <section aria-labelledby="who-picked-heading" className="mt-6">
      <h2 id="who-picked-heading" className="px-4 pb-2 text-[1.05rem] font-bold">
        Who picked what
      </h2>
      <div className="px-4 flex items-center gap-2">
        <label className="flex-1 min-w-0 flex items-center gap-2 min-h-[var(--tap-target-min)] rounded-xl border border-[var(--color-border-interactive)] bg-[var(--color-card)] px-3">
          <Search size={18} aria-hidden="true" className="shrink-0 text-[var(--color-muted-foreground)]" />
          <input
            id="who-picked-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a name…"
            aria-label="Find a name"
            className="flex-1 min-w-0 bg-transparent outline-none"
          />
        </label>
        {myPicks.length ? (
          <button
            type="button"
            onClick={goToMe}
            className="min-h-[var(--tap-target-min)] min-w-[var(--tap-target-min)] px-3 rounded-xl border border-[var(--color-border-interactive)] bg-[var(--color-card)] font-bold"
          >
            Me
          </button>
        ) : null}
      </div>

      {/* Jump strip. The current chip is filled; a live game carries a
          dot; a chip dims when the search finds nobody in that game. */}
      <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Games">
        {slate.map((g, i) => {
          const picks = byGame.get(g.gameId) ?? []
          const hit = !q || picks.some((p) => p.entryName.toLowerCase().includes(q))
          return (
            <button
              key={g.gameId}
              ref={(el) => { chipRefs.current[i] = el }}
              type="button"
              role="tab"
              aria-selected={i === current}
              onClick={() => go(i)}
              className={
                'shrink-0 inline-flex items-center gap-1.5 min-h-[2.75rem] px-3 rounded-full border font-mono text-[0.8rem] font-medium ' +
                (i === current
                  ? 'bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]'
                  : 'bg-[var(--color-card)] border-[var(--color-border-interactive)]') +
                (hit ? '' : ' opacity-40')
              }
            >
              {g.status === 'in_progress' ? (
                <span aria-label="live" className="w-2 h-2 rounded-full bg-[var(--color-pick-pending)]" />
              ) : null}
              {g.away?.id ?? '?'}–{g.home?.id ?? '?'}
            </button>
          )
        })}
      </div>

      <div className="relative">
        <div
          ref={stripRef}
          className="mt-2 flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pb-3 [scrollbar-width:none] [scroll-padding-inline:1rem]"
        >
          {slate.map((g, i) => (
            <GameCard
              key={g.gameId}
              ref={(el) => { cardRefs.current[i] = el }}
              idx={i}
              total={slate.length}
              game={g}
              picks={byGame.get(g.gameId) ?? []}
              myPicks={myPicks.filter((p) => p.gameId === g.gameId)}
              mine={mine}
              myName={myName}
              spreadMode={spreadMode}
              wonWord={wonWord}
              q={q}
            />
          ))}
        </div>
        {/* Arrows for pointer devices; a phone swipes. */}
        <div className="hidden md:flex pointer-events-none absolute inset-x-1 top-[45%] justify-between">
          <button
            type="button"
            onClick={() => go(current - 1)}
            aria-label="Previous game"
            className="pointer-events-auto w-[var(--tap-target-min)] h-[var(--tap-target-min)] rounded-full border border-[var(--color-border-interactive)] bg-[var(--color-card)] inline-flex items-center justify-center shadow"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(current + 1)}
            aria-label="Next game"
            className="pointer-events-auto w-[var(--tap-target-min)] h-[var(--tap-target-min)] rounded-full border border-[var(--color-border-interactive)] bg-[var(--color-card)] inline-flex items-center justify-center shadow"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}

const GameCard = forwardRef<
  HTMLElement,
  {
    idx: number
    total: number
    game: ApiSlateGame
    picks: ApiOtherPick[]
    myPicks: ApiPick[]
    mine: Set<string>
    myName: Map<string, string>
    spreadMode: 'straight_up' | 'ats'
    wonWord: string
    q: string
  }
>(function GameCard({ idx, total, game, picks, myPicks, mine, myName, spreadMode, wonWord, q }, ref) {
  // Same orientation as the picking card: favourite left, underdog
  // right, home carried by the connector. Straight-up stays away-at-home.
  const homeFav = spreadMode === 'ats' && game.spread != null && game.spread < 0
  const left = homeFav ? game.home : game.away
  const right = homeFav ? game.away : game.home
  const leftIsHome = left?.id === game.home?.id
  const scoreOf = (isHome: boolean) => (isHome ? game.homeScore : game.awayScore)
  const lineOf = (isHome: boolean) =>
    spreadMode === 'ats' ? teamSpread(game.spread, isHome ? 'home' : 'away') : null
  const scored = game.status === 'in_progress' || game.status === 'final'
  const final = game.status === 'final'

  const sidePicks = (teamId: string | undefined) =>
    picks
      .filter((p) => p.selectedTeamId === teamId)
      .sort(
        (a, b) =>
          Number(mine.has(b.entryId)) - Number(mine.has(a.entryId)) ||
          a.entryName.localeCompare(b.entryName)
      )
  const leftPicks = sidePicks(left?.id)
  const rightPicks = sidePicks(right?.id)

  // The grader's verdict for each side, read off the picks that sit
  // there. A side nobody took borrows the inverse of the other side.
  const verdict = (ps: ApiOtherPick[]): Result | null => {
    const r = ps.find((p) => p.result === 'win' || p.result === 'loss' || p.result === 'push')?.result
    return (r as Result | undefined) ?? null
  }
  let leftRes = final ? verdict(leftPicks) : null
  let rightRes = final ? verdict(rightPicks) : null
  if (final && leftRes == null) leftRes = invert(rightRes)
  if (final && rightRes == null) rightRes = invert(leftRes)
  const word = (r: Result | null) => (r === 'win' ? wonWord : r === 'loss' ? 'Lost' : r === 'push' ? 'Push' : null)

  const pill = final
    ? { text: 'Final', cls: 'bg-[var(--color-foreground)] text-[var(--color-background)]' }
    : game.status === 'in_progress'
      ? { text: 'Live', cls: 'bg-[var(--color-pick-pending)] text-[var(--color-background)]' }
      : game.status === 'postponed' || game.status === 'cancelled'
        ? { text: game.status, cls: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]' }
        : { text: game.kickoffTbd ? 'Time TBD' : kickoffLabel(game.kickoffAt), cls: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]' }

  const revealed = game.picksRevealed
  const total_ = leftPicks.length + rightPicks.length

  return (
    <article
      ref={ref}
      data-idx={idx}
      aria-label={`${left?.nickname ?? ''} ${leftIsHome ? 'vs' : 'at'} ${right?.nickname ?? ''}`}
      className="snap-start shrink-0 w-[calc(100%-2rem)] md:w-[34rem] rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] flex flex-col overflow-hidden"
      style={{ contentVisibility: 'auto' }}
    >
      <div className="px-3.5 pt-3 flex items-center justify-between gap-2">
        <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.72rem] font-bold uppercase tracking-wider ' + pill.cls}>
          {game.status === 'in_progress' ? <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
          {pill.text}
        </span>
        <span className="font-mono text-[0.78rem] text-[var(--color-muted-foreground)] tabular-nums">
          {idx + 1} of {total}{revealed ? ` · ${total_} picked` : ''}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5 px-3.5 pt-2 pb-2.5 tabular-nums">
        <TeamSide team={left} line={lineOf(leftIsHome)} score={scored ? scoreOf(leftIsHome) : null} live={game.status === 'in_progress'} word={word(leftRes)} res={leftRes} align="left" />
        <span className="pb-3 font-mono text-[0.78rem] text-[var(--color-muted-foreground)]">{leftIsHome ? 'vs' : 'at'}</span>
        <TeamSide team={right} line={lineOf(!leftIsHome)} score={scored ? scoreOf(!leftIsHome) : null} live={game.status === 'in_progress'} word={word(rightRes)} res={rightRes} align="right" />
      </div>

      <div className="grid grid-cols-2 border-t border-[var(--color-border)]">
        <Column
          picks={leftPicks}
          share={total_ ? leftPicks.length / total_ : 0}
          res={leftRes}
          word={word(leftRes)}
          revealed={revealed}
          myHere={myPicks.filter((p) => p.selectedTeamId === left?.id)}
          mine={mine}
          myName={myName}
          q={q}
        />
        <Column
          picks={rightPicks}
          share={total_ ? rightPicks.length / total_ : 0}
          res={rightRes}
          word={word(rightRes)}
          revealed={revealed}
          myHere={myPicks.filter((p) => p.selectedTeamId === right?.id)}
          mine={mine}
          myName={myName}
          q={q}
          divider
        />
      </div>
    </article>
  )
})

function TeamSide({
  team,
  line,
  score,
  live,
  word,
  res,
  align,
}: {
  team: ApiSlateGame['home']
  line: string | null
  score: number | null
  live: boolean
  word: string | null
  res: Result | null
  align: 'left' | 'right'
}) {
  const end = align === 'right'
  return (
    <div className={'min-w-0 flex flex-col gap-0.5 ' + (end ? 'items-end text-right' : '')}>
      <span className="font-display text-[2rem] leading-[0.95] tracking-wide truncate max-w-full">{team?.nickname ?? '?'}</span>
      {line ? <span className="font-mono text-[0.9rem] text-[var(--color-muted-foreground)]">{line}</span> : null}
      <span className={'font-display text-[3rem] leading-none ' + (live ? 'text-[var(--color-muted-foreground)]' : '')}>
        {score ?? '–'}
      </span>
      {word ? (
        <span className="font-mono text-[0.72rem] font-bold uppercase tracking-widest" style={{ color: res ? TONE[res].color : undefined }}>
          {word}
        </span>
      ) : null}
    </div>
  )
}

function Column({
  picks,
  share,
  res,
  word,
  revealed,
  myHere,
  mine,
  myName,
  q,
  divider,
}: {
  picks: ApiOtherPick[]
  share: number
  res: Result | null
  word: string | null
  revealed: boolean
  myHere: ApiPick[]
  mine: Set<string>
  myName: Map<string, string>
  q: string
  divider?: boolean
}) {
  const edge = divider ? 'border-l border-[var(--color-border)]' : ''
  if (!revealed) {
    return (
      <div className={'flex flex-col min-h-[10rem] ' + edge}>
        <div className="px-3 py-2.5 border-b border-[var(--color-border)] font-mono text-[0.72rem] uppercase tracking-widest text-[var(--color-muted-foreground)]">
          Hidden
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 px-3 py-4 text-center text-[0.9rem] text-[var(--color-muted-foreground)]">
          <Lock size={20} aria-hidden="true" />
          {myHere.map((p) => (
            <b key={p.id} className="text-[var(--color-foreground)]">
              {myName.get(p.entryId) ?? 'You'}
              {p.isKeyPick ? <Star size={14} fill="currentColor" aria-label="key pick" className="inline-block align-[-0.1em] ml-1 text-[var(--color-key)]" /> : null}
            </b>
          ))}
          <span>Picks reveal at kickoff</span>
        </div>
      </div>
    )
  }
  const soft = res ? `color-mix(in srgb, ${TONE[res].color} 14%, var(--color-card))` : undefined
  return (
    <div className={'flex flex-col min-h-0 ' + edge}>
      <div
        className="flex items-baseline justify-between gap-2 px-3 py-2.5 border-b border-[var(--color-border)] text-[0.85rem] font-bold"
        style={{ background: soft }}
      >
        <span>
          <span className="font-mono text-[1.1rem] tabular-nums">{picks.length}</span>{' '}
          <span className="font-mono text-[0.78rem] font-medium text-[var(--color-muted-foreground)] tabular-nums">{Math.round(share * 100)}%</span>
        </span>
        {word ? (
          <span className="font-mono text-[0.68rem] uppercase tracking-widest" style={{ color: res ? TONE[res].color : undefined }}>
            {word}
          </span>
        ) : null}
      </div>
      <ul className="max-h-[22rem] md:max-h-[28rem] overflow-y-auto overscroll-contain py-1">
        {picks.map((p) => {
          const me = mine.has(p.entryId)
          const hit = !!q && p.entryName.toLowerCase().includes(q)
          if (q && !hit && !me) return null
          return (
            <li
              key={p.entryId}
              className={
                'flex items-center gap-1.5 min-h-[2.5rem] px-3 text-[0.95rem] border-b border-[var(--color-border)]/60 ' +
                (me ? 'sticky top-0 z-[1] bg-[var(--color-accent-soft)] font-bold' : hit ? 'bg-[var(--color-accent-soft)]' : '')
              }
            >
              {p.isKeyPick ? (
                <Star size={14} fill="currentColor" aria-label="key pick" className="shrink-0 text-[var(--color-key)]" />
              ) : null}
              <span className="truncate">{p.entryName}</span>
              {me ? <Tag accent>you</Tag> : null}
              {p.isAuto ? <Tag>auto</Tag> : null}
            </li>
          )
        })}
        {!picks.length ? (
          <li className="px-3 py-3 text-[0.9rem] text-[var(--color-muted-foreground)]">Nobody</li>
        ) : null}
      </ul>
    </div>
  )
}

function Tag({ children, accent }: { children: string; accent?: boolean }) {
  return (
    <span
      className={
        'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider ' +
        (accent
          ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
          : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]')
      }
    >
      {children}
    </span>
  )
}
