# Postmortem: Monday night games never scored (Weeks 1–2, 2026)

**Found:** 2026-09-24 17:20Z. **Fixed in code:** same session (uncommitted
at time of writing). **Live impact:** the one open pool, Bada Bing
(`77112cc6-…`), 17 entries.

## What members saw

Every pick on the Monday night game of Week 1 (DEN@KC) and Week 2
(NYG@LAR) showed as undecided, ten days after the games ended. Five
entries were a point short on the season total, standings were ranked
on those short totals, and no week-results email went out for either
week.

## Measured timeline (all times UTC)

| When | What the data shows |
|---|---|
| Sep 09 10:32 | Week 1 published in Bada Bing (`pool_weeks.lines_published_at`) |
| Sep 13 17:00:36 | Week 1 deadline; auto-picks applied |
| Sep 15 00:00:36 | Tick fetches Week 1. DEN@KC (kickoff 00:15) still `scheduled`, 0-0. **Last fetch of Week 1, ever.** |
| Sep 15 01:00 → | `currentWeek()` now returns Week 2, because Week 1's last kickoff (00:15) is in the past. The tick fetches only Week 2 from here on. |
| Sep 15 ~03:30 | DEN@KC ends KC 31, DEN 10 (from the feed, read 2026-09-24). Our row never changes. |
| Sep 17 18:18 | Week 2 published |
| Sep 20 17:00:36 | Week 2 deadline; auto-picks applied |
| Sep 22 00:00:35 | Tick fetches Week 2. NYG@LAR (kickoff 00:15) still `scheduled`. **Last fetch of Week 2, ever.** |
| Sep 22 ~03:30 | NYG@LAR ends LAR 28, NYG 6. Our row never changes. |
| Sep 24 16:08 | Week 3 published |
| Sep 24 17:15:36 | Tick fetches Week 3 only |
| Sep 24 17:20 | Investigation starts. Database shows exactly two games in the whole season that have kicked off and are not final: those two. |

## Impact, exactly

Ten picks in `nfl.picks` with `result = 'pending'` on games that had
kicked off. All in the open Bada Bing pool. Graded by hand against the
pool's own spread (`pool_games.spread`, equal to each pick's
`line_spread_at_pick`) and the feed's final score:

| Week | Game, result, line | Entry | Pick | Should be | Total change |
|---|---|---|---|---|---|
| 1 | DEN@KC, KC 31-10, KC -3 | Seanmun | KC | win | 4.5 → 5.5 |
| 1 | | trackguy439 | DEN | loss | none |
| 1 | | wolfmanjoe (auto) | KC | win | 4 → 5 |
| 2 | NYG@LAR, LAR 28-6, LAR -7 | Bada Birds | LAR | win | 2 → 3 |
| 2 | | Seanmun (key) | NYG | loss | none |
| 2 | | bumpereno | NYG | loss | none |
| 2 | | bumpsucks (key, auto) | NYG | loss | none |
| 2 | | joeybagadonuts | LAR | win | 4.5 → 5.5 |
| 2 | | thekid | LAR | win | 4.5 → 5.5 |
| 2 | | wolfmanjoe (auto) | NYG | loss | none |

Key-pick scores do not change: both key picks on these games lost.
Ranks change for most of the table once the five totals move.

Also never sent: the Week 1 and Week 2 results emails
(`pool_weeks.results_email_sent_at` is null for both). `dueForResults`
correctly refuses to send while any included game is undecided, so it
waited on the same stuck game.

Not affected: the older Bada Bing pool (`7f1aec3a-…`, no published
weeks), the three QA pools on `test` weeks (a different sync path, see
below), and Weeks 3 onward (not yet played). The QA Test Pool entries
whose totals do not match their pick sums are old test data with picks
removed, unrelated to this.

## Root cause

`api/cron/tick.ts` fetched scores for exactly one week per hour:
`currentWeek()`. That function is defined in `src/lib/sync/schedule.ts`
as *the first week whose last kickoff is still in the future*. It is the
right answer to "which week are members acting in": the moment a week's
last game kicks off, nobody can pick in that week any more, so the app
moves on.

