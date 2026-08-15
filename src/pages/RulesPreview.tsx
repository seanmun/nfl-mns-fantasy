import { PoolRules } from './PoolRules'
import { DEFAULT_SCORING } from '@/lib/scoring/config'
import type { DescribePoolInput } from '@/lib/pools/describeRules'

// Kongers Kitchen exactly as it will be configured, so the generated
// rules can be read against a real pool before the pool API exists.
// Delete this route once /pool/:id/rules is live.
const KONGERS: DescribePoolInput = {
  poolType: 'pick_n',
  spreadMode: 'ats',
  picksRequired: 5,
  startWeek: 1,
  endWeek: 18,
  allowLateJoin: false,
  maxEntriesPerUser: 1,
  deadlineAnchor: 'sunday_1pm_et',
  deadlineOffsetMinutes: 0,
  lineSource: 'manual',
  reminderHoursBefore: 24,
  scoringConfig: DEFAULT_SCORING.pick_n,
}

const MANAGER_NOTE = `Welcome back for another year.

**Money is due before Week 1** — same as always, Venmo me or catch me at the shop. $50 for the season.

Payouts:

- Season winner takes 60%
- Second takes 25%
- Most key picks takes 15%

Any arguments come to me, not the group chat.`

export function RulesPreview() {
  return (
    <PoolRules poolName="Kongers Kitchen" pool={KONGERS} rulesMarkdown={MANAGER_NOTE} />
  )
}
