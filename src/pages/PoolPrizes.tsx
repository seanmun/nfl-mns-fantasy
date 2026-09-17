import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { createApi, type PrizeItem } from '@/lib/api/client'
import { dateLabel, usd } from '@/lib/utils'
import { PoolTabBar } from '@/components/layout/PoolTabBar'
import { Trophy } from 'lucide-react'
import { Banner, Button, Card, EmptyState, PageHeader, Skeleton } from '@/ui/components'

// The prize pool: what the pot is worth, what each prize pays, and who
// holds each one right now. TRACKED, never handled — the manager holds
// and pays the pot however the pool always has; no money moves through
// the app. Each prize is a percent of the pot, so its dollars follow
// the pot's value.
export function PoolPrizes() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])

  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-3">
        <Skeleton h="2.2rem" w="45%" />
        <Skeleton h="7rem" />
        <Skeleton h="5rem" />
        <Skeleton h="5rem" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <EmptyState title="Something went wrong">
        {(error as Error)?.message ?? 'Could not load the prizes.'}
      </EmptyState>
    )
  }

  const { potUsd, potUpdatedAt, items } = data.prizePool
  const mine = new Set(data.rows.filter((r) => r.isMine).map((r) => r.entryId))
  const anyShare = items.some((i) => i.share != null)
  const assigned = Math.round(items.reduce((n, i) => n + (i.share ?? 0), 0) * 100) / 100

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 pb-28 flex flex-col gap-4">
      <PageHeader
        back={`/pool/${poolId}`}
        backLabel="Pool home"
        title="Prizes"
        status="The manager holds and pays the pot — this page keeps track."
      />

      <Card hero className="flex flex-col gap-1">
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)]">
          Prize pool
        </p>
        <b className="text-[2.4rem] leading-none tabular-nums">
          {potUsd != null ? usd(potUsd) : '—'}
        </b>
        <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
          {potUsd == null
            ? 'The manager hasn’t set the pot yet.'
            : potUpdatedAt
              ? `Updated ${dateLabel(potUpdatedAt)}`
              : null}
        </p>
      </Card>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <PrizeCard item={item} mine={mine} />
          </li>
        ))}
      </ul>

      {data.manager ? (
        <div className="flex flex-col gap-3">
          {/* What's off in the split, said plainly — never a block. */}
          {!anyShare ? (
            <Banner tone="warn">Set each prize&rsquo;s share of the pot in Settings.</Banner>
          ) : assigned < 100 ? (
            <Banner tone="warn">
              {Math.round((100 - assigned) * 100) / 100}% of the pot isn&rsquo;t assigned to a
              prize yet.
            </Banner>
          ) : assigned > 100 ? (
            <Banner tone="warn">Payouts add up to {assigned}% — more than the pot.</Banner>
          ) : null}
          <Button to={`/lm/${poolId}/settings`} variant="quiet" full>
            Edit pot &amp; payouts
          </Button>
        </div>
      ) : null}

      <PoolTabBar />
    </div>
  )
}

// One prize: what it pays, what it's for, and who holds it. Ties hold a
// place together; a long tie (every entry level in week one) is counted
// rather than listed.
function PrizeCard({ item, mine }: { item: PrizeItem; mine: Set<string> }) {
  const shown = item.leaders.slice(0, 3)
  const more = item.leaders.length - shown.length
  const lead = item.status === 'final' ? 'Won by' : item.key === 'last' ? 'Currently' : 'Leading'

  return (
    <Card className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <b className="text-[1.1rem]">{item.label}</b>
        <b className="shrink-0 text-[1.3rem] tabular-nums">
          {item.amountUsd != null ? usd(item.amountUsd) : item.share != null ? `${item.share}%` : '—'}
        </b>
      </div>
      <p className="flex items-baseline justify-between gap-3 text-[0.85rem] text-[var(--color-muted-foreground)]">
        <span>{item.detail}</span>
        <span className="shrink-0 tabular-nums">
          {item.share != null ? `${item.share}% of the pot` : 'share not set'}
        </span>
      </p>
      {item.leaders.length ? (
        <p className="text-[0.95rem] tabular-nums">
          <b
            className={
              'inline-flex items-center gap-1 align-[-0.1em] ' +
              (item.status === 'final' ? 'text-[var(--color-key)]' : '')
            }
          >
            {item.status === 'final' ? <Trophy size={16} aria-hidden="true" /> : null}
            {lead}:
          </b>{' '}
          {shown.map((l, i) => (
            <span key={l.entryId}>
              {i > 0 ? ' · ' : ''}
              {l.entryName}
              {mine.has(l.entryId) ? (
                <span className="font-bold text-[var(--color-accent)]"> (you)</span>
              ) : null}
            </span>
          ))}
          {more > 0 ? ` +${more} more` : ''}
          <span className="text-[var(--color-muted-foreground)]">
            {' '}
            · {item.leaders[0].points}&nbsp;{item.unit}
            {item.leaders.length > 1 ? ' · tied' : ''}
          </span>
        </p>
      ) : item.status !== 'upcoming' ? (
        <p className="text-[0.95rem] text-[var(--color-muted-foreground)]">Nobody yet</p>
      ) : null}
    </Card>
  )
}
