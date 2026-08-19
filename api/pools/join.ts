import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq, ilike, isNotNull } from 'drizzle-orm'
import { db } from '../_db.js'
import { verifyAuth } from '../_middleware.js'
import { ensureUser } from '../_ensureUser.js'
import { applyCors } from '../_pool.js'
import {
  nflPoolEntries,
  nflPoolInvites,
  nflPools,
  nflPoolWeeks,
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

  const { joinCode, inviteToken, poolId, entryName, addEntry } = (req.body ?? {}) as {
    joinCode?: string
    inviteToken?: string
    poolId?: string
    entryName?: string
    addEntry?: boolean
  }

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
    // Entries stay open until the FIRST PICK LOCK — the earliest pick
    // deadline the pool has committed to — not the first kickoff. A
    // pool with nothing published yet is always open.
    if (!pool.allowLateJoin) {
      const [firstDeadline] = await db
        .select({ deadline: nflPoolWeeks.pickDeadlineAt })
        .from(nflPoolWeeks)
        .where(and(eq(nflPoolWeeks.poolId, pool.id), isNotNull(nflPoolWeeks.pickDeadlineAt)))
        .orderBy(asc(nflPoolWeeks.pickDeadlineAt))
        .limit(1)
      if (firstDeadline?.deadline && new Date() >= firstDeadline.deadline) {
        return res.status(403).json({ error: 'This pool has already started and is closed to new entries.' })
      }
    }

    // ── Membership ───────────────────────────────────────────────
    const mine = await db
      .select({ id: nflPoolEntries.id, status: nflPoolEntries.status })
      .from(nflPoolEntries)
      .where(and(eq(nflPoolEntries.poolId, pool.id), eq(nflPoolEntries.userId, userId)))

    // A ban is a ban — no rejoining, no fresh entry alongside it.
    if (mine.some((e) => e.status === 'banned')) {
      return res.status(403).json({ error: 'You have been removed from this pool by the manager.' })
    }

    // An entry is a season-long CONTESTANT, and it is created in exactly
    // two deliberate moments: first join, or an explicit "add another
    // entry". A member re-tapping an invite link, revisiting /join, or
    // opening a new week must land in the pool they are already in — a
    // silent second entry from any of those is how one person's picks
    // split across two leaderboard rows.
    if (mine.length > 0 && !addEntry) {
      return res.status(200).json({ pool, entry: { id: mine[0].id }, alreadyMember: true })
    }

    // ── Caps ─────────────────────────────────────────────────────
    if (pool.maxEntriesPerUser != null && mine.length >= pool.maxEntriesPerUser) {
      return res.status(409).json({
        error:
          pool.maxEntriesPerUser === 1
            ? 'This pool is one entry per person.'
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

    // A second entry must be named by its owner; only entry #1 may fall
    // back to the handle, and only because the join page prefills it.
    const wanted = entryName?.trim() || (addEntry ? '' : handle)
    if (!wanted) {
      return res.status(400).json({ error: 'Give this entry a name.' })
    }

    // Unique within the pool, case-insensitive — two rows reading alike
    // on a leaderboard is a coin-flip argument waiting to happen.
    const taken = await db
      .select({ id: nflPoolEntries.id, entryName: nflPoolEntries.entryName })
      .from(nflPoolEntries)
      .where(eq(nflPoolEntries.poolId, pool.id))
    if (taken.some((t) => t.entryName.toLowerCase() === wanted.toLowerCase())) {
      return res.status(409).json({ error: `“${wanted}” is taken in this pool — pick another name.` })
    }

    const [entry] = await db
      .insert(nflPoolEntries)
      .values({ poolId: pool.id, userId, entryName: wanted })
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
