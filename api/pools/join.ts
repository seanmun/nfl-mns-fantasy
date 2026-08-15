import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, eq, ilike } from 'drizzle-orm'
import { db } from '../_db.js'
import { verifyAuth } from '../_middleware.js'
import { ensureUser } from '../_ensureUser.js'
import { applyCors } from '../_pool.js'
import {
  nflPoolEntries,
  nflPoolInvites,
  nflPools,
  nflWeeks,
} from '../../src/lib/db/schema.js'

// GET  /api/pools/join?q=      — search public pools
// POST /api/pools/join         — join by code, invite token, or pool id
//
// Share link, join code, email invite and public search are four ways in,
// and they all land on the same entry insert with the same checks. Any of
// them skipping a check is a way around it.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const userId = await verifyAuth(req)
  if (!userId) return res.status(401).json({ error: 'Sign in to continue.' })

  if (req.method === 'GET') {
    const q = String((req.query.q as string) ?? '').trim()
    if (q.length < 2) return res.status(200).json({ pools: [] })

    const pools = await db
      .select({
        id: nflPools.id,
        name: nflPools.name,
        poolType: nflPools.poolType,
        spreadMode: nflPools.spreadMode,
        season: nflPools.season,
        status: nflPools.status,
      })
      .from(nflPools)
      .where(and(eq(nflPools.isPublic, true), ilike(nflPools.name, `%${q}%`)))
      .limit(20)

    return res.status(200).json({ pools })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { joinCode, inviteToken, poolId, entryName } = (req.body ?? {}) as Record<string, string>

  try {
    let pool
    let invite

    if (inviteToken) {
      const [row] = await db
        .select()
        .from(nflPoolInvites)
        .where(eq(nflPoolInvites.token, inviteToken))
        .limit(1)
      if (!row) return res.status(404).json({ error: 'That invite link is not valid.' })
      if (row.status === 'revoked') {
        return res.status(403).json({ error: 'That invite has been withdrawn.' })
      }
      if (row.expiresAt < new Date()) {
        return res.status(403).json({ error: 'That invite has expired. Ask for a new one.' })
      }
      invite = row
      ;[pool] = await db.select().from(nflPools).where(eq(nflPools.id, row.poolId)).limit(1)
    } else if (joinCode) {
      ;[pool] = await db
        .select()
        .from(nflPools)
        .where(eq(nflPools.joinCode, joinCode.trim().toUpperCase()))
        .limit(1)
    } else if (poolId) {
      ;[pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolId)).limit(1)
      // A pool id alone only works for public pools — otherwise anyone
      // with a guessed id could walk into a private pool.
      if (pool && !pool.isPublic) {
        return res.status(403).json({ error: 'That pool is private. You need an invite.' })
      }
    } else {
      return res.status(400).json({ error: 'No pool code or invite given.' })
    }

    if (!pool) return res.status(404).json({ error: 'No pool matches that code.' })
    if (pool.status === 'cancelled') {
      return res.status(403).json({ error: 'That pool has been cancelled.' })
    }

    // ── Late join ────────────────────────────────────────────────
    if (!pool.allowLateJoin) {
      const [firstWeek] = await db
        .select({ first: nflWeeks.firstKickoffAt })
        .from(nflWeeks)
        .where(and(eq(nflWeeks.season, pool.season), eq(nflWeeks.week, pool.startWeek)))
        .limit(1)
      if (firstWeek?.first && new Date() >= firstWeek.first) {
        return res.status(403).json({ error: 'This pool has already started and is closed to new entries.' })
      }
    }

    // ── Caps ─────────────────────────────────────────────────────
    const mine = await db
      .select({ id: nflPoolEntries.id })
      .from(nflPoolEntries)
      .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.userId, userId)))

    if (pool.maxEntriesPerUser != null && mine.length >= pool.maxEntriesPerUser) {
      return res.status(409).json({
        error:
          pool.maxEntriesPerUser === 1
            ? 'You are already in this pool.'
            : `You already hold ${mine.length} entries, which is the limit here.`,
        entryId: mine[0]?.id,
      })
    }

    if (pool.maxEntries != null) {
      const all = await db
        .select({ id: nflPoolEntries.id })
        .from(nflPoolEntries)
        .where(eq(nflPoolEntries.poolId, pool.id))
      if (all.length >= pool.maxEntries) {
        return res.status(409).json({ error: 'This pool is full.' })
      }
    }

    const handle = await ensureUser(userId)

    const [entry] = await db
      .insert(nflPoolEntries)
      .values({
        poolId: pool.id,
        userId,
        // Default names stay distinguishable when one person holds
        // several, since the leaderboard shows entries, not people.
        // Defaults to the member's handle — "My entry" told a standings
        // page nothing about who it was.
        entryName: entryName?.trim() || (mine.length ? `${handle} ${mine.length + 1}` : handle),
      })
      .returning()

    if (invite) {
      await db
        .update(nflPoolInvites)
        .set({ status: 'accepted', acceptedAt: new Date(), acceptedByUserId: userId })
        .where(eq(nflPoolInvites.id, invite.id))
    }

    return res.status(201).json({ pool, entry })
  } catch (error) {
    console.error('POST /api/pools/join failed:', error)
    return res.status(500).json({ error: 'Could not join that pool.' })
  }
}
