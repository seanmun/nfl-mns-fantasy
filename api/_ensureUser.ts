import { createClerkClient } from '@clerk/backend'
import { db } from './_db.js'
import { users } from '../src/lib/db/schema.js'

// Anything that writes a row keyed to a user must guarantee the user
// exists first. The client-side sync is fire-and-forget, so a brand-new
// account can reach an endpoint before its row lands — in golf that used
// to fail the pool join outright. Here it would fail joining a pool from
// an invite link, which is the very first thing an invited user does.
// Returns the display name so callers can default entry names to it.
//
// Privacy rule, platform-wide: members are shown by HANDLE, never by
// legal name. Clerk's username when the instance has usernames enabled,
// else the email's local part. firstName/lastName are deliberately not
// in the chain — a pool full of coworkers or in-laws should not be
// broadcasting real names on a leaderboard.
export async function ensureUser(userId: string): Promise<string> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })
  const user = await clerk.users.getUser(userId)
  const email = user.emailAddresses[0]?.emailAddress || ''
  const displayName = user.username || email.split('@')[0] || 'Player'
  const avatarUrl = user.imageUrl || null

  await db
    .insert(users)
    .values({ id: userId, email, displayName, avatarUrl })
    .onConflictDoUpdate({
      target: users.id,
      set: { email, displayName, avatarUrl },
    })

  return displayName
}
