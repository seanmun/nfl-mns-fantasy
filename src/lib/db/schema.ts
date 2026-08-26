import {
  pgTable, pgSchema, text, integer, boolean, timestamp,
  uuid, real, jsonb, index, unique,
} from 'drizzle-orm/pg-core'

// All NFL tables live in the `nfl` Postgres schema; shared cross-game
// tables stay in `public`. drizzle.config.ts sets schemaFilter: ['nfl']
// so db:push can never touch public.
export const nflSchema = pgSchema('nfl')

// EVERY timestamp here is `timestamptz`, never bare `timestamp`.
//
// A bare `timestamp without time zone` stores the wall clock and drops
// the offset, so the driver writes a UTC wall clock and reads it back as
// LOCAL time. The size of the error is then the reader's UTC offset:
// verified 2026-08-14, a kickoff ESPN gave as 2026-09-10T00:20Z came
// back as 04:20Z on a machine in America/New_York, while a Vercel
// function running in UTC would have read the same row correctly. The
// same row meaning different things in different places is how deadlines,
// locks and grading end up disagreeing between a laptop and production.
//
// If you add a timestamp column, add withTimezone: true.


// ─── USERS ────────────────────────────────────────────────────────────────────

// Shared cross-game identity table in `public` (same definition as the
// golf and wnba apps). email is NOT unique in the live table. Not
// managed by this app's db:push.
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ─── TEAMS ────────────────────────────────────────────────────────────────────

// Seeded once, never synced. The id is the stable NFL abbreviation ('KC',
// 'PHI') because it reads well in URLs and survivor's used-teams checks.
//
// Two feeds have to agree on which row is which, and neither uses our id:
// the schedule/score feed keys on its own numeric event ids and team
// abbreviations, while The Odds API identifies teams ONLY by full display
// name ("Kansas City Chiefs") inside each event. oddsApiName makes that
// match a lookup instead of fuzzy string work — which matters because a
// missed match silently produces a game with no line, and an ATS pool
// with no line cannot grade.
export const nflTeams = nflSchema.table('teams', {
  id: text('id').primaryKey(),              // 'KC'
  name: text('name').notNull(),             // 'Kansas City Chiefs'
  location: text('location').notNull(),     // 'Kansas City'
  nickname: text('nickname').notNull(),     // 'Chiefs'
  conference: text('conference').notNull(), // 'AFC' | 'NFC'
  division: text('division').notNull(),     // 'West'
  // Exact string The Odds API uses for this team. Verify against a live
  // response before trusting it; relocations and rebrands change it.
  oddsApiName: text('odds_api_name').notNull().unique(),
  // Abbreviation used by the schedule/score feed, when it differs from
  // our id (e.g. ESPN uses 'WSH' where we use 'WAS').
  scheduleFeedAbbr: text('schedule_feed_abbr'),
  primaryColor: text('primary_color'),
  logoUrl: text('logo_url'),
})

// ─── WEEKS ────────────────────────────────────────────────────────────────────

// The NFL calendar, shared by every pool. Purely factual: what weeks
// exist and when they run.
//
// Publishing does NOT live here. Each pool picks its own slate and hangs
// its own numbers, so publish state, the pick deadline and the official
// spreads are all per pool per week — see pool_weeks and pool_games.
export const nflWeeks = nflSchema.table('weeks', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  // 'pre' | 'regular' | 'post'. Post-season week 1 is Wild Card, so week
  // numbers only mean anything alongside seasonType.
  seasonType: text('season_type').$type<SeasonType>().notNull().default('regular'),
  week: integer('week').notNull(),
  label: text('label').notNull(), // 'Week 1', 'Wild Card', ...
  // Denormalized from games so "which week are we in" is one read.
  // Recomputed whenever the schedule syncs.
  firstKickoffAt: timestamp('first_kickoff_at', { withTimezone: true }),
  lastKickoffAt: timestamp('last_kickoff_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('nfl_weeks_season_type_week_key').on(t.season, t.seasonType, t.week),
])

