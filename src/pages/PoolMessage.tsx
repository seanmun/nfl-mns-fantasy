import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi } from '@/lib/api/client'
import { kickoffLabel } from '@/lib/utils'

// The admin's blast composer. Every send is logged and listed below the
// form, so a resend is recognisable as a resend and a half-failed send
// is visible instead of assumed.
export function PoolMessage() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])
  const qc = useQueryClient()

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [confirming, setConfirming] = useState(false)

  const { data: pulse, isLoading } = useQuery({
    queryKey: ['admin-pulse', poolId],
    queryFn: () => api.getAdminPulse(poolId),
  })

  const send = useMutation({
    mutationFn: () => api.announce(poolId, subject.trim(), body.trim()),
    onSuccess: (r) => {
      setConfirming(false)
      setSubject('')
      setBody('')
      toast.success(
        r.failed
          ? `Sent to ${r.sent}, ${r.failed} failed — see the log below`
          : `Sent to ${r.sent} ${r.sent === 1 ? 'member' : 'members'}`
      )
      qc.invalidateQueries({ queryKey: ['admin-pulse', poolId] })
    },
    onError: (e: Error) => {
      setConfirming(false)
      toast.error(e.message)
    },
  })

  if (isLoading) {
    return <p className="px-4 py-12 text-[var(--color-muted-foreground)]">Loading&hellip;</p>
  }
  if (!pulse) {
    return (
      <div className="px-4 py-12">
        <h1 className="text-[1.3rem] font-bold mb-2">Managers only</h1>
        <p className="text-[var(--color-muted-foreground)]">
          Only this pool&rsquo;s admins can message the members.
        </p>
      </div>
    )
  }

  const ready = subject.trim().length > 0 && body.trim().length > 0

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
      <div>
        <Link
          to={`/pool/${poolId}`}
          className="inline-flex items-center min-h-[var(--tap-target-min)] font-bold text-[var(--color-accent)]"
        >
          &larr; Pool home
        </Link>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Message members</h1>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          Emails every member — {pulse.memberCount}{' '}
          {pulse.memberCount === 1 ? 'person' : 'people'}, one copy each no matter how many
          entries they hold.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="font-semibold" htmlFor="msg-subject">
          Subject
        </label>
        <input
          id="msg-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          placeholder="e.g. Deadline moved to Saturday noon"
          className="min-h-[var(--tap-target-min)] px-4 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)]"
        />
        <p className="text-[0.85rem] text-[var(--color-muted-foreground)] -mt-1">
          Lands as &ldquo;[{'{pool}'}] your subject&rdquo; in their inbox.
        </p>

        <label className="font-semibold" htmlFor="msg-body">
          Message
        </label>
        <textarea
          id="msg-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          maxLength={4000}
          placeholder="Write it like a text to the group…"
          className="px-4 py-3 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)] leading-relaxed"
        />

        {confirming ? (
          <div className="rounded-xl border-2 border-[var(--color-key)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
            <b>
              Send to {pulse.memberCount} {pulse.memberCount === 1 ? 'member' : 'members'}?
            </b>
            <p className="text-[0.9rem] text-[var(--color-muted-foreground)]">
              There&rsquo;s no unsend. It goes out from MNS Fantasy with you as the
              manager.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => send.mutate()}
                disabled={send.isPending}
                className="flex-1 min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-key)] text-[var(--color-background)] font-extrabold disabled:opacity-50"
              >
                {send.isPending ? 'Sending…' : 'Yes, send it'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="min-h-[var(--tap-target-min)] px-5 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={!ready}
            className="min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold disabled:opacity-40"
          >
            Review &amp; send
          </button>
        )}
      </div>

      {pulse.recentAnnouncements.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
            Recent messages
          </h2>
          <ul className="flex flex-col gap-2">
            {pulse.recentAnnouncements.map((a) => (
              <li
                key={a.sentAt}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 flex items-baseline justify-between gap-3"
              >
                <b className="truncate">{a.subject}</b>
                <span className="shrink-0 text-[0.85rem] text-[var(--color-muted-foreground)] tabular-nums">
                  {kickoffLabel(a.sentAt)} · {a.recipientCount} sent
                  {a.failedCount ? (
                    <b className="text-[var(--color-pick-loss)]"> · {a.failedCount} failed</b>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
