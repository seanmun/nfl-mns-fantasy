import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, eq } from 'drizzle-orm'
import { db } from './_db.js'
import { isAdmin, verifyAuth } from './_middleware.js'
import { nflPoolEntries, nflPoolWeeks, nflPools, type NflPool } from '../src/lib/db/schema.js'

// Shared pool plumbing: who is asking, what they are allowed to do, and
// the one rule that decides whether they may see anyone else's picks.

export interface Ctx {
  userId: string
  pool: NflPool
  // Every entry this user holds in the pool. Plural because a user may
  // hold several — anything that assumes one will merge them.
  entries: Array<typeof nflPoolEntries.$inferSelect>
  isPoolAdmin: boolean
}

export async function loadCtx(
  req: VercelRequest,
  res: VercelResponse,
  poolId: string
): Promise<Ctx | null> {
  const userId = await verifyAuth(req)
  if (!userId) {
    res.status(401).json({ error: 'Sign in to continue.' })
    return null
  }

  const [pool] = await db.select().from(nflPools).where(eq(nflPools.id, poolId)).limit(1)
  if (!pool) {
    res.status(404).json({ error: 'That pool does not exist.' })
    return null
  }

  const entries = await db
    .select()
    .from(nflPoolEntries)
    .where(and(eq(nflPoolEntries.poolId, poolId), eq(nflPoolEntries.userId, userId)))

  return {
    userId,
    pool,
    entries,
    // The pool's creator runs it. Site admins can act on any pool, which
    // is a support tool, not the normal path.
    isPoolAdmin: pool.createdBy === userId || isAdmin(userId),
  }
}

export function requirePoolAdmin(ctx: Ctx, res: VercelResponse): boolean {
  if (!ctx.isPoolAdmin) {
    res.status(403).json({ error: 'Only the pool manager can do that.' })
    return false
  }
  return true
}

// THE pick-visibility rule. Everything that returns picks routes through
// this — a leaderboard query that joins picks, a week view, an admin
// endpoint reused on a member page. Repeating the check per route is how
// one of them ends up missing it and leaks the whole pool's picks.
//
// Deliberate consequence: an early game can be played and graded while
// who picked it is still hidden. The result is public, the picks are not,
// until the week's cutoff.
export async function othersPicksVisible(poolId: string, weekId: string): Promise<boolean> {
  const [pw] = await db
    .select({ deadline: nflPoolWeeks.pickDeadlineAt })
    .from(nflPoolWeeks)
    .where(and(eq(nflPoolWeeks.poolId, poolId), eq(nflPoolWeeks.weekId, weekId)))
    .limit(1)
  if (!pw?.deadline) return false
  return new Date() >= pw.deadline
}

// Join codes are read aloud and typed by people who did not choose them,
// so the alphabet drops every character that is ambiguous in a sans
// face: O/0, I/1/L, S/5, B/8.
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'

export function generateJoinCode(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin
  const allowed =
    !!origin &&
    (/^https:\/\/([a-z0-9-]+\.)?mnsfantasy\.com$/.test(origin) ||
      /^http:\/\/localhost:\d+$/.test(origin))
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}