// ─── GAMES ────────────────────────────────────────────────────────────────────

// The schedule. kickoffAt is one of TWO cutoffs a pick has to clear — it
// closes an individual game, while pool_weeks.pickDeadlineAt closes the
// whole week. See the rule block on the picks table; neither alone is
// sufficient.
export const nflGames = nflSchema.table('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekId: uuid('week_id').notNull().references(() => nflWeeks.id),
  homeTeamId: text('home_team_id').notNull().references(() => nflTeams.id),
  awayTeamId: text('away_team_id').notNull().references(() => nflTeams.id),
  kickoffAt: timestamp('kickoff_at', { withTimezone: true }).notNull(),
  status: text('status').$type<GameStatus>().notNull().default('scheduled'),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  // Set only when status is 'final'. Null on a final game means a TIE,
  // which the NFL does have — do not treat null-winner as "not yet
  // played" anywhere. isFinal + null winner is the tie signal.
  winnerTeamId: text('winner_team_id').references(() => nflTeams.id),
  // Feed keys. oddsApiEventId is matched by team names + commence_time on
  // the first pull, then reused, because The Odds API rotates nothing but
  // is not guaranteed to expose the same event twice.
  scheduleFeedId: text('schedule_feed_id'),
  oddsApiEventId: text('odds_api_event_id'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('nfl_games_week_idx').on(t.weekId),
  index('nfl_games_kickoff_idx').on(t.kickoffAt),
  index('nfl_games_status_idx').on(t.status),
  unique('nfl_games_schedule_feed_key').on(t.scheduleFeedId),
])

// ─── LINES ────────────────────────────────────────────────────────────────────

// REFERENCE lines — the market number pulled from The Odds API, one row
// per game. Nothing is graded against this.
//
// It exists to prefill pool_games.spread when a pool's slate is built,
// and to give the admin something to compare his own numbers to. A pool
// running lineSource 'manual' may end up with a spread here that nothing
// ever uses, and that is fine. Grading reads pool_games, always.
//
// spread is always from the HOME team's perspective: -3.5 means the home
// team is favoured by 3.5. Storing it one-sided is what keeps grading a
// single comparison instead of a per-pick sign flip.
//
// real, not decimal: spreads and totals are always whole or half points,
// which are exact in binary floating point, and real avoids decimal's
// string round-trip through drizzle (golf's totalPoints comes back as a
// string and every caller has to parseFloat it).
export const nflGameLines = nflSchema.table('game_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => nflGames.id, { onDelete: 'cascade' }),
  spread: real('spread'),          // home perspective, -3.5 = home favoured
  total: real('total'),            // over/under
  homeMoneyline: integer('home_moneyline'),
  awayMoneyline: integer('away_moneyline'),
  // Anchor book. DraftKings by default; recorded because a line only
  // means something next to the book that hung it.
  book: text('book').notNull().default('draftkings'),
  // No override columns here on purpose. Admin edits belong to a pool,
  // not to the market — they live on pool_games.spread. This table is
  // only ever rewritten by the weekly pull.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('nfl_game_lines_game_key').on(t.gameId),
])

// Raw pulls, kept for audit and for the admin page's "what do the other
// books say" column. Never read by grading. Trimmed on a schedule; this
// grows by (games × books × markets) every week.
export const nflOddsSnapshots = nflSchema.table('odds_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => nflGames.id, { onDelete: 'cascade' }),
  book: text('book').notNull(),
  // Whole bookmaker object from The Odds API for this event, so a
  // response-shape change never loses data we did not parse.
  payload: jsonb('payload').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('nfl_odds_snapshots_game_idx').on(t.gameId),
  index('nfl_odds_snapshots_fetched_idx').on(t.fetchedAt),
])

// ─── POOLS ────────────────────────────────────────────────────────────────────

