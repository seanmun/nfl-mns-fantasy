# nfl-mns-fantasy

NFL pick'em on `nfl.mnsfantasy.com`. Vite + React + Vercel functions +
Neon (`nfl` schema). Platform-wide rules live in the workspace
`CLAUDE.md` one level up — read that first.

## Running it locally

```
vercel dev          # NOT npm run dev — that cannot serve /api
```

`.env.local` needs `pk_test_`/`sk_test_` Clerk keys and, ideally, a Neon
branch in `DATABASE_URL` so testing does not write into live pools.

This app does **not** use the hub's draft engine, so there is no
`PLATFORM_API_URL` production-mutation trap on that path.

## Shape

- **Pools** are season-long contests. `poolType` picks the game:
  `classic` (pick every game), `pick_n` (pick any N of the week's slate,
  N being `pools.picksRequired`), `confidence` (pick every game and rank
  them), `survivor` (one team a week, never reused).
- `spreadMode` is `straight_up` or `ats`, chosen at creation. Survivor is
  always straight-up; the create endpoint forces it.
- Pool creators are members of their own pool automatically, and are that
  pool's **admin** — slate, spreads, publish, manager's note, rules and
  announcements are all `pools.createdBy` checks, not a global env var.
  `ADMIN_USER_IDS` remains a site-wide override only.
- Members join by share link, join code, email invite, or by finding a
  public pool in search. All four resolve to the same entry insert.
- **A user may hold several entries in one pool**, capped by
  `pools.maxEntriesPerUser`. Everything downstream keys on `entryId`, so
  two entries owned by one person are independent contestants. Anything
  that groups by `userId` instead would merge them into one leaderboard
  row and double their points.

Everything the first real customer pool (Kongers Kitchen — `pick_n` with
N=5, ATS, 18 weeks, key pick) asked for is a **pool-level setting**, not
a special case. If you find yourself writing `if (poolId === ...)`, the
setting is missing.

The type is `pick_n`, never `pick5`. Another admin will pick 3 or 10 —
naming a type after one pool's number is how a setting quietly becomes a
hardcoded rule.

**The app handles no money.** No entry fees, no paid/unpaid ledger, no
pot, no processing. Admins settle up however they already do. This is a
deliberate scope decision, not an oversight — do not add it without
asking. Where these notes say "a pool with money in it", that is about
why correctness matters to members, not about funds moving through here.

## Each pool owns its own slate and its own numbers

This is the part that most differs from a naive pick'em.

`game_lines` holds the market line from The Odds API. **Nothing is graded
against it.** It exists to prefill and to give the admin something to
compare against.

The pool's real slate and real numbers live in `pool_games`, one row per
pool per game:

- `isIncluded` is the admin's per-week checklist. The "Friday through
  Monday only, except Thanksgiving and Christmas" rule is deliberately
  **not** encoded anywhere — it is one admin unticking Thursday games.
  That way the rule can differ per pool, change mid-season, and handle
  holidays without a special case that a calendar quirk eventually
  breaks.
- `spread` is that pool's official number, prefilled from `game_lines`
  and then overridable. **Grading reads this column and nothing else.**

`pools.lineSource` is `api` (prefill and publish automatically) or
`manual` (prefill, then wait for the admin's own numbers and his explicit
publish). Kongers Kitchen is `manual`.

Publishing is per pool per week (`pool_weeks.linesPublishedAt`), not
global. Until it is set, the week takes no picks at all. An included
game in an ATS pool with a null spread must block publishing — finding
that out at grading time is far too late.

## When a pick can be written

One rule, in `isPickable()`, and it is not just kickoff:

```
pool_weeks.linesPublishedAt is set
AND now < pool_weeks.pickDeadlineAt   (the whole week's cutoff)
AND now < games.kickoffAt             (this game's own cutoff)
```

Both halves are load-bearing. Without the deadline, Monday night stays
open after the auto-pick fill has already run. Without the kickoff check,
someone picks a Friday or Thanksgiving game on Sunday morning already
knowing how it went.

`pool_weeks.pickDeadlineAt` is **frozen at publish**, not derived on
read. Deriving it would recompute against a schedule that still moves —
flexed games, postponements — so a deadline could shift under members who
had already planned around it. It is computed from the slate, shown to
the admin, editable by him, then committed.

### Two things the live schedule taught us

