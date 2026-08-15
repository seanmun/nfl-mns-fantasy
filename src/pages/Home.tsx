import { Link } from 'react-router-dom'

// Placeholder landing page. The real one lists your pools and offers
// Create Pool / Join Pool, and lands when the pool API does.
export function Home() {
  return (
    <div className="px-4 py-12 flex flex-col gap-6">
      <div>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-1">
          2026 Season
        </p>
        <h1 className="text-[2rem] font-extrabold leading-tight text-balance">
          NFL pools, without the spreadsheet
        </h1>
      </div>
      <p className="text-[var(--color-muted-foreground)] leading-relaxed max-w-prose">
        Create a pool or join one with a link. Pick your games each week, and the
        standings keep themselves.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          to="/create"
          className="min-h-[var(--tap-target-min)] flex items-center justify-center px-6 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-foreground)] font-extrabold"
        >
          Create a pool
        </Link>
        <Link
          to="/join"
          className="min-h-[var(--tap-target-min)] flex items-center justify-center px-6 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
        >
          Join a pool
        </Link>
      </div>
    </div>
  )
}