// poolType and spreadMode are columns because they gate validation on
// every pick write. Everything else about how a pool scores lives in
// scoringConfig.
//
// scoringConfig is FROZEN at creation (golf's pools.scoring_config
// precedent): changing the app's defaults never rescores a pool that
// already exists. Deliberately NO column default here — golf has one
// default in the schema and another in the scoring engine and they have
// to be kept in step by hand. The single source is DEFAULT_SCORING in
// src/lib/scoring/config.ts, and inserts must supply it.
//
// Shape by type:
//   classic    { winPoints, pushPoints, tiebreaker }
//   pick_n     { winPoints, pushPoints, picksRequired, keyPick, tiebreaker }
//   confidence { pushBehavior, tiebreaker }   // points = the rank itself
//   survivor   { maxStrikes, tiePolicy, missedPickPolicy }
export const nflPools = nflSchema.table('pools', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: text('created_by').notNull().references(() => users.id),
  season: integer('season').notNull(),
  // Which weeks this pool plays. Without it, standings sweep every week
  // in the season and a QA pool would count real Week 1 alongside its own
  // test days — the two would silently add together.
  seasonType: text('season_type').$type<SeasonType>().notNull().default('regular'),
  poolType: text('pool_type').$type<PoolType>().notNull(),
  // Survivor is straight-up by definition; the create endpoint forces it.
  spreadMode: text('spread_mode').$type<SpreadMode>().notNull().default('straight_up'),
  // pick_n only — how many of the week's games an entry must pick. Null
  // for every other type, which means "the whole slate".
  picksRequired: integer('picks_required'),
  // A pool need not run the whole season; both inclusive.
  startWeek: integer('start_week').notNull().default(1),
  endWeek: integer('end_week').notNull().default(18),
  // May someone join after startWeek's first kickoff? Off by default, so
  // everyone runs the same weeks and the leaderboard is comparable. When
  // on, a latecomer carries zeroes for the weeks they missed — the join
  // flow has to say so plainly rather than let them discover it on the
  // standings page.
  allowLateJoin: boolean('allow_late_join').notNull().default(false),
  isPublic: boolean('is_public').notNull().default(true),
  joinCode: text('join_code').unique(),
  // Total entries across the whole pool. Null = uncapped.
  maxEntries: integer('max_entries'),
  // How many entries one person may hold here. Null = uncapped, 1 = the
  // conventional one-per-person pool. Checked on every join.
  maxEntriesPerUser: integer('max_entries_per_user').default(1),
  status: text('status').$type<PoolStatus>().notNull().default('open'),
  scoringConfig: jsonb('scoring_config').$type<Record<string, unknown>>().notNull(),

  // Payout structure — who lands in the winners circle. Prize rules,
  // not scoring rules: they never change a point total, only which rows
  // get celebrated, so they sit beside scoringConfig rather than inside
  // it. Null means the pool predates prizes (winner-take-first shown).
  //
  //   seasonPlaces  top N season-points places (ties included by rank)
  //   keyPlaces     top N key-pick places, 0 = none
  //   lastPlace     celebrate the season's last place
  //   segments      [{ name, startWeek, endWeek, places }] — any
  //                 grouping of weeks; each pays its own top-N on the
  //                 points earned inside that span.
  prizesConfig: jsonb('prizes_config').$type<PrizesConfig>(),

  // How pool_weeks.pickDeadlineAt is computed when a week is published.
  // Operational settings, deliberately columns rather than scoringConfig
  // keys: the admin may change these mid-season, whereas scoringConfig is
  // frozen at creation. Anchors are evaluated in America/New_York, never
  // UTC — "Sunday 1pm ET" moves against UTC twice a season.
  deadlineAnchor: text('deadline_anchor')
    .$type<DeadlineAnchor>()
    .notNull()
    .default('first_included_kickoff'),
  // Minutes BEFORE the anchor. 0 means exactly at it.
  deadlineOffsetMinutes: integer('deadline_offset_minutes').notNull().default(0),

  // How many hours before the deadline to email members who are still
  // short of their picks. Null disables reminders for this pool. 24 puts
  // a Sunday-1pm deadline's nudge on Saturday afternoon.
  reminderHoursBefore: integer('reminder_hours_before').default(24),

  // Where this pool's official spreads come from. 'api' prefills from
  // game_lines and publishes automatically; 'manual' prefills the same
  // way but waits for the admin's numbers and his explicit publish.
  // Either way the pool grades against pool_games.spread.
  lineSource: text('line_source').$type<LineSource>().notNull().default('api'),

  // Pinned note on the pool home page. Plain markdown, rendered — not
  // HTML, so there is nothing to sanitise and no XSS surface.
  managerNote: text('manager_note'),
  managerNoteUpdatedAt: timestamp('manager_note_updated_at', { withTimezone: true }),
  // The pool's rules page. Markdown for the same reason.
  rulesMarkdown: text('rules_markdown'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('nfl_pools_season_idx').on(t.season),
  index('nfl_pools_status_idx').on(t.status),
])