**Timestamps are `timestamptz`, never bare `timestamp`.** A bare
`timestamp without time zone` drops the offset, so the driver writes a
UTC wall clock and reads it back as LOCAL time — the error is the
*reader's* offset. Verified 2026-08-14: a kickoff ESPN gave as
00:20Z came back as 04:20Z on a Mac in `America/New_York`, while a Vercel
function in UTC would have read the same row correctly. The same row
meaning different things in two places is how a laptop and production end
up disagreeing about whether picks are open.

**Midnight ET means "not scheduled yet", not midnight.** The NFL sets
late-season kickoff times only once playoff implications are known, and
ESPN marks the unknown ones as midnight ET — 24 of the 2026 season's 272
games, including all 16 of Week 18. Midnight is the worst possible
placeholder: a game stored at 00:00 reads as *already kicked off* from
one second past midnight, so it would sit locked all day and nobody could
pick it. `isTbdKickoff()` is the single definition, and it is honoured in
three places that each independently compare against kickoff —
`isPickable`, the pick validator's `locked()`, and the auto-fill's
eligibility filter. A week that is entirely TBD yields no deadline
anchor, so the admin types it.

### Deadlines are computed in Eastern time, never UTC

"Sunday 1pm ET" is 17:00Z for part of the season and 18:00Z after DST
ends. Computing it in UTC gets the cutoff wrong by an hour on one side of
1 November — in one direction it closes picks an hour early, which in a
pool with money in it is not a rounding error. `deadline.ts` uses `Intl`
with `America/New_York`, and the tests pin both sides of the change.

`sunday_1pm_et` means the first included game kicking off at or **after**
13:00 ET on Sunday — deliberately not "the first Sunday game", because
London games kick off at 9:30am ET.

When the anchor rule finds nothing, `anchorKickoff` returns null and the
admin types the deadline himself. Do not make it guess.

## Auto-pick at the deadline

Any entry short of its required picks gets the remainder assigned, plus a
key pick if it never designated one.

- Draws **only** from included games that have not kicked off. The
  Friday, Saturday and Thanksgiving games on the slate are history by
  Sunday afternoon.
- Fewer eligible games than picks owed is possible. Assign what there is
  and **log the shortfall** — silently returning a short set reads as
  success.
- `pool_weeks.autoPicksAppliedAt` makes the job idempotent. Without it a
  retry assigns a second set of random picks on top of the first.
- Assigned picks carry `picks.isAuto` and must be shown as such.
  Inventing someone's picks and displaying them as deliberate is how a
  pool loses trust.
- `picks.isKeyAuto` is a **separate** flag from `isAuto`. A member who
  chose their full slate deliberately but forgot to flag a key gets
  `isKeyAuto` only — marking their own pick as auto-generated would
  misreport what they actually did.
- `selectAutoPicks` takes an injectable RNG. Pass a seeded `mulberry32`
  and the assignment is reproducible, so "the app picked for me" is
  something the admin can demonstrate rather than assert.

## Writing picks

`src/lib/picks/validate.ts` holds every rule. It is pure, so the whole
rule set is testable without a database, and the endpoint's only job is
to load state, call it, and persist `effective` if it comes back clean.

The client sends the **full desired set** for the week, never a delta. A
delta protocol makes "remove this pick" and "I didn't mention it"
indistinguishable, which is how picks silently vanish.

Locked picks are **carried through automatically**. A client that sends
only the still-open games cannot delete a pick whose game has already
kicked off; an attempt to *change* one is rejected outright. Carried
picks still count toward the weekly limit.

**Partial saves are allowed on purpose.** Someone who picks three of five
on Saturday keeps their work, and is not forced to choose a key pick yet.
The deadline job tops up whatever is short and assigns a key if one is
still missing. Requiring a complete set here would throw away the
half-finished work of exactly the members most likely to need the
reminder.

## Picks are hidden until the deadline

Before `pool_weeks.pickDeadlineAt`, a member sees **only their own**
picks. After it, everyone's open up.

This is a read-path invariant and it is easy to break by accident — a
leaderboard query that joins picks, a week view that returns the whole
pool, an admin endpoint reused on a member page. Any endpoint returning
picks must filter to the caller's own entries until the deadline has
passed, and the check belongs in one shared helper rather than repeated
per route.

Note the deliberate consequence: an early game (Friday, Thanksgiving) can
be played and graded while who picked it is still hidden. The result is
public, the picks are not, until the week's cutoff.

## Pre-deadline reminder

One email per pool-week to members still short of their picks, sent
`pools.reminderHoursBefore` before the deadline (24 by default, which
puts a Sunday-1pm nudge on Saturday afternoon). Null disables it.