It is the wrong answer to "which weeks need their scores refreshed". A
week needs refreshing until its last game is **final**, not until its
last game **kicks off**. Those two moments are about three and a half
hours apart, and in that window `currentWeek()` already points at the
next week. So the last game of every week was fetched for the final time
at the tick before it started, and never again.

Why it was exactly the Monday night game and nothing else: every other
game's final arrives while some later game in the same week has not yet
kicked off, which keeps the week "current". Only the week's last kickoff
has no later kickoff holding the week open. (Two games sharing the last
kickoff time would both be affected.)

## Why nothing caught it for ten days

Four silences stacked:

1. **`currentWeek()` had no test.** It is a database function and its
   calendar semantics were never pinned. Its comment described the pick
   question, and the sync path reused it without anyone stating the
   second question was different.
2. **The QA weeks use a different sync path.** Test pools run on `test`
   weeks whose games carry `test-` feed ids and are synced by
   `syncTestWeeks()`, which selects games by *membership in a test week*
   — every game, every tick, regardless of calendar. The preseason dry
   run therefore could not reproduce this; the production path was the
   only one with the calendar filter.
3. **The grader skips non-final games without comment.** `gradePoolWeek`
   does `if (game.status !== 'final') continue`. That is correct for a
   game next Sunday and indistinguishable from a game that ended nine
   days ago. The tick's `problems` array records only grading
   *exceptions*, and a skipped game is not one.
4. **The results email waits silently too.** `dueForResults` skips the
   week when any included game is undecided, which is right, but it
   meant the one thing that would have prompted "where is the Week 1
   email?" was itself suppressed by the same stuck row.

The tick's JSON reported `ok: true` every hour.

This should have been caught before Week 1. The preseason dry run was
the right idea and tested the wrong path: its `test` weeks are synced by
`syncTestWeeks`, which has no calendar filter, so the one selector that
production actually used was never exercised end to end. A replay of
the real schedule through the production selector (now
`season.test.ts`) would have named `Week 1 DEN@KC` as lost before a
single pick was made.

## The fix

Three files plus tests and docs. Working tree only; not committed.

**1. Sync by game state, never by calendar.** `schedule.ts` gains:

- `isSettled(status)` — `final` or `cancelled`. Terminal; never fetch again.
- `unsettledKickedOff(games, now)` — pure. Games whose kickoff is at or
  before `now` and whose status is not settled.
- `weeksNeedingSync(db, season, now)` — the weeks holding such games, in
  week order, plus the games themselves for reporting. Excludes `test`
  weeks (different path, no feed code).

`tick.ts` now fetches every week in that set **plus** the current week
(kickoff times move, and moved kickoffs move deadlines). The set is
normally one week; it is two from Monday night until that final lands;
it is never zero for a game that has been played. The extra cost is
about three scoreboard calls a week, on a free feed.

**2. One bad week cannot stop the rest.** Each week is fetched in its
own `try/catch`. A failure is recorded in `syncFailures` and grading
still runs for everything else this hour. Before, one throw ended the
whole tick before grading.

**3. Staleness is loud.** After fetching, the tick recomputes what is
still undecided. Any game undecided **six hours after kickoff** — longer
than any NFL game plus a weather delay — is listed in `staleGames` in
the tick JSON and logged with `console.error`. An empty array is now a
positive assertion that no played game is stuck. This is the alarm that
would have fired at 06:15Z on 2026-09-15, not on the standings on
2026-09-24.

**4. A late results email cannot be sent.** `resultsWindow()` is the
one rule for when the weekly results email may go: the morning after
the last kickoff, one day of grace, then expired forever. The tick
stamps expired weeks and reports them. Before this, a backlog of any
size would have been mailed in full the moment it was decided.