// ─── POOL WEEKS ───────────────────────────────────────────────────────────────

// One row per pool per week: the pool's own publish state and deadline.
//
// Publishing is a POOL-week act. The admin picks which games are in
// (pool_games.isIncluded), sets his spreads, and publishes the week as a
// unit — a half-published week is not a state members should ever see.
// Until linesPublishedAt is set, the week takes no picks at all.
//
// pickDeadlineAt is FROZEN here at publish rather than derived on read.
// Deriving it would mean recomputing "the Sunday 1pm ET kickoff" against
// a schedule that still moves (flexed games, postponements), so a
// deadline could shift under members who had already planned around it.
// It is computed from the slate at publish, shown to the admin, and
// editable by him before he commits.
export const nflPoolWeeks = nflSchema.table('pool_weeks', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolId: uuid('pool_id').notNull().references(() => nflPools.id, { onDelete: 'cascade' }),
  weekId: uuid('week_id').notNull().references(() => nflWeeks.id),
  linesPublishedAt: timestamp('lines_published_at', { withTimezone: true }),
  linesPublishedBy: text('lines_published_by'),
  // The single cutoff for the week. After this nothing can be picked and
  // short entries are filled in. Individual games still close at their
  // own kickoff if that comes first — see the pickability rule in picks.
  pickDeadlineAt: timestamp('pick_deadline_at', { withTimezone: true }),
  // Idempotency stamp for the auto-pick run. The deadline cron must be
  // safe to fire twice; without this a retry would assign a second set
  // of random picks on top of the first.
  autoPicksAppliedAt: timestamp('auto_picks_applied_at', { withTimezone: true }),
  // Same idea for the week-results email, sent the morning after the
  // week's last game goes final.
  resultsEmailSentAt: timestamp('results_email_sent_at', { withTimezone: true }),
  // Same idea for the pre-deadline nudge. The tick runs hourly, so
  // without a stamp every member short of picks would be emailed once an
  // hour from the reminder window until the deadline.
  remindersSentAt: timestamp('reminders_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('nfl_pool_weeks_pool_week_key').on(t.poolId, t.weekId),
  index('nfl_pool_weeks_deadline_idx').on(t.pickDeadlineAt),
])

// ─── POOL GAMES ───────────────────────────────────────────────────────────────