`pool_weeks.remindersSentAt` is the idempotency stamp, and it is written
**whether or not anything sent** — a pool where everyone had already
picked is finished for the week, and leaving it unstamped would rescan it
every hour until the deadline.

The opt-out is `pool_entries.emailReminders`, deliberately local rather
than routed through the hub's marketing preferences. "You have 0 of 5
picks in" is transactional — an obligation in a contest the member
joined — not marketing, and conflating the two would let a marketing
opt-out silently cost someone their week.

`sendAll` reports per-recipient failures instead of throwing on the
first. A blast that dies halfway is worse than one reporting "38 sent, 2
failed": nobody can tell who got it, and a naive retry re-sends to
everyone who did.

## The two crons

`/api/cron/sync-lines` — Tuesday. The **only** thing that spends Odds API
credits: one request, three of them. Writes reference lines into
`game_lines` and publishes nothing.

`/api/cron/tick` — hourly. One ESPN call, then everything that follows:
refresh scores and kickoffs, run any due auto-fills, grade active pools.
Deadlines are processed **before** grading so a member filled in this
hour is graded in the same pass instead of waiting another hour.

Tick precision does not matter, because **the deadline is enforced on
write**. A late tick can never let someone sneak a pick in; it only
delays the fill. That is what makes hourly adequate for an exact cutoff.

`syncWeek` refreshes kickoff times, not just scores. Flex scheduling
moves games, and a moved kickoff moves which games sit behind a pool's
deadline — `kickoffsChanged` is logged for that reason.

Seeding is `npm run seed:teams` then `npm run seed:schedule -- 2026`.
Both are re-runnable upserts.

## The Db type is load-bearing

Every service takes `Db` from `src/lib/db/types.ts`, which is
`NeonHttpDatabase<typeof schema>`. Declaring a local
`NeonHttpDatabase<Record<string, never>>` compiles fine in isolation and
then rejects the real client at every call site with a wall of
`$drizzleTypeError` noise. Same trap in the scripts: `drizzle(neon(url))`
without `{ schema }` produces a client nothing will accept.

## Key pick

One of the week's picks, designated by the member.

It **earns no extra weekly points** — it scores exactly like any other
pick. Key results accumulate across the season in
`pool_entries.keyPickScore`, and that total does exactly one thing: break
ties on cumulative points, and fill the second leaderboard column.

`compareStandings` is therefore the only place a key pick changes an
outcome. If key picks ever appear in the points maths, that is a bug.

A key **win** is always worth 1. A key **push** contributes
`scoringConfig.keyPushCredit`, which the admin sets — 0 (the default, a
push is not a win), 0.5 (mirrors the points column), or 1. That is why
the column is `real` and is called a score rather than a count of wins:
at `keyPushCredit: 0.5` a member can genuinely finish the season on 7.5.

## Grading

`grade.ts` is pure — no database, no clock, no feed — so regrading a
settled week is the same call as grading it live.

It refuses rather than guesses in two places, both of which would
otherwise produce plausible wrong numbers: an ATS pool with no published
spread, and a confidence pick with no rank.

`game_lines.spread` and `pool_games.spread` are both **home
perspective**: `-3.5` means the home team is favoured by 3.5.

ESPN hands you both conventions in one object and they disagree whenever
the away team is favoured — `details: "BAL -3.5"` sits next to
`spread: +3.5` on the same game. Read `spread`, never parse `details`.
The Odds API gives a per-team handicap instead, so the home team's own
`point` *is* the home-perspective value. Both are pinned by tests using
real 2026 Week 1 lines.

## Ties are real

`games.winnerTeamId` is null on a `final` game when the game was a tie.
Null-winner reads like "not played yet" and it is not — check
`status === 'final'` first. Survivor's `tiePolicy` decides what a tie
costs the entry that picked either side.

## Invariants Postgres cannot hold

They apply only to some pool types, and the type lives a table away.
Enforced in the write path and re-checked by the grader:

- **survivor** — one pick per `(entryId, weekId)`, and a team is never
  picked twice by the same entry all season.
- **confidence** — the week's confidence values are a permutation of
  1..N. Ordering trap: an early game locks days before the rest, so
  validation must treat already-locked values as taken and immovable.
- **key pick** — exactly one pick per `(entryId, weekId)` carries
  `isKeyPick`.

## Scoring config

Frozen into each pool at creation (`pools.scoring_config`), so changing
the defaults never rescores an existing pool.

There is deliberately **no column default**. Golf keeps one default in
its schema column and another in its scoring engine and has to warn that
the two must be hand-synced; here `DEFAULT_SCORING` in
`src/lib/scoring/config.ts` is the only source, and inserts must supply
it. Do not add a column default.

