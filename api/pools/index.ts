import type { VercelRequest, VercelResponse } from '@vercel/node'
import { desc, eq } from 'drizzle-orm'
import { db } from '../_db.js'
import { verifyAuth } from '../_middleware.js'
import { ensureUser } from '../_ensureUser.js'
import { applyCors, generateJoinCode } from '../_pool.js'
import { nflPoolEntries, nflPools } from '../../src/lib/db/schema.js'
import type { DeadlineAnchor, PoolType, SpreadMode } from '../../src/lib/db/schema.js'
import { DEFAULT_SCORING } from '../../src/lib/scoring/config.js'

// The create-pool request body. Every field optional because the client
// sends only what the admin changed; the defaults below are the rest.
interface CreatePoolBody {
  name: string
  poolType: PoolType
  spreadMode: SpreadMode
  season: number
  picksRequired: number | null
  startWeek: number
  endWeek: number
  isPublic: boolean
  maxEntries: number | null
  maxEntriesPerUser: number | null
  allowLateJoin: boolean
  lineSource: 'api' | 'manual'
  deadlineAnchor: DeadlineAnchor
  deadlineOffsetMinutes: number
  reminderHoursBefore: number | null
  // Admin overrides on top of DEFAULT_SCORING for the chosen type.
  scoring: Record<string, unknown>
  entryName: string
}

// GET  /api/pools        — pools this user has an entry in
// POST /api/pools        — create one
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const userId = await verifyAuth(req)
  if (!userId) return res.status(401).json({ error: 'Sign in to continue.' })

  if (req.method === 'GET') {
    const rows = await db
      .select({
        pool: nflPools,
        entry: nflPoolEntries,
      })
      .from(nflPoolEntries)
      .innerJoin(nflPools, eq(nflPools.id, nflPoolEntries.poolId))
      .where(eq(nflPoolEntries.userId, userId))
      .orderBy(desc(nflPoolEntries.joinedAt))

    // A user may hold several entries in one pool, so the same pool can
    // appear more than once here. That is correct — each entry is an
    // independent contestant with its own standing.
    return res.status(200).json({ pools: rows })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = (req.body ?? {}) as Partial<CreatePoolBody>

  const {
    name,
    poolType = 'pick_n',
    spreadMode = 'straight_up',
    season = Number(process.env.NFL_SEASON) || new Date().getUTCFullYear(),
    picksRequired = null,
    startWeek = 1,
    endWeek = 18,
    isPublic = false,
    maxEntries = null,
    maxEntriesPerUser = 1,
    allowLateJoin = false,
    lineSource = 'api',
    deadlineAnchor = 'first_included_kickoff',
    deadlineOffsetMinutes = 0,
    reminderHoursBefore = 24,
    scoring = {},
    entryName,
  } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Give the pool a name.' })
  }

  const types: PoolType[] = ['classic', 'pick_n', 'confidence', 'survivor']
  if (!types.includes(poolType)) {
    return res.status(400).json({ error: 'Unknown pool type.' })
  }

  // Survivor is straight-up by definition — there is no spread to beat
  // when the whole game is "did they win". Forced rather than validated
  // so a client cannot create an unplayable pool.
  const effectiveSpread: SpreadMode = poolType === 'survivor' ? 'straight_up' : spreadMode

  if (poolType === 'pick_n' && (!picksRequired || picksRequired < 1)) {
    return res.status(400).json({ error: 'Say how many picks a week this pool takes.' })
  }
  if (startWeek < 1 || endWeek > 18 || startWeek > endWeek) {
    return res.status(400).json({ error: 'Those weeks do not make sense.' })
  }

  // Scoring is frozen at creation from the single source in
  // src/lib/scoring/config.ts, with the admin's overrides on top. There
  // is deliberately no column default — see CLAUDE.md.
  const scoringConfig = {
    ...DEFAULT_SCORING[poolType as PoolType],
    ...(scoring as object),
    ...(poolType === 'pick_n' ? { picksRequired } : {}),
  }

  try {
    const handle = await ensureUser(userId)

    const [pool] = await db
      .insert(nflPools)
      .values({
        name: name.trim(),
        createdBy: userId,
        season,
        poolType,
        spreadMode: effectiveSpread,
        picksRequired: poolType === 'pick_n' ? picksRequired : null,
        startWeek,
        endWeek,
        isPublic,
        maxEntries,
        maxEntriesPerUser,
        allowLateJoin,
        lineSource,
        deadlineAnchor,
        deadlineOffsetMinutes,
        reminderHoursBefore,
        joinCode: generateJoinCode(),
        scoringConfig,
      })
      .returning()

    // Platform rule: whoever creates a thing is in it. Never make a
    // creator join their own pool.
    const [entry] = await db
      .insert(nflPoolEntries)
      .values({
        poolId: pool.id,
        userId,
        entryName: (entryName as string)?.trim() || handle,
      })
      .returning()

    return res.status(201).json({ pool, entry })
  } catch (error) {
    console.error('POST /api/pools failed:', error)
    return res.status(500).json({ error: 'Could not create the pool.' })
  }
}