// The pool's slate for a week, and its official numbers.
//
// isIncluded is the admin's per-week checklist. The Kongers Kitchen rule
// — Friday through Monday only, except Thanksgiving and Christmas — is
// deliberately NOT encoded anywhere. It is one admin unticking Thursday
// games, which means the rule can change mid-season, differ per pool, and
// handle the holiday exceptions without a special case that a calendar
// quirk would eventually break.
//
// spread is this pool's OFFICIAL number, prefilled from game_lines and
// then overridable. Grading reads this column and nothing else. Null on
// an included game in an ATS pool blocks publishing — an ATS game with no
// number cannot be graded, and finding that out at grading time is far
// too late.
export const nflPoolGames = nflSchema.table('pool_games', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolId: uuid('pool_id').notNull().references(() => nflPools.id, { onDelete: 'cascade' }),
  weekId: uuid('week_id').notNull().references(() => nflWeeks.id),
  gameId: uuid('game_id').notNull().references(() => nflGames.id),
  isIncluded: boolean('is_included').notNull().default(true),
  spread: real('spread'),
  // 'api' while it still matches the prefill, 'manual' once the admin has
  // typed his own. Drives the "overridden" marker on the review page.
  spreadSource: text('spread_source').$type<LineSource>().notNull().default('api'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('nfl_pool_games_pool_game_key').on(t.poolId, t.gameId),
  index('nfl_pool_games_pool_week_idx').on(t.poolId, t.weekId),
])

// Every post-publish line change, one row per edit, visible to the whole
// pool — an admin can fix a published number (rare, but a fat-fingered
// -3.5 typed as +3.5 happens), and the price of the power is that the
// change is public. Picks are unharmed either way: each pick grades on
// the line it was made against (picks.lineSpreadAtPick).
export const nflPoolGameLineEvents = nflSchema.table('pool_game_line_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolGameId: uuid('pool_game_id').notNull().references(() => nflPoolGames.id, { onDelete: 'cascade' }),
  prevSpread: real('prev_spread'),
  spread: real('spread'),
  changedBy: text('changed_by').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('nfl_line_events_pool_game_idx').on(t.poolGameId),
])

// ─── ENTRIES ──────────────────────────────────────────────────────────────────

// One row per ENTRY, and a user may hold several in the same pool. The
// pool creator gets one automatically at creation — platform rule,
// creators are always members of their own thing.
//
// There is deliberately no unique on (poolId, userId). Everything
// downstream keys on entryId rather than userId — picks, weekly rollups,
// survivor's used-team rule, elimination — so two entries owned by one
// person are genuinely independent contestants. Anything that groups by
// userId instead is a bug: it would merge someone's two entries into one
// leaderboard row and silently double their points.
//
// entryName is what disambiguates them on the leaderboard, which is why
// it is notNull rather than a nicety.
export const nflPoolEntries = nflSchema.table('pool_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolId: uuid('pool_id').notNull().references(() => nflPools.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  entryName: text('entry_name').notNull(),
  // Co-admin grant. Admin-ness is per USER: a user is a pool admin when
  // ANY of their entries carries this flag (grant/revoke writes all of
  // them, keeping the rows consistent). The creator needs no flag and
  // can never be demoted.
  isAdmin: boolean('is_admin').notNull().default(false),
  // Per-entry opt-out for the pre-deadline nudge. Deliberately local to
  // this app rather than routed through the hub's marketing preferences:
  // a "you have 0 of 5 picks in" message is transactional — an obligation
  // in a contest the member joined — not marketing, and conflating the
  // two would let a marketing opt-out silently cost someone their week.
  emailReminders: boolean('email_reminders').notNull().default(true),
  // 'active' | 'benched' | 'banned'. Benched sit the season out but stay
  // in the system for next year; banned are out and cannot rejoin. Both
  // vanish from standings, picks, pulse counts and every email.
  status: text('status').$type<EntryStatus>().notNull().default('active'),
  // DORMANT — Simple Mode was built and killed same-day 2026-08-25:
  // the MAIN picks page must be that simple itself; a separate fork
  // admits defeat. Columns stay so db:push never proposes a
  // destructive drop; nothing reads or writes them.
  simpleMode: boolean('simple_mode').notNull().default(false),
  simpleToken: text('simple_token').unique(),
  // Survivor. strikes counts losses; isEliminated is a cached read of
  // strikes >= scoringConfig.maxStrikes, written by the grader — never
  // trust it as the source of truth when regrading, recompute from picks.
  strikes: integer('strikes').notNull().default(0),
  isEliminated: boolean('is_eliminated').notNull().default(false),
  eliminatedWeek: integer('eliminated_week'),
  // Season totals, recomputed by the grader after every week.
  totalPoints: real('total_points').notNull().default(0),
  // Season key-pick total. Pays no extra points — it is purely the
  // tiebreaker for equal totalPoints, and the second leaderboard column.
  // A key win is 1; a key push contributes scoringConfig.keyPushCredit,
  // which the admin sets and which may be fractional. Hence `real`, and
  // hence "score" rather than "wins".
  keyPickScore: real('key_pick_score').notNull().default(0),
  rank: integer('rank'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('nfl_pool_entries_pool_idx').on(t.poolId),
  index('nfl_pool_entries_user_idx').on(t.userId),
  // Counting a user's entries in a pool is the check on every join.
  index('nfl_pool_entries_pool_user_idx').on(t.poolId, t.userId),
])

