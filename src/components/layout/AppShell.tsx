import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Header } from './Header'

export function AppShell({ children }: { children: ReactNode }) {
  const platformUrl = import.meta.env.VITE_PLATFORM_URL || 'https://mnsfantasy.com'

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)]">
      <Header />
      {/* pt-16 clears the fixed header; max-w-3xl keeps line length
          readable at the app's 18px base size. */}
      <main className="flex-1 pt-16 w-full max-w-3xl mx-auto">{children}</main>

      <footer className="border-t border-[var(--color-border)] mt-12">
        <div className="max-w-3xl mx-auto px-4 py-8 text-center flex flex-col gap-3">
          <p className="text-[0.95rem] text-[var(--color-muted-foreground)]">
            <span className="font-display text-[var(--color-foreground)]">
              MNS<span className="text-neon-green">fantasy</span>
            </span>{' '}
            &mdash; Fantasy Sports That Never Sleep
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[0.85rem] text-[var(--color-muted-foreground)]">
            <a href={platformUrl} className="hover:text-[var(--color-foreground)] transition-colors">
              All games
            </a>
            <span aria-hidden="true">&middot;</span>
            <a
              href={`${platformUrl}/privacy`}
              className="hover:text-[var(--color-foreground)] transition-colors"
            >
              Privacy
            </a>
            <span aria-hidden="true">&middot;</span>
            <Link to="/" className="hover:text-[var(--color-foreground)] transition-colors">
              Home
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
