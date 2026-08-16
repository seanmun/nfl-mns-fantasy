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

export interface PicksResponse {
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
  entries: Array<{ id: string; entryName: string; submittedAt: string | null }>
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
  weekly: StandingsWeekCell[]
}

export interface StandingsResponse {
  weeks: Array<{ week: number; label: string }>
  rows: StandingsRow[]
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

    submitPicks: (poolId: string, entryId: string, week: number) =>
      request<{ ok: true; submittedAt: string }>(getToken, `/api/pools/${poolId}/picks`, {
        method: 'POST',
        body: JSON.stringify({ entryId, week }),
      }),
  }
}