// ─── PICKS ────────────────────────────────────────────────────────────────────

// One row per game an entry has picked. Every pool type writes here:
// classic and pick_n pick a team, confidence picks a team and ranks it,
// survivor picks one team for the whole week.
//
// weekId is denormalized off the game so weekly grouping, pick_n's count
// check and survivor's one-per-week rule never need a three-table join.
//
// WHEN A PICK CAN BE WRITTEN — one rule, and it is not just kickoff:
//
//   pool_weeks.linesPublishedAt is set
//   AND now < pool_weeks.pickDeadlineAt      (the whole week's cutoff)
//   AND now < games.kickoffAt                (this game's own cutoff)
//
// The week closes at the deadline even for games that have not kicked
// off yet — that is what makes the auto-pick fill deterministic. Games
// that kick off BEFORE the deadline (Friday, Saturday, Thanksgiving)
// still close at their own kickoff, so an early game cannot be picked
// once it is under way. Dropping either half of that reintroduces a bug:
// without the deadline, Monday stays open after the fill has run;
// without the kickoff check, someone picks a Friday game on Sunday
// already knowing the result.
//
// Invariants Postgres cannot express here, because they only apply to
// some pool types and the type lives a table away. All are enforced in
// the write path and re-checked by the grader:
//   survivor   — one pick per (entryId, weekId), and a team is never
//                picked twice by the same entry all season
//   confidence — confidence values are a permutation of 1..N over the
//                week's games. Ordering trap: an early game locks days
//                before the rest, so validation has to treat already
//                locked picks' values as taken and immovable.
//   key pick   — exactly one pick per (entryId, weekId) has isKeyPick.
//                The deadline job assigns one at random if the member
//                never designated one.
export const nflPicks = nflSchema.table('picks', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id').notNull().references(() => nflPoolEntries.id, { onDelete: 'cascade' }),
  gameId: uuid('game_id').notNull().references(() => nflGames.id),
  weekId: uuid('week_id').notNull().references(() => nflWeeks.id),
  selectedTeamId: text('selected_team_id').notNull().references(() => nflTeams.id),
  // Confidence pools only: the rank assigned, and the points it pays if
  // the pick wins.
  confidencePoints: integer('confidence_points'),
  // Key-pick pools only: exactly one of the week's picks carries this.
  // It pays no extra points — see pool_entries.keyPickScore.
  isKeyPick: boolean('is_key_pick').notNull().default(false),
  // The KEY was assigned at the deadline, distinct from the pick itself
  // having been assigned. A member who chose all five deliberately but
  // forgot to flag a key gets this, not isAuto — labelling their own pick
  // as auto-generated would be a lie about what they did.
  isKeyAuto: boolean('is_key_auto').notNull().default(false),
  // Assigned by the deadline job rather than chosen. Surfaced to the
  // member, because silently inventing someone's picks and showing them
  // as if they were deliberate is how a pool loses trust.
  isAuto: boolean('is_auto').notNull().default(false),
  // The pool's line at the moment this pick was saved — the number the
  // member actually took. GRADING PREFERS THIS (falling back to
  // pool_games.spread for rows that predate the snapshot), which is what
  // makes a rare post-publish line fix fair: the edit applies only to
  // picks made after it, like any real book.
  lineSpreadAtPick: real('line_spread_at_pick'),
  result: text('result').$type<PickResult>().notNull().default('pending'),
  pointsEarned: real('points_earned').notNull().default(0),
  gradedAt: timestamp('graded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('nfl_picks_entry_game_key').on(t.entryId, t.gameId),
  index('nfl_picks_entry_week_idx').on(t.entryId, t.weekId),
  // The grader's lookup: every pick riding on a game that just went final.
  index('nfl_picks_game_idx').on(t.gameId),
])