Deadline settings are *columns* on `pools`, not scoring keys, precisely
because the admin may change them mid-season — whereas scoring must not
move under a pool that has already started.

## Standings

`entry_weeks` is a rollup written by the grader. It is fully rebuildable
from `picks`, and if the two ever disagree, **picks win**.
`pool_entries.isEliminated` is likewise a cached read of
`strikes >= maxStrikes`; recompute from picks when regrading.

`rankStandings` uses competition ranking — entries level on both keys
share a rank and the next one skips (1, 2, 2, 4). Splitting a genuine tie
by row order is the kind of thing members notice when money is involved.

## Accessibility is a requirement here, not a nicety

The audience is older and largely non-technical. Picking five games and a
key pick has to be doable in under a minute, on a phone, by someone who
has never used an app like this.

- Base font is **18px** on `html`, not the 16px default. Everything
  downstream is in `rem`, so that scales the app in one place.
- Every colour pair in `index.css` was **measured**, not eyeballed. All
  text pairs clear WCAG AA (4.5:1) against their real backdrop.
- `--color-border` (#2a2a35) measures 1.39 against the background. That
  is acceptable for a decorative hairline and fails WCAG 1.4.11 for
  anything interactive, so tappable edges use
  `--color-border-interactive` (3.79 on background, 3.52 on card). The
  shared token is left alone so the platform chrome does not drift.
- `--color-locked` is the same grey as muted text on purpose. The dimmer
  grey it replaced measured 2.11 and was unreadable. Locked state is
  carried by an icon and the word "Locked" — colour must never be the
  only signal (WCAG 1.4.1).
- Tap targets clear 3rem on both axes, enforced at the base layer so no
  component has to remember.
- Focus rings are explicit; the browser default is nearly invisible on
  this background.

If you add a colour, measure it. There is a ratio helper in the session
notes, and the existing values are in this file for comparison.

## The rules page is generated, not typed

`src/lib/pools/describeRules.ts` turns a pool's own config into plain
English — pick count, push value, deadline, key-pick behaviour,
auto-pick, late joins, entry caps, survivor strikes, the lot.

It reads the **same fields the engine reads**, so the rules page and the
behaviour cannot drift. A hand-written rules page is correct exactly
once: the first time an admin changes the pick count or the push value,
the prose starts quietly lying, and nobody notices until it decides
money.

`pools.rulesMarkdown` renders *below* the generated rules, for what the
config cannot know — who collects, what the prize is, house etiquette.
Generated first, deliberately: those are the ones the app enforces.

If you add a pool setting, add it here too, with a test. The suite
asserts the prose changes when the config does.

Admin text renders through `src/components/Markdown.tsx`, which builds
**React elements, never an HTML string**. There is no
`dangerouslySetInnerHTML` in this app and no injection surface — the one
place it holds text written by one user and shown to others is not a
good place to be clever.

## Communication

- `pools.managerNote` — pinned note on the pool home page, editable any
  time.
- `pools.rulesMarkdown` — the pool's rules page.
- `pool_announcements` — a log of every email blast, not a queue. It
  exists so a resend is recognisable as a resend, so "did everyone get
  told" has an answer, and so a half-failed send is visible rather than
  assumed.

Both note and rules are **markdown, rendered** — not stored HTML. There
is nothing to sanitise and no XSS surface.

## vercel.json includeFiles is a glob on purpose

`src/lib/**/*.ts`, not a list of directories. The functions import from
`src/lib/db`, `scoring`, `sync`, `picks` and `email`, and an enumerated
list silently omits whichever one was added last — the function then
builds and deploys fine and dies at import time with
`FUNCTION_INVOCATION_FAILED`, which looks like a runtime bug rather than
a packaging one. That is exactly how `src/lib/picks` was missing on
2026-08-15: every pool endpoint returned 500 while typechecking clean.

## Build

`npm run build` runs `tsc -b`, which reaches `api/` through the
`tsconfig.api.json` project reference. If the API ever stops being
typechecked that reference has been removed — put it back, and verify by
dropping a deliberate type error into `api/`.

`npm test` runs the scoring suites. They are the closest thing this app
has to a spec for the rules above.

## Design tokens

`src/index.css` carries the platform `@theme` block verbatim from the
hub. It deliberately does **not** copy golf's alias layer
(`--color-surface`, `--color-text-primary`, …) — those exist only because
golf's components predate the tokens, and two names for one colour is how
the drift starts. Use the platform names directly.
