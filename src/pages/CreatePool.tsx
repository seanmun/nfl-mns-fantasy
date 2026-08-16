import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createApi, type CreatePoolInput } from '@/lib/api/client'
import { describeRules, type DescribePoolInput } from '@/lib/pools/describeRules'

// Creating a pool. The person here is the manager, not the older member
// the picks screen is built for — but the settings still decide how the
// whole season scores, so each one says what it does in plain terms and
// the generated rules preview updates live underneath.
//
// Everything has a working default. Naming the pool and pressing create
// produces a sensible pool; the rest is for managers who care.

type PoolType = CreatePoolInput['poolType']

const TYPES: Array<{ value: PoolType; label: string; blurb: string }> = [
  { value: 'pick_n', label: 'Pick a few', blurb: 'Members pick a set number of games each week. You choose how many.' },
  { value: 'classic', label: 'Pick them all', blurb: 'Members pick a winner in every game on the slate.' },
  { value: 'confidence', label: 'Confidence', blurb: 'Members pick every game and rank them. Best pick is worth the most.' },
  { value: 'survivor', label: 'Survivor', blurb: 'One team a week, never reused. A wrong pick knocks you out.' },
]

export function CreatePool() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const api = useMemo(() => createApi(getToken), [getToken])

  const [name, setName] = useState('')
  const [entryName, setEntryName] = useState('')
  const [poolType, setPoolType] = useState<PoolType>('pick_n')
  const [ats, setAts] = useState(true)
  const [picksRequired, setPicksRequired] = useState(5)
  const [keyPick, setKeyPick] = useState(true)
  const [pushPoints, setPushPoints] = useState(0.5)
  const [keyPushCredit, setKeyPushCredit] = useState(0)
  const [startWeek, setStartWeek] = useState(1)
  const [endWeek, setEndWeek] = useState(18)
  const [isPublic, setIsPublic] = useState(false)
  const [maxEntriesPerUser, setMaxEntriesPerUser] = useState(1)
  const [allowLateJoin, setAllowLateJoin] = useState(false)
  const [manualLines, setManualLines] = useState(false)
  const [sundayDeadline, setSundayDeadline] = useState(true)
  const [reminders, setReminders] = useState(true)

  // Winners circle — payout places, not scoring. See PrizesConfig.
  const [seasonPlaces, setSeasonPlaces] = useState(1)
  const [keyPlaces, setKeyPlaces] = useState(0)
  const [lastPlace, setLastPlace] = useState(false)
  const [segments, setSegments] = useState<
    Array<{ name: string; startWeek: number; endWeek: number; places: number }>
  >([])

  // Survivor has no spread to beat, so the server forces straight-up.
  // Reflected here rather than letting the form imply otherwise.
  const spreadMode = poolType === 'survivor' ? 'straight_up' : ats ? 'ats' : 'straight_up'
  const usesKeyPick = poolType === 'pick_n' && keyPick

  const scoring: Record<string, unknown> =
    poolType === 'survivor'
      ? { maxStrikes: 1, tiePolicy: 'survive', missedPickPolicy: 'eliminate' }
      : poolType === 'confidence'
        ? { pushBehavior: 'award', tiebreaker: 'last_game_total' }
        : {
            winPoints: 1,
            pushPoints,
            ...(poolType === 'pick_n'
              ? { picksRequired, keyPick, keyPushCredit, tiebreaker: 'key_pick_score' }
              : { tiebreaker: 'last_game_total' }),
          }

  const preview: DescribePoolInput = {
    poolType,
    spreadMode,
    picksRequired: poolType === 'pick_n' ? picksRequired : poolType === 'survivor' ? 1 : null,
    startWeek,
    endWeek,
    allowLateJoin,
    maxEntriesPerUser,
    deadlineAnchor: sundayDeadline ? 'sunday_1pm_et' : 'first_included_kickoff',
    deadlineOffsetMinutes: 0,
    lineSource: manualLines ? 'manual' : 'api',
    reminderHoursBefore: reminders ? 24 : null,
    scoringConfig: scoring,
  }

  const create = useMutation({
    mutationFn: () =>
      api.createPool({
        name,
        poolType,
        spreadMode,
        picksRequired: poolType === 'pick_n' ? picksRequired : null,
        startWeek,
        endWeek,
        isPublic,
        maxEntriesPerUser,
        allowLateJoin,
        lineSource: manualLines ? 'manual' : 'api',
        deadlineAnchor: sundayDeadline ? 'sunday_1pm_et' : 'first_included_kickoff',
        deadlineOffsetMinutes: 0,
        reminderHoursBefore: reminders ? 24 : null,
        scoring,
        prizes: {
          seasonPlaces,
          keyPlaces: usesKeyPick ? keyPlaces : 0,
          lastPlace,
          segments,
        },
        // Blank falls back server-side to the member's handle.
        entryName: entryName.trim(),
      }),
    onSuccess: (r) => {
      toast.success('Pool created')
      navigate(`/lm/${r.pool.id}/week`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="px-4 py-8 flex flex-col gap-8 pb-32">
      <div>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-1">
          New pool
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Create a pool</h1>
        <p className="text-[var(--color-muted-foreground)] mt-2">
          You&rsquo;ll run it — setting the games and spreads each week, and inviting
          people. You&rsquo;re in it too.
        </p>
      </div>

      <Section title="Basics">
        <Field label="Pool name" hint="What members will see. E.g. Kongers Kitchen.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kongers Kitchen"
            className={inputClass}
          />
        </Field>
        <Field label="Your entry name" hint="How you appear on the leaderboard.">
          <input
            value={entryName}
            onChange={(e) => setEntryName(e.target.value)}
            placeholder="My entry"
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="How it plays">
        <div className="flex flex-col gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setPoolType(t.value)}
              aria-pressed={poolType === t.value}
              className={
                'text-left p-3 rounded-xl border-2 ' +
                (poolType === t.value
                  ? 'border-[var(--color-accent)] bg-[#0d2a1c]'
                  : 'border-[var(--color-border-interactive)] bg-[var(--color-card)]')
              }
            >
              <b className="block">{t.label}</b>
              <span className="text-[0.9rem] text-[var(--color-muted-foreground)]">{t.blurb}</span>
            </button>
          ))}
        </div>

        {poolType === 'pick_n' ? (
          <Field label="How many picks a week?" hint="Five is the usual.">
            <input
              type="number"
              min={1}
              max={16}
              value={picksRequired}
              onChange={(e) => setPicksRequired(Math.max(1, Number(e.target.value)))}
              className={inputClass + ' w-28 text-center'}
            />
          </Field>
        ) : null}

        {poolType !== 'survivor' ? (
          <Toggle
            checked={ats}
            onChange={setAts}
            label="Against the spread"
            hint="Off means straight up — just pick the winner."
          />
        ) : null}

        {poolType === 'pick_n' ? (
          <Toggle
            checked={keyPick}
            onChange={setKeyPick}
            label="Key pick"
            hint="Members mark one pick a week. Worth no extra points — it breaks ties."
          />
        ) : null}
      </Section>

      {poolType !== 'survivor' && poolType !== 'confidence' ? (
        <Section title="Scoring">
          <Field
            label="A push is worth"
            hint={ats ? 'When a pick lands exactly on the number.' : 'When a game ends in a tie.'}
          >
            <input
              type="number"
              step="0.5"
              min={0}
              max={1}
              value={pushPoints}
              onChange={(e) => setPushPoints(Number(e.target.value))}
              className={inputClass + ' w-28 text-center'}
            />
          </Field>
          {usesKeyPick ? (
            <Field
              label="A key pick that pushes counts"
              hint="Toward the key total that breaks ties. 0 means a push is not a win."
            >
              <input
                type="number"
                step="0.5"
                min={0}
                max={1}
                value={keyPushCredit}
                onChange={(e) => setKeyPushCredit(Number(e.target.value))}
                className={inputClass + ' w-28 text-center'}
              />
            </Field>
          ) : null}
        </Section>
      ) : null}

      <Section title="Winners circle">
        <Field
          label="Season points pays out the top"
          hint="How many places win on total season points. Ties share a place."
        >
          <input
            type="number"
            min={1}
            max={100}
            value={seasonPlaces}
            onChange={(e) => setSeasonPlaces(Math.max(1, Number(e.target.value) || 1))}
            className={inputClass + ' w-28 text-center'}
          />
        </Field>
        {usesKeyPick ? (
          <Field
            label="Key picks ★ pays out the top"
            hint="0 means the key total only breaks ties and pays nothing."
          >
            <input
              type="number"
              min={0}
              max={100}
              value={keyPlaces}
              onChange={(e) => setKeyPlaces(Math.max(0, Number(e.target.value) || 0))}
              className={inputClass + ' w-28 text-center'}
            />
          </Field>
        ) : null}
        <Toggle
          checked={lastPlace}
          onChange={setLastPlace}
          label="Last place wins something"
          hint="The season's last place joins the winners circle. Every pool has one hero."
        />

        <div className="flex flex-col gap-3">
          <p className="font-semibold">
            Segments
            <span className="block text-[0.85rem] font-normal text-[var(--color-muted-foreground)]">
              Extra races over any span of weeks — bi-weekly, monthly, thirds of the
              season. Each pays its own top places on points earned inside the span.
            </span>
          </p>
          {segments.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--color-border)] p-3 flex flex-wrap items-end gap-3"
            >
              <label className="flex flex-col gap-1 text-[0.85rem] font-semibold">
                Name
                <input
                  value={s.name}
                  onChange={(e) =>
                    setSegments(segments.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  className={inputClass + ' w-36'}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.85rem] font-semibold">
                Weeks
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={startWeek}
                    max={endWeek}
                    value={s.startWeek}
                    onChange={(e) =>
                      setSegments(
                        segments.map((x, j) =>
                          j === i ? { ...x, startWeek: Number(e.target.value) } : x
                        )
                      )
                    }
                    className={inputClass + ' w-20 text-center'}
                  />
                  &ndash;
                  <input
                    type="number"
                    min={startWeek}
                    max={endWeek}
                    value={s.endWeek}
                    onChange={(e) =>
                      setSegments(
                        segments.map((x, j) =>
                          j === i ? { ...x, endWeek: Number(e.target.value) } : x
                        )
                      )
                    }
                    className={inputClass + ' w-20 text-center'}
                  />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-[0.85rem] font-semibold">
                Pays top
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={s.places}
                  onChange={(e) =>
                    setSegments(
                      segments.map((x, j) =>
                        j === i ? { ...x, places: Math.max(1, Number(e.target.value) || 1) } : x
                      )
                    )
                  }
                  className={inputClass + ' w-20 text-center'}
                />
              </label>
              <button
                type="button"
                onClick={() => setSegments(segments.filter((_, j) => j !== i))}
                className="min-h-[var(--tap-target-min)] px-3 rounded-lg border-2 border-[var(--color-border-interactive)] font-bold text-[var(--color-muted-foreground)]"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setSegments([
                ...segments,
                {
                  name: `Segment ${String.fromCharCode(65 + segments.length)}`,
                  startWeek,
                  endWeek,
                  places: 1,
                },
              ])
            }
            className="min-h-[var(--tap-target-min)] rounded-lg border-2 border-dashed border-[var(--color-border-interactive)] font-bold text-[var(--color-muted-foreground)]"
          >
            + Add a segment
          </button>
        </div>
      </Section>

      <Section title="Timing">
        <div className="flex gap-3">
          <Field label="From week">
            <input
              type="number"
              min={1}
              max={18}
              value={startWeek}
              onChange={(e) => setStartWeek(Number(e.target.value))}
              className={inputClass + ' w-24 text-center'}
            />
          </Field>
          <Field label="To week">
            <input
              type="number"
              min={1}
              max={18}
              value={endWeek}
              onChange={(e) => setEndWeek(Number(e.target.value))}
              className={inputClass + ' w-24 text-center'}
            />
          </Field>
        </div>
        <Toggle
          checked={sundayDeadline}
          onChange={setSundayDeadline}
          label="Picks close at the Sunday 1pm kickoff"
          hint="Off means they close at the first game of the week instead."
        />
        <Toggle
          checked={reminders}
          onChange={setReminders}
          label="Email a reminder the day before"
          hint="Only to members who still have picks missing."
        />
      </Section>

      <Section title="Access">
        <Toggle
          checked={manualLines}
          onChange={setManualLines}
          label="I set the spreads myself"
          hint="Off means the market line is used, and you can still adjust it."
        />
        <Toggle
          checked={isPublic}
          onChange={setIsPublic}
          label="Anyone can find this pool"
          hint="Off means people need your link or code."
        />
        <Toggle
          checked={allowLateJoin}
          onChange={setAllowLateJoin}
          label="Allow joining after it starts"
          hint="Latecomers score nothing for weeks they missed."
        />
        <Field label="Entries one person can hold" hint="1 is the usual.">
          <input
            type="number"
            min={1}
            max={20}
            value={maxEntriesPerUser}
            onChange={(e) => setMaxEntriesPerUser(Math.max(1, Number(e.target.value)))}
            className={inputClass + ' w-28 text-center'}
          />
        </Field>
      </Section>

      {/* The same generator that produces the pool's rules page, run on
          the settings as they stand. What you read here is exactly what
          members will read, and exactly what the engine will do. */}
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-3">
          The rules this makes
        </h2>
        <div className="flex flex-col gap-4">
          {describeRules(preview).map((s) => (
            <div key={s.heading}>
              <b className="block mb-1">{s.heading}</b>
              <ul className="flex flex-col gap-1 text-[0.95rem] text-[var(--color-muted-foreground)]">
                {s.items.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="fixed left-0 right-0 bottom-0 bg-[var(--color-card)] border-t border-[var(--color-border-interactive)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          onClick={() => create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="w-full min-h-[var(--tap-target-min)] rounded-lg bg-[var(--color-accent)] text-[var(--color-background)] font-extrabold text-[1.05rem] disabled:bg-[var(--color-border-interactive)] disabled:text-[var(--color-card)]"
        >
          {create.isPending ? 'Creating…' : 'Create pool'}
        </button>
      </div>
    </div>
  )
}

const inputClass =
  'min-h-[var(--tap-target-min)] px-3 rounded-lg bg-[var(--color-muted)] border-2 border-[var(--color-border-interactive)] text-[var(--color-foreground)] w-full'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)] border-b border-[var(--color-border)] pb-1">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      {hint ? <span className="text-[0.85rem] text-[var(--color-muted-foreground)]">{hint}</span> : null}
      <span className="mt-1">{children}</span>
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-6 h-6 mt-0.5 accent-[var(--color-accent)] shrink-0"
      />
      <span className="flex flex-col">
        <span className="font-semibold">{label}</span>
        {hint ? <span className="text-[0.85rem] text-[var(--color-muted-foreground)]">{hint}</span> : null}
      </span>
    </label>
  )
}
