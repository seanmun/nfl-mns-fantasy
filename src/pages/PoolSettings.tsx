import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'
import { PoolTabBar } from '@/components/layout/PoolTabBar'
import { usd } from '@/lib/utils'
import { Field } from '@/ui/components'

// Pool Settings — the owner-verbs page. Name, note, the tracked prize
// pool. Everything else stays where it lives (slate on Manage Week,
// people on Manage Entries).
export function PoolSettings() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['picks', poolId, undefined],
    queryFn: () => api.getPicks(poolId),
  })

  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (data) {
      setName(data.pool.name)
      setNote(data.pool.managerNote ?? '')
    }
  }, [data])

  // The prize pool rides on the standings response: the pot and one
  // item per paid place, keyed the way the save writes them back.
  const { data: standings } = useQuery({
    queryKey: ['standings', poolId],
    queryFn: () => api.getStandings(poolId),
  })
  const items = standings?.prizePool.items ?? []
  // Kept as typed text so "12." mid-typing survives. Seeded ONCE — a
  // background refetch must never wipe what the manager is typing.
  const [pot, setPot] = useState('')
  const [shares, setShares] = useState<Record<string, string>>({})
  const seeded = useRef(false)
  useEffect(() => {
    if (!standings || seeded.current) return
    seeded.current = true
    setPot(standings.prizePool.potUsd != null ? String(standings.prizePool.potUsd) : '')
    setShares(
      Object.fromEntries(
        standings.prizePool.items.map((i) => [i.key, i.share != null ? String(i.share) : ''])
      )
    )
  }, [standings])

  const potValue = pot.trim() === '' ? null : Number(pot)
  const shareValue = (key: string) => {
    const v = (shares[key] ?? '').trim()
    return v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  }
  const assigned =
    Math.round(items.reduce((n, i) => n + (shareValue(i.key) ?? 0), 0) * 100) / 100

  const save = useMutation({
    mutationFn: () =>
      api.updatePoolSettings(poolId, {
        name: name.trim(),
        managerNote: note,
        ...(standings
          ? {
              prizePool: {
                potUsd: pot.trim() === '' ? null : pot.trim(),
                shares: Object.fromEntries(items.map((i) => [i.key, (shares[i.key] ?? '').trim()])),
              },
            }
          : {}),
      }),
    onSuccess: () => {
      toast.success('Saved')
      qc.invalidateQueries({ queryKey: ['picks', poolId] })
      qc.invalidateQueries({ queryKey: ['my-pools'] })
      qc.invalidateQueries({ queryKey: ['standings', poolId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!data) return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading&hellip;</p>
  if (!data.manager) {
    return <p className="px-4 py-12">Only this pool&rsquo;s admins can edit its settings.</p>
  }

  const inputClass =
    'min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)] w-full'

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 pb-28 flex flex-col gap-5">
      <div>
        <Link
          to={`/pool/${poolId}`}
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; Pool home
        </Link>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-key)]">
          Admin
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Pool settings</h1>
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-semibold" htmlFor="pool-name">Pool name</label>
        <input
          id="pool-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-semibold" htmlFor="pool-note">Note from the manager</label>
        <p className="text-[0.85rem] text-[var(--color-muted-foreground)] -mt-1">
          Pinned on the pool home page. Leave blank for none.
        </p>
        <textarea
          id="pool-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={2000}
          className={inputClass + ' py-3 leading-relaxed'}
        />
      </div>

      {standings ? (
        <section className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-5">
          <div>
            <h2 className="text-[1.2rem] font-extrabold">Prize pool</h2>
            <p className="text-[0.85rem] text-[var(--color-muted-foreground)]">
              Tracked only — the app never holds or pays out money. Each prize is a percent
              of the pot, so payouts follow what the pot is worth. Members see all of this
              on the Prizes tab.
            </p>
          </div>

          <Field label="Pot" hint="What the pot is worth right now, in dollars." htmlFor="pool-pot">
            <input
              id="pool-pot"
              value={pot}
              onChange={(e) => setPot(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 500"
              className="mns-input"
            />
          </Field>

          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const share = shareValue(item.key)
              return (
                <div key={item.key} className="flex items-center gap-3">
                  <label htmlFor={`share-${item.key}`} className="flex-1 min-w-0">
                    <b className="block">{item.label}</b>
                    <span className="text-[0.85rem] text-[var(--color-muted-foreground)] tabular-nums">
                      {share != null && potValue != null && Number.isFinite(potValue)
                        ? `pays ${usd(Math.round(potValue * share) / 100)}`
                        : item.detail}
                    </span>
                  </label>
                  <span className="flex items-center gap-1.5 font-bold">
                    <input
                      id={`share-${item.key}`}
                      value={shares[item.key] ?? ''}
                      onChange={(e) =>
                        setShares((s) => ({ ...s, [item.key]: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="0"
                      className="mns-input w-[5.5rem] text-right tabular-nums"
                    />
                    %
                  </span>
                </div>
              )
            })}
          </div>

          {/* The split, said plainly. Saving is never blocked by it. */}
          <p
            className={
              'font-semibold tabular-nums ' +
              (assigned === 100 ? 'text-[var(--color-pick-win)]' : 'text-[var(--color-key)]')
            }
          >
            {assigned === 100
              ? '✓ Adds up to 100% of the pot'
              : assigned < 100
                ? `${assigned}% assigned — ${Math.round((100 - assigned) * 100) / 100}% unassigned`
                : `${assigned}% assigned — more than the pot`}
          </p>
        </section>
      ) : null}

      <button
        onClick={() => save.mutate()}
        disabled={!name.trim() || save.isPending}
        className="min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save settings'}
      </button>

      <PoolTabBar />
    </div>
  )
}
