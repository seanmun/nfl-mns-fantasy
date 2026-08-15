import { Resend } from 'resend'

// Resend client. Same account as the hub; this app sends three things —
// pool invites, admin announcements, and the pre-deadline nudge.

export interface SendResult {
  sent: number
  failed: Array<{ to: string; error: string }>
}

function client(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY not configured')
  return new Resend(key)
}

function from(): string {
  return process.env.RESEND_FROM || 'MNS Fantasy <noreply@mnsfantasy.com>'
}

export interface Message {
  to: string
  subject: string
  html: string
  text: string
}

// Sends one at a time and records per-recipient failures rather than
// throwing on the first one.
//
// A blast that dies halfway through is worse than one that reports "38
// sent, 2 failed": the caller cannot tell who got it, and a naive retry
// re-sends to everyone who already did. Callers persist the counts —
// pool_announcements has columns for exactly this.
export async function sendAll(messages: Message[]): Promise<SendResult> {
  const resend = client()
  const result: SendResult = { sent: 0, failed: [] }

  for (const message of messages) {
    try {
      const { error } = await resend.emails.send({
        from: from(),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
      if (error) {
        result.failed.push({ to: message.to, error: error.message ?? String(error) })
      } else {
        result.sent++
      }
    } catch (err) {
      result.failed.push({ to: message.to, error: String(err) })
    }
  }
  return result
}

// Minimal HTML escape for anything interpolated into an email body.
// Entry names, pool names and the manager's note are all user-authored.
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
