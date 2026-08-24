import { Link, useLocation, useParams } from 'react-router-dom'

// The pool's persistent bottom navigation. Three destinations, always
// visible, current one lit — "where am I and how do I move" answered
// the way every app this audience owns answers it. Pages that pin their
// own bar (the picks save/submit bar) stack it directly above this one.
export function PoolTabBar() {
  const { id: poolId = '' } = useParams()
  const { pathname } = useLocation()

  const tabs = [
    { to: `/pool/${poolId}`, label: 'Pool', icon: '\u{1F3E0}', exact: true },
    { to: `/pool/${poolId}/picks`, label: 'Picks', icon: '✓', exact: false },
    { to: `/pool/${poolId}/standings`, label: 'Standings', icon: '\u{1F3C6}', exact: false },
  ]

  return (
    <nav
      aria-label="Pool sections"
      className="fixed left-0 right-0 bottom-0 z-40 bg-[var(--color-card)] border-t-2 border-[var(--color-border-interactive)] flex pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.to : pathname.startsWith(t.to)
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? 'page' : undefined}
            className={
              'flex-1 min-h-[3.5rem] flex flex-col items-center justify-center gap-0.5 font-bold text-[0.78rem] uppercase tracking-wider ' +
              (active
                ? 'text-[var(--color-accent)] border-t-2 border-[var(--color-accent)] -mt-[2px]'
                : 'text-[var(--color-muted-foreground)]')
            }
          >
            <span aria-hidden="true" className="text-[1.1rem] leading-none">
              {t.icon}
            </span>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
