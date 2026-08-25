import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'
import { PoolTabBar } from '@/components/layout/PoolTabBar'

// Pool Settings — the owner-verbs page. Name, note, rules, reminder
// timing. Everything else stays where it lives (slate on Manage Week,
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

  const save = useMutation({
    mutationFn: () =>
      api.updatePoolSettings(poolId, { name: name.trim(), managerNote: note }),
    onSuccess: () => {
      toast.success('Saved')
      qc.invalidateQueries({ queryKey: ['picks', poolId] })
      qc.invalidateQueries({ queryKey: ['my-pools'] })
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
