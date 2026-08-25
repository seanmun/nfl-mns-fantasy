import { Link } from 'react-router-dom'

// The signed-out front door. Signed-in users never see this — HomeRoute
// swaps in MyPools — so this page has exactly one audience: someone a
// friend told about the pool, deciding whether to bother. Large type and
// plain words on purpose; the audience skews older and non-technical.

const POOL_TYPES = [
  {
    name: 'Classic',
    line: 'Pick a winner in every game, most right answers wins the week.',
  },
  {
    name: 'Pick 5',
    line: 'Pick any five games from the week — or three, or ten. The manager sets the number.',
  },
  {
    name: 'Confidence',
    line: 'Pick every game and rank them. Your surest pick earns the most.',
  },
  {
    name: 'Survivor',
    line: 'One team a week, never the same team twice. Lose and you’re out.',
  },
]

const STEPS = [
  ['Create your pool', 'Pick the style, straight up or against the spread, and your weeks.'],
  ['Invite your crew', 'Share one link. They tap it, sign up, and they’re in.'],
  ['Pick each week', 'Under a minute on a phone. A reminder email goes out before the deadline.'],
  ['Watch the standings', 'Scores come in live, grading is automatic, ties break fair.'],
]

// ── Landing mock panels ─────────────────────────────────────────────

function MockPanel({
  caption,
  note,
  children,
}: {
  caption: string
  note: string
  children: React.ReactNode
}) {
  return (
    <figure className="m-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2">
      <div aria-hidden="true" className="flex flex-col gap-2 pointer-events-none select-none">
        {children}
      </div>
      <figcaption className="mt-1">
        <b className="block">{caption}</b>
        <span className="text-[0.9rem] text-[var(--color-muted-foreground)]">{note}</span>
      </figcaption>
    </figure>
  )
}

function MockGame({
  away,
  awaySpread,
  home,
  homeSpread,
  picked,
  keyPick,
}: {
  away: string
  awaySpread: string
  home: string
  homeSpread: string
  picked: 'home' | 'away'
  keyPick?: boolean
}) {
  const side = (name: string, spread: string, isPicked: boolean) => (
    <span
      className={
        'relative flex-1 flex flex-col rounded-lg border-2 px-2.5 py-2 ' +
        (isPicked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-border-interactive)] bg-[var(--color-muted)]')
      }
    >
      <b className="text-[0.9rem]">{name}</b>
      <span
        className={
          'font-mono text-[0.8rem] font-bold ' +
          (isPicked ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted-foreground)]')
        }
      >
        {spread}
      </span>
      {isPicked ? (
        <span className="absolute top-1 right-1.5 w-4 h-4 rounded-full bg-[var(--color-accent)] text-[var(--color-background)] text-[0.65rem] font-black text-center leading-4">
          &#10003;
        </span>
      ) : null}
    </span>
  )
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {side(away, awaySpread, picked === 'away')}
        <span className="text-[0.7rem] font-bold text-[var(--color-muted-foreground)]">@</span>
        {side(home, homeSpread, picked === 'home')}
      </div>
      {keyPick ? (
        <span className="text-[0.78rem] font-bold text-[var(--color-key)]">
          ★ MY KEY PICK
        </span>
      ) : null}
    </div>
  )
}

function MockLive({
  team,
  score,
  opp,
  state,
  live,
  keyPick,
}: {
  team: string
  score: string
  opp: string
  state: 'AHEAD' | 'BEHIND' | 'WON'
  live?: boolean
  keyPick?: boolean
}) {
  const cls =
    state === 'BEHIND' ? 'text-[var(--color-pick-loss)]' : 'text-[var(--color-pick-win)]'
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-muted)] px-3 py-2 tabular-nums text-[0.9rem]">
      <b>
        {keyPick ? <span className="text-[var(--color-key)]">★ </span> : null}
        {team}
      </b>
      <span className="text-[var(--color-muted-foreground)]">
        {score} vs {opp} <b className={cls}>{state}</b>
        {live ? (
          <span className="ml-1 text-[0.68rem] uppercase tracking-wider text-[var(--color-accent)]">
            live
          </span>
        ) : null}
      </span>
    </div>
  )
}

