// Typed shapes for what the picks endpoint returns. Kept beside the
// client rather than imported from api/ so the browser bundle never
// pulls in server code.

export interface ApiTeam {
  id: string
  nickname: string
  name: string
  primaryColor: string | null
}

export interface ApiSlateGame {
  gameId: string
  kickoffAt: string
  // The NFL has not scheduled this one yet — see isTbdKickoff. Shown as
  // "Time TBD" rather than as a midnight kickoff.
  kickoffTbd: boolean
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled'
  homeScore: number | null
  awayScore: number | null
  spread: number | null
  home: ApiTeam | null
  away: ApiTeam | null
  // Published ATS game with no number: visible, never pickable, may
  // come back on the board if the admin fills the line in later.
  offBoard: boolean
  // Computed server-side through isPickable, so the client never has to
  // reimplement the two-cutoff rule and get it subtly different.
  open: boolean
}

export interface ApiPick {
  id: string
  entryId: string
  gameId: string
  selectedTeamId: string
  confidencePoints: number | null
  isKeyPick: boolean
  isKeyAuto: boolean
  isAuto: boolean
  result: 'pending' | 'win' | 'loss' | 'push' | 'missed'
  pointsEarned: number
}

// One row of the post-deadline reveal: every entry's picks, the caller's
// included. Absent (empty array) until the week's deadline passes.
export interface ApiOtherPick {
  entryId: string
  entryName: string
  // The owner's username — public, so shared ownership of several
  // entries is visible to the whole pool.
  ownerName: string | null
  // Present only when the caller manages the pool; members get null.
  ownerEmail: string | null
  gameId: string
  selectedTeamId: string
  confidencePoints: number | null
  isKeyPick: boolean
  isAuto: boolean
  result: 'pending' | 'win' | 'loss' | 'push' | 'missed'
  pointsEarned: number
}

export interface WeekRecap {
  entryId: string
  weekLabel: string
  points: number
  correct: number
  incorrect: number
  push: number
  weeklyRank: number | null
  rank: number | null
  // Positive = climbed since the week before; null when unknowable.
  rankChange: number | null
}

export interface PicksResponse {
  // Counts only — safe before the reveal.
  pulse: { entriesTotal: number; entriesComplete: number }
  // Last graded week per caller entry; empty until something grades.
  recaps: WeekRecap[]
  pool: {
    id: string
    name: string
    poolType: 'classic' | 'pick_n' | 'confidence' | 'survivor'
    spreadMode: 'straight_up' | 'ats'
    picksRequired: number | null
    keyPick: boolean
    managerNote: string | null
    startWeek: number
    endWeek: number
    maxEntriesPerUser: number | null
  }
  manager: boolean
  week: { id: string; week: number; label: string }
  published: string | null
  deadline: string | null
  revealed: boolean
  slate: ApiSlateGame[]
  entries: Array<{
    id: string
    entryName: string
    status: 'active' | 'benched' | 'banned'
    submittedAt: string | null
  }>
  myPicks: ApiPick[]
  others: ApiOtherPick[]
}

export interface SavePick {
  gameId: string
  selectedTeamId: string
  confidencePoints?: number | null
  isKeyPick?: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: string[]
  ) {
    super(message)
  }
}

type GetToken = () => Promise<string | null>

async function request<T>(getToken: GetToken, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const b = body as { error?: string; errors?: string[] }
    // The endpoint returns `errors` (plural) for validation failures,
    // which are written for members to read. Prefer them over a generic
    // status message.
    throw new ApiError(b.errors?.[0] ?? b.error ?? `Request failed (${res.status})`, res.status, b.errors)
  }
  return body as T
}

export interface CreatePoolInput {
  name: string
  poolType: 'classic' | 'pick_n' | 'confidence' | 'survivor'
  spreadMode: 'straight_up' | 'ats'
  picksRequired: number | null
  startWeek: number
  endWeek: number
  isPublic: boolean
  maxEntriesPerUser: number | null
  allowLateJoin: boolean
  lineSource: 'api' | 'manual'
  deadlineAnchor: 'sunday_1pm_et' | 'first_included_kickoff' | 'manual'
  deadlineOffsetMinutes: number
  reminderHoursBefore: number | null
  scoring: Record<string, unknown>
  prizes?: {
    seasonPlaces: number
    keyPlaces: number
    lastPlace: boolean
    segments: Array<{ name: string; startWeek: number; endWeek: number; places: number }>
  } | null
  entryName: string
}

export interface PoolSummary {
  id: string
  name: string
  poolType: string
  spreadMode: string
  season: number
  status: string
  joinCode: string | null
  createdBy: string
}

export interface StandingsWeekCell {
  week: number
  points: number | null
  correct: number
  incorrect: number
  push: number
}

export interface StandingsRow {
  rank: number
  entryId: string
  entryName: string
  // The owner's username — public.
  ownerName: string | null
  // Present only when the caller manages the pool; members get null.
  ownerEmail: string | null
  isMine: boolean
  totalPoints: number
  keyPickScore: number
  strikes: number
  isEliminated: boolean
  ownerIsCreator: boolean
  ownerIsAdmin: boolean
  // True when the CALLER may grant/revoke admin on this row.
  canToggleAdmin: boolean
  // True when the CALLER may bench/ban this row.
  canModerate: boolean
  weekly: StandingsWeekCell[]
}