**5. The whole season is replayed, hour by hour, in the test suite.**
`src/lib/sync/season.test.ts` holds the real 2026 schedule (272 games,
exported from `nfl.games`) and runs every hourly tick from September 1
to January 20 through the tick's exact selection functions
(`pickCurrentWeek` + `unsettledKickedOff`) against a simulated feed
where a game is final 3.5 hours after kickoff. A game reaches `final`
in the replay only when its week is fetched after the feed has it
final, which is the production mechanism. It asserts that the old rule
loses exactly the 17 last-kickoff games of Weeks 1 to 17 and that the
current rule loses none, and repeats that with no ticks at all for 72
hours over a Monday night and with a Sunday game postponed to the
Tuesday after its week's Monday night.

**6. The rule is pinned.** `src/lib/sync/schedule.test.ts` uses the real
Week 1 Monday night timestamps: at the 01:00Z tick that used to drop it,
Week 1 is still in the fetch set; nine days later it still is if the
final never landed; it leaves once the game is final; in-play and
postponed games are fetched, cancelled ones are not; a future game is
not. `currentWeek()` carries a comment saying it must not decide what to
sync, and the tick's header and `CLAUDE.md` say the same.

`npm test`: 113 passed. `npm run build` (includes the `api/` typecheck):
clean.

## Why this cannot recur

The invariant: **a game that has kicked off is fetched every tick until
it is final or cancelled.** The fetch set is computed from every game
row in the season by that one predicate. There is no week number, no
weekday, no date arithmetic and no "current" anything in it. The
calendar cannot drop a game because the calendar is not consulted.

### Measured on the real 2026 schedule, not reasoned about

`season.test.ts` replays all 272 games through both rules. Under the old
rule these 17 games never reach `final`, one per week, each the week's
last kickoff:

| Week | Lost under the old rule | Why it matters |
|---|---|---|
| 1 | DEN@KC | happened |
| 2 | NYG@LAR | happened |
| 3 | PHI@CHI | **this Monday, Sept 28** |
| 4 | ATL@NO | |
| 5 | BUF@LAR | |
| 6 | WSH@SF | |
| 7 | DAL@PHI | |
| 8 | CHI@SEA | |
| 9 | BUF@MIN | |
| 10 | LAC@BAL | |
| 11 | CIN@WSH | |
| 12 | CAR@TB | **Thanksgiving week** (three Thursday games and Black Friday are earlier in the week and were never at risk; the Monday night game was) |
| 13 | DAL@SEA | |
| 14 | PIT@JAX | |
| 15 | NE@KC | |
| 16 | NYG@DET | **Christmas week** (Christmas Day games are Friday; the Monday night game was the one at risk) |
| 17 | HOU@GB | |
| 18 | none | survived by accident: with no later week, `currentWeek()` falls back to the last week |

Under the current rule: **0 lost**, and still 0 with no ticks for 72
hours over a Monday night, and still 0 with a Sunday game postponed to
the Tuesday after its week's Monday night.

### The calendar cases, one by one

- **This Monday (Week 3, PHI@CHI, kickoff 00:15Z Tue Sept 29).** At the
  01:00Z tick `currentWeek()` is Week 4 and `weeksNeedingSync()` is
  {Week 3}; both are fetched. The game goes final around 03:30Z; the
  04:00Z tick fetches Week 3, records the final, and grading runs in the
  same pass. Week 3 then leaves the set.
- **Thanksgiving (Week 12).** Three Thursday games and Friday's game are
  final while Sunday's games have not kicked off, so the week is still
  current anyway. The Monday night game is handled like every other.
  The rule never reads the weekday.
- **Christmas (Week 16).** Christmas Day games on Friday, four
  placeholder kickoffs, Monday night. Same as above. Placeholders (see
  next) only ever cause extra fetches, never missed ones.
- **Week 18 and every midnight-ET placeholder.** Sixteen Week 18 games
  and four each in Weeks 16 and 17 sit at midnight ET of game day until
  the NFL sets times. The current week is fetched hourly, which is what
  updates those kickoffs the moment the feed has them. If a placeholder
  is ever still in place when its day arrives, it reads as kicked off,
  which puts its week into the fetch set (harmless, one extra call) and
  after six hours into `staleGames` (a human looks). Over-fetching is
  the safe direction; the old rule under-fetched.
- **Two games sharing a week's last kickoff.** Both are in the set until
  both are final. The old rule lost both.