// ─── WEEKLY STANDINGS ─────────────────────────────────────────────────────────

// Per entry per week, written by the grader. Weekly standings are the
// product the users actually look at, and cumulative rank per week needs
// a window over history — cheaper and far simpler to roll up once than to
// recompute on every page load.
//
// Rebuildable from picks at any time. If these ever disagree with picks,
// picks win.
export const nflEntryWeeks = nflSchema.table('entry_weeks', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id').notNull().references(() => nflPoolEntries.id, { onDelete: 'cascade' }),
  weekId: uuid('week_id').notNull().references(() => nflWeeks.id),
  points: real('points').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  incorrectCount: integer('incorrect_count').notNull().default(0),
  pushCount: integer('push_count').notNull().default(0),
  weeklyRank: integer('weekly_rank'),
  // This week's key-pick contribution: 1 for a win, keyPushCredit for a
  // push, 0 otherwise. Rolls up into pool_entries.keyPickScore, which
  // breaks ties on cumulativePoints.
  keyPickScore: real('key_pick_score').notNull().default(0),
  cumulativePoints: real('cumulative_points').notNull().default(0),
  cumulativeKeyPickScore: real('cumulative_key_pick_score').notNull().default(0),
  // Ranked by cumulativePoints, then cumulativeKeyPickScore. Both are
  // stored so a week's standings can be rendered exactly as they stood,
  // without recomputing history.
  cumulativeRank: integer('cumulative_rank'),
  // Survivor: 'alive' | 'eliminated' | 'missed'. Null for other types.
  survivorResult: text('survivor_result'),
  // Total-points guess for the week's last game, the conventional
  // pickem tiebreaker. Nothing reads it until a pool's scoringConfig
  // asks for it.
  tiebreakerGuess: integer('tiebreaker_guess'),
  gradedAt: timestamp('graded_at', { withTimezone: true }),
  // The member's explicit "I'm done" stamp, set by the submit endpoint
  // only when the week's set is complete. Cleared by any later pick
  // change — edited means no longer confirmed. NOT written by autofill:
  // picks the app assigned are shown as filled, never as confirmed, and
  // the grader's upsert must never touch it (its `set` row omits this
  // column, which is what preserves it).
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
}, (t) => [
  unique('nfl_entry_weeks_entry_week_key').on(t.entryId, t.weekId),
  index('nfl_entry_weeks_week_idx').on(t.weekId),
])

// ─── INVITES ──────────────────────────────────────────────────────────────────

// Link invites are just pools.joinCode. This table is the email path:
// one row per address invited, so a resend is idempotent and an
// acceptance can be attributed.
export const nflPoolInvites = nflSchema.table('pool_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolId: uuid('pool_id').notNull().references(() => nflPools.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  invitedBy: text('invited_by').notNull().references(() => users.id),
  // Single-use secret in the emailed URL. Distinct from joinCode, which
  // is shareable and never expires.
  token: text('token').notNull().unique(),
  status: text('status').$type<InviteStatus>().notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedByUserId: text('accepted_by_user_id').references(() => users.id),
}, (t) => [
  unique('nfl_pool_invites_pool_email_key').on(t.poolId, t.email),
  index('nfl_pool_invites_pool_idx').on(t.poolId),
])

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────