function MockRow({
  rank,
  name,
  pts,
  keyScore,
  you,
}: {
  rank: string
  name: string
  pts: string
  keyScore: string
  you?: boolean
}) {
  return (
    <div
      className={
        'flex items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 tabular-nums text-[0.9rem] ' +
        (you ? 'bg-[var(--color-muted)]' : '')
      }
    >
      <span className="truncate">
        <b>{rank}.</b> {name}
        {you ? (
          <span className="ml-1.5 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--color-accent)]">
            you
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-[var(--color-muted-foreground)]">
        {pts} pts
        {keyScore ? <span className="text-[var(--color-key)]"> · ★{keyScore}</span> : null}
      </span>
    </div>
  )
}

export function Home() {
  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <section className="px-4 pt-14 pb-10 flex flex-col gap-5">
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
          2026 Season
        </p>
        <h1 className="text-[2.4rem] font-extrabold leading-[1.05] text-balance max-w-[22ch]">
          Run your NFL pick&rsquo;em pool without the spreadsheet
        </h1>
        <p className="text-[1.15rem] text-[var(--color-muted-foreground)] leading-relaxed max-w-prose">
          Your crew picks games each week. The deadlines, the grading, the standings,
          the &ldquo;did everyone get their picks in&rdquo; email — all handled.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            to="/sign-up"
            className="min-h-[var(--tap-target-min)] flex items-center justify-center px-8 rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold text-[1.05rem]"
          >
            Start a pool — it&rsquo;s free
          </Link>
          <Link
            to="/join"
            className="min-h-[var(--tap-target-min)] flex items-center justify-center px-8 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold text-[1.05rem]"
          >
            I was invited to one
          </Link>
        </div>
      </section>

      {/* ── Pool types ── */}
      <section className="px-4 py-10 border-t border-[var(--color-border)]">
        <h2 className="text-[1.4rem] font-extrabold mb-1">Four ways to play</h2>
        <p className="text-[var(--color-muted-foreground)] mb-5">
          Straight up or against the spread — your pool, your rules.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {POOL_TYPES.map((t) => (
            <div
              key={t.name}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
            >
              <b className="block text-[1.1rem] mb-1">{t.name}</b>
              <p className="text-[var(--color-muted-foreground)] leading-relaxed">{t.line}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Example screens ── */}
      {/* Mock panels, not screenshots: built from the same tokens as the
          real screens, so they never go stale or blurry, and cost no
          image bytes. Decorative — hidden from assistive tech, which
          gets the captions instead. */}
      <section className="px-4 py-10 border-t border-[var(--color-border)]">
        <h2 className="text-[1.4rem] font-extrabold mb-1">What it looks like</h2>
        <p className="text-[var(--color-muted-foreground)] mb-5">
          Real screens from a real week.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <MockPanel
            caption="Pick your five, star your key"
            note="Tap a team, tap ★ on your surest one. Auto-saves as you go."
          >
            <MockGame away="Eagles" awaySpread="+3.5" home="Chiefs" homeSpread="-3.5" picked="home" />
            <MockGame away="Cowboys" awaySpread="-1.5" home="Giants" homeSpread="+1.5" picked="away" keyPick />
            <div className="mt-1 rounded-lg bg-[var(--color-muted)] px-3 py-2 flex items-baseline justify-between">
              <b className="tabular-nums text-[0.95rem]">5 of 5 picks</b>
              <span className="text-[0.8rem] text-[var(--color-accent)] font-bold">
                &#10003; Submitted
              </span>
            </div>
          </MockPanel>

          <MockPanel
            caption="Live scores, all day"
            note="Your games update every 15 minutes — ahead, behind, won."
          >
            <MockLive team="Chiefs" score="21–14" opp="Eagles" state="AHEAD" live />
            <MockLive team="Cowboys" score="10–13" opp="Giants" state="BEHIND" live keyPick />
            <MockLive team="Lions" score="31–17" opp="Bears" state="WON" />
          </MockPanel>

          <MockPanel
            caption="Standings that keep themselves"
            note="Points rank it, your key ★ total breaks ties."
          >
            <MockRow rank="1" name="Gridiron Gary" pts="41" keyScore="5" />
            <MockRow rank="2" name="Upset Central" pts="39" keyScore="6" you />
            <MockRow rank="3" name="MondayMorningQB" pts="39" keyScore="4" />
            <MockRow rank="4" name="The In-Laws" pts="35" keyScore="3" />
          </MockPanel>

          <MockPanel
            caption="A winners circle worth playing for"
            note="Season places, key-pick places, segment races, even last place."
          >
            <div className="rounded-lg border border-[var(--color-key)] px-3 py-2 text-center">
              <span aria-hidden="true">&#127942;</span>{' '}
              <b>Champion — Gridiron Gary</b>
            </div>
            <MockRow rank="1" name="Weeks 1–5 · Hot Start" pts="14" keyScore="" />
            <MockRow rank="1" name="Key picks ★ · Upset Central" pts="6" keyScore="" />
            <MockRow rank="12" name="Last place · Uncle Rich" pts="19" keyScore="" />
          </MockPanel>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-4 py-10 border-t border-[var(--color-border)]">
        <h2 className="text-[1.4rem] font-extrabold mb-5">How it works</h2>
        <ol className="flex flex-col gap-4">
          {STEPS.map(([title, line], i) => (
            <li key={title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="shrink-0 w-9 h-9 rounded-full bg-[var(--color-accent)] text-[var(--color-background)] font-black text-[1.05rem] grid place-items-center"
              >
                {i + 1}
              </span>
              <div>
                <b className="block text-[1.05rem]">{title}</b>
                <p className="text-[var(--color-muted-foreground)] leading-relaxed">{line}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── The details that keep a pool honest ── */}
      <section className="px-4 py-10 border-t border-[var(--color-border)]">
        <h2 className="text-[1.4rem] font-extrabold mb-5">Built to keep a pool honest</h2>
        <ul className="flex flex-col gap-3 max-w-prose">
          {[
            'Everyone’s picks stay hidden until the deadline, then reveal all at once.',
            'Miss the deadline and the app picks for you — marked as auto, never passed off as yours.',
            'A key pick breaks season ties, so first place is never a coin flip.',
            'The rules page is generated from your pool’s actual settings, so it can’t drift from how the pool really scores.',
            'No money touches the app. You settle up the way you already do.',
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <span aria-hidden="true" className="text-[var(--color-accent)] font-black">
                &#10003;
              </span>
              <p className="text-[var(--color-muted-foreground)] leading-relaxed">{line}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="px-4 py-12 border-t border-[var(--color-border)] flex flex-col items-start gap-4">
        <h2 className="text-[1.7rem] font-extrabold leading-tight text-balance max-w-[24ch]">
          Kickoff&rsquo;s coming. Get your crew in.
        </h2>
        <Link
          to="/sign-up"
          className="min-h-[var(--tap-target-min)] flex items-center justify-center px-8 rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold text-[1.05rem]"
        >
          Start your pool
        </Link>
      </section>
    </div>
  )
}
