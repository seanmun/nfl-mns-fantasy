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