// Every email the admin blasts to a pool, kept after sending.
//
// This is a log, not a queue. It exists so a resend can be recognised as
// a resend, so "did everyone get told about the deadline change" has an
// answer, and so a send that half-failed is visible instead of assumed.
// weekId is set when the message carried that week's lines table.
export const nflPoolAnnouncements = nflSchema.table('pool_announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolId: uuid('pool_id').notNull().references(() => nflPools.id, { onDelete: 'cascade' }),
  weekId: uuid('week_id').references(() => nflWeeks.id),
  subject: text('subject').notNull(),
  bodyMarkdown: text('body_markdown').notNull(),
  // Whether the rendered email appended the week's official lines table.
  includedLines: boolean('included_lines').notNull().default(false),
  sentBy: text('sent_by').notNull().references(() => users.id),
  recipientCount: integer('recipient_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('nfl_pool_announcements_pool_idx').on(t.poolId),
])

// ─── ENUMS ────────────────────────────────────────────────────────────────────

// 'test' is a real season type, not a hack. Test weeks live here so the
// ESPN calendar sync — which only ever writes pre/regular/post — can
// never collide with them, and tearing the whole test down is one delete
// of every week where season_type = 'test'.
export interface PrizeSegment {
  name: string
  startWeek: number
  endWeek: number
  places: number
}

export interface PrizesConfig {
  seasonPlaces: number
  keyPlaces: number
  lastPlace: boolean
  segments: PrizeSegment[]
}

export type EntryStatus = 'active' | 'benched' | 'banned'
export type SeasonType = 'pre' | 'regular' | 'post' | 'test'
export type GameStatus = 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled'
// Where a pool's official spread came from: 'api' is the untouched
// prefill out of game_lines, 'manual' is the admin's own number.
export type LineSource = 'api' | 'manual'
// 'pick_n' is deliberately not 'pick5'. The count is pools.picksRequired,
// a per-pool setting — the first customer chose 5, another admin may
// choose 3 or 10. Naming the type after one pool's number is how a
// setting quietly becomes a hardcoded rule.
export type PoolType = 'classic' | 'pick_n' | 'confidence' | 'survivor'
export type SpreadMode = 'straight_up' | 'ats'
export type PoolStatus = 'open' | 'active' | 'completed' | 'cancelled'
export type PickResult = 'pending' | 'win' | 'loss' | 'push' | 'missed'
// 'sunday_1pm_et' — the first included game kicking off at or after 13:00
//   America/New_York on the week's Sunday.
// 'first_included_kickoff' — the earliest included kickoff of the week.
// 'manual' — no default; the admin types the deadline at publish.
export type DeadlineAnchor = 'sunday_1pm_et' | 'first_included_kickoff' | 'manual'
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type NflUser = typeof users.$inferSelect
export type NflTeam = typeof nflTeams.$inferSelect
export type NflWeek = typeof nflWeeks.$inferSelect
export type NflGame = typeof nflGames.$inferSelect
export type NflGameLine = typeof nflGameLines.$inferSelect
export type NflOddsSnapshot = typeof nflOddsSnapshots.$inferSelect
export type NflPool = typeof nflPools.$inferSelect
export type NflPoolWeek = typeof nflPoolWeeks.$inferSelect
export type NflPoolGame = typeof nflPoolGames.$inferSelect
export type NflPoolEntry = typeof nflPoolEntries.$inferSelect
export type NflPick = typeof nflPicks.$inferSelect
export type NflEntryWeek = typeof nflEntryWeeks.$inferSelect
export type NflPoolInvite = typeof nflPoolInvites.$inferSelect
export type NflPoolAnnouncement = typeof nflPoolAnnouncements.$inferSelect

export type NewNflPool = typeof nflPools.$inferInsert
export type NewNflPoolWeek = typeof nflPoolWeeks.$inferInsert
export type NewNflPoolGame = typeof nflPoolGames.$inferInsert
export type NewNflPoolEntry = typeof nflPoolEntries.$inferInsert
export type NewNflPick = typeof nflPicks.$inferInsert
