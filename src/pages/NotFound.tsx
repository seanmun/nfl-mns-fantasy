import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="px-4 py-16 flex flex-col gap-4 items-start">
      <h1 className="text-[1.7rem] font-extrabold">That page isn&rsquo;t here</h1>
      <p className="text-[var(--color-muted-foreground)]">
        The link may be old, or the pool may have been removed.
      </p>
      <Link
        to="/"
        className="min-h-[var(--tap-target-min)] flex items-center px-6 rounded-lg border-2 border-[var(--color-border-interactive)] font-semibold"
      >
        Back to start
      </Link>
    </div>
  )
}