export interface WinnerRef {
  entryId: string
  entryName: string
  ownerName: string | null
  points: number
  rank: number
}

export interface WinnersCircle {
  season: WinnerRef[]
  seasonPlaces: number
  key: WinnerRef[]
  keyPlaces: number
  lastPlace: WinnerRef[]
  lastPlaceEnabled: boolean
  segments: Array<{
    name: string
    startWeek: number
    endWeek: number
    places: number
    complete: boolean
    winners: WinnerRef[]
  }>
}

export interface StandingsResponse {
  // True only when the pool's last week is fully decided — the signal
  // for the season-end presentation.
  final: boolean
  // Null when the pool has no prize config.
  winners: WinnersCircle | null
  // Benched and banned entries — admins only, empty for members.
  inactive: Array<{
    entryId: string
    entryName: string
    status: 'benched' | 'banned'
    ownerName: string | null
    ownerEmail: string | null
  }>
  weeks: Array<{ week: number; label: string }>
  rows: StandingsRow[]
}

export interface AdminPulse {
  week: { label: string }
  published: string | null
  deadline: string | null
  readiness: { gamesIncluded: number; spreadsMissing: number }
  memberCount: number
  entriesTotal: number
  short: Array<{
    entryName: string
    picksIn: number
    ownerName: string | null
    ownerEmail: string | null
  }>
  gradingPending: number
  joinCode: string | null
  recentAnnouncements: Array<{
    subject: string
    sentAt: string
    recipientCount: number
    failedCount: number
  }>
}

export function createApi(getToken: GetToken) {
  return {
    myPools: () =>
      request<{ pools: Array<{ pool: PoolSummary; entry: { id: string; entryName: string } }> }>(
        getToken,
        '/api/pools'
      ),

    createPool: (input: CreatePoolInput) =>
      request<{ pool: PoolSummary; entry: { id: string } }>(getToken, '/api/pools', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    searchPools: (q: string) =>
      request<{ pools: PoolSummary[] }>(getToken, `/api/pools/join?q=${encodeURIComponent(q)}`),

    joinPool: (body: {
      joinCode?: string
      poolId?: string
      inviteToken?: string
      entryName?: string
      addEntry?: boolean
    }) =>
      request<{ pool: PoolSummary; entry: { id: string }; alreadyMember?: boolean }>(
        getToken,
        '/api/pools/join',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      ),

    getPicks: (poolId: string, week?: number) =>
      request<PicksResponse>(
        getToken,
        `/api/pools/${poolId}/picks${week ? `?week=${week}` : ''}`
      ),

    savePicks: (poolId: string, entryId: string, week: number, picks: SavePick[]) =>
      request<{ ok: true; saved: number }>(getToken, `/api/pools/${poolId}/picks`, {
        method: 'PUT',
        body: JSON.stringify({ entryId, week, picks }),
      }),

    renameEntry: (poolId: string, entryId: string, entryName: string) =>
      request<{ ok: true; entryName: string }>(getToken, `/api/pools/${poolId}/picks`, {
        method: 'PATCH',
        body: JSON.stringify({ entryId, entryName }),
      }),

    getStandings: (poolId: string) =>
      request<StandingsResponse>(getToken, `/api/pools/${poolId}/standings`),

    getAdminPulse: (poolId: string) =>
      request<AdminPulse>(getToken, `/api/pools/${poolId}/admin`),

    remindNow: (poolId: string) =>
      request<{ ok: true; sent: number }>(getToken, `/api/pools/${poolId}/admin`, {
        method: 'POST',
        body: JSON.stringify({ action: 'remind' }),
      }),

    announce: (poolId: string, subject: string, body: string) =>
      request<{ ok: true; sent: number; failed: number }>(
        getToken,
        `/api/pools/${poolId}/admin`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'announce', subject, body }),
        }
      ),

    updatePoolSettings: (
      poolId: string,
      settings: {
        name?: string
        managerNote?: string | null
        rulesMarkdown?: string | null
        reminderHoursBefore?: number | null
      }
    ) =>
      request<{ ok: true }>(getToken, `/api/pools/${poolId}/standings`, {
        method: 'POST',
        body: JSON.stringify({ settings }),
      }),

    archivePool: (poolId: string, archive: boolean) =>
      request<{ ok: true }>(getToken, `/api/pools/${poolId}/standings`, {
        method: 'POST',
        body: JSON.stringify({ archive }),
      }),

    setEntryStatus: (poolId: string, entryId: string, status: 'active' | 'benched' | 'banned') =>
      request<{ ok: true }>(getToken, `/api/pools/${poolId}/standings`, {
        method: 'POST',
        body: JSON.stringify({ entryId, status }),
      }),

    setPoolAdmin: (poolId: string, entryId: string, isAdmin: boolean) =>
      request<{ ok: true }>(getToken, `/api/pools/${poolId}/standings`, {
        method: 'POST',
        body: JSON.stringify({ entryId, isAdmin }),
      }),

    submitPicks: (poolId: string, entryId: string, week: number) =>
      request<{ ok: true; submittedAt: string }>(getToken, `/api/pools/${poolId}/picks`, {
        method: 'POST',
        body: JSON.stringify({ entryId, week }),
      }),
  }
}
