import { Link } from 'react-router-dom'
import { SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'

// Matches the hub's header — same height, same tokens, same wordmark
// shape — so moving between mnsfantasy.com and this subdomain does not
// feel like moving between two products.
//
// Nav is deliberately short. The audience is older and largely
// non-technical; a member's whole job here is their pool.
export function Header() {
  const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://mnsfantasy.com'

  return (
    <header className="fixed top-0 left-0 right-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center">
          <span className="font-display text-2xl tracking-wide text-[var(--color-foreground)]">
            MNS<span className="text-neon-green">nfl</span>
          </span>
        </Link>

        <nav className="flex items-center gap-4 text-[0.95rem]">
          <SignedIn>
            <Link
              to="/dashboard"
              className="min-h-[var(--tap-target-min)] flex items-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
            >
              My pools
            </Link>
          </SignedIn>
          <a
            href={platformUrl}
            className="hidden sm:flex min-h-[var(--tap-target-min)] items-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
          >
            All games
          </a>
          <SignedIn>
            <UserButton
              afterSignOutUrl="/"
              appearance={{ elements: { avatarBox: 'w-9 h-9' } }}
            />
          </SignedIn>
          <SignedOut>
            <Link
              to="/sign-in"
              className="min-h-[var(--tap-target-min)] flex items-center font-semibold text-[var(--color-accent)]"
            >
              Sign in
            </Link>
          </SignedOut>
        </nav>
      </div>
    </header>
  )
}