- **Postponement.** A `postponed` game is unsettled, so its week stays
  in the set; the hourly fetch picks up the new kickoff when the feed
  sets it, and the game is fetched until final. Replayed in the suite.
- **Overtime, weather delays.** Fetching continues for as long as the
  game is undecided. The six-hour mark is only when it becomes loud.
- **Tick outage.** The set is derived from state, so any number of
  missed hours recover completely on the first tick that runs. The old
  rule could never recover: once the week rolled, the selector had no
  path back. Replayed with a 72-hour gap in the suite.
- **The postseason.** `currentWeek()` looks at regular-season weeks
  only, as before. `weeksNeedingSync()` covers `pre`, `regular` and
  `post`, so a playoff game that kicks off is fetched until final. No
  pool currently runs past Week 18.

### What still has to be true, and what happens if it is not

1. **The tick runs.** If it does not run, nothing syncs and nothing
   grades; when it runs again it catches up in full (above).
2. **The feed eventually reports the game completed.** If it never
   does, the game is fetched every hour forever and `staleGames` names
   it on every tick from six hours after kickoff, in the JSON and as a
   `console.error`. It cannot be silent.
3. **Nobody reintroduces a calendar filter on the sync path.** The
   `currentWeek()` comment, the tick header, `CLAUDE.md`, and
   `season.test.ts` all stand in the way, and the last one fails the
   build the moment a single game is lost on the real schedule.

The one-line version of the fix, "also fetch the previous week", was
rejected: it is the same calendar reasoning with a different constant,
and the postponement replay above breaks it.

## Recovery: automatic, no data touched by hand

On the first tick after deploy, `weeksNeedingSync` returns Weeks 1 and 2
(the only weeks with a kicked-off, unsettled game in the database).
Both are fetched, both games land as `final` with their scores, and the
existing grading loop — which already grades **every** published
pool-week every hour, not just the current one — grades the ten picks
and rebuilds the standings. Expected result: the table above.

**No email results from this. None.** Before this fix the results
email had no upper bound: `dueForResults` sent a week's results on any
tick after its morning-after, however late. Catching up two weeks at
once would therefore have mailed "Week 1 results" and "Week 2 results"
to every member during Week 3. That is now impossible by code:
`resultsWindow()` in `src/lib/email/resultsWindow.ts` allows a send only
on the Eastern day after the last kickoff (from 8am) or the day after
that; anything later is **expired**, stamped as done via
`markResultsSkipped`, listed in the tick JSON as `resultsExpired`, and
never sent. Both Weeks 1 and 2 are expired as of 2026-09-24, pinned in
`resultsWindow.test.ts` with the real dates. Nothing else in the tick can
mail for those weeks: the pre-deadline reminder only considers weeks
whose deadline is still ahead, and the auto-fill is stamped
`auto_picks_applied_at` for both.

## How to verify after deploy

1. The next tick's JSON (function logs): `synced` lists Week 1, Week 2
   and Week 3; `syncFailures` is empty; `staleGames` is empty;
   `picksGraded` is non-zero; `resultsEmailsSent` is 0 and
   `resultsExpired` lists Bada Bing Week 1 and Week 2.
2. Standings on nfl.mnsfantasy.com for Bada Bing: Seanmun, thekid and
   joeybagadonuts on 5.5; wolfmanjoe on 5; Bada Birds on 3.
3. Read-only check on the database:

```sql
select count(*) from nfl.picks pk
join nfl.games g on g.id = pk.game_id
where pk.result = 'pending' and g.kickoff_at < now();
-- expected: 0
```

## Idea gate

- **Worst moment:** the member whose Monday night pick was right and
  whose total is short. The fix restores the point without them doing
  anything, and the alarm means the next such gap is hours, not days.
- **Main path:** fixes the sync path itself. No "regrade mode", no
  admin button, no special case.
- **Out of order:** every piece is idempotent. A tick can run late,
  twice, or after a manual fetch; the set is recomputed each time and
  the grader converges on the same numbers.
- **Subtraction:** one pure function and one loop replace one line. The
  extra pieces are the test and the alarm, which are the parts that
  make "never again" a claim rather than a hope.
