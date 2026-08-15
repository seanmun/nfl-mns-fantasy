import type { VercelRequest } from '@vercel/node'
import { verifyToken } from '@clerk/backend'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean)

export async function verifyAuth(req: VercelRequest): Promise<string | null> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return null
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! })
    return payload.sub
  } catch {
    return null
  }
}

export function isAdmin(userId: string): boolean {
  return ADMIN_IDS.includes(userId)
}

// Guards /api/cron/* and the manual sync/regrade endpoints. Vercel sends
// the deployment's CRON_SECRET as a bearer token on scheduled
// invocations; a request without it is someone poking the endpoint.
export function verifyCron(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.authorization
  return header === `Bearer ${secret}`
}
