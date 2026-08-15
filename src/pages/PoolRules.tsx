import { Markdown } from '@/components/Markdown'
import { describeRules, type DescribePoolInput } from '@/lib/pools/describeRules'

// The pool's rules page.
//
// Two halves, and the order matters. The generated rules come FIRST
// because they are the ones the app actually enforces — they are read
// out of the same config the scoring engine reads, so they cannot drift
// the way hand-written prose does. The manager's own text follows, for
// what the config cannot know: who collects, what the prize is, house
// etiquette.
export function PoolRules({
  poolName,
  pool,
  rulesMarkdown,
}: {
  poolName: string
  pool: DescribePoolInput
  rulesMarkdown?: string | null
}) {
  const sections = describeRules(pool)

  return (
    <div className="px-4 py-8 flex flex-col gap-8">
      <div>
        <p className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-1">
          Pool rules
        </p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight text-balance">{poolName}</h1>
      </div>

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section
            key={section.heading}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
          >
            <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-3">
              {section.heading}
            </h2>
            <ul className="flex flex-col gap-3">
              {section.items.map((item, i) => (
                <li key={i} className="flex gap-3 leading-relaxed">
                  {/* A marker, not a bullet glyph — it stays aligned with
                      the first line at this text size. */}
                  <span
                    aria-hidden="true"
                    className="mt-[0.6em] h-[0.35rem] w-[0.35rem] shrink-0 rounded-full bg-[var(--color-muted-foreground)]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {rulesMarkdown?.trim() ? (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h2 className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-[var(--color-accent)] mb-3">
            From the pool manager
          </h2>
          <Markdown source={rulesMarkdown} className="leading-relaxed" />
        </section>
      ) : null}

      <p className="text-[0.85rem] text-[var(--color-muted-foreground)] leading-relaxed">
        These rules are generated from this pool&rsquo;s own settings, so they always
        match how the app actually scores. If the manager changes a setting, this
        page changes with it.
      </p>
    </div>
  )
}
