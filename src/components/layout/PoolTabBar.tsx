import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useQueryClient } from '@tanstack/react-query'
import { AssistantChat, BottomTabBar, Sheet } from '@/ui/components'

const HUB = import.meta.env.VITE_PLATFORM_URL || 'https://mnsfantasy.com'

const SUGGESTIONS = [
  'What are the biggest spreads this week?',
  'How many picks do I have in?',
  'Show me the standings',
]

// The pool's persistent bottom navigation — mns-ui's BottomTabBar with
// the Ask button in its center. Ask opens the assistant as a sheet OVER
// the current screen: the agent runs in the hub, acts with this
// member's own session, and already knows which pool is on screen.
// Closing the sheet refetches everything, so picks the assistant saved
// are visible on the page the moment it slides away.
export function PoolTabBar() {
  const { id: poolId = '' } = useParams()
  const { getToken } = useAuth()
  const qc = useQueryClient()
  const [askOpen, setAskOpen] = useState(false)

  const send = async (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    const token = await getToken()
    const res = await fetch(`${HUB}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages, context: { game: 'nfl', poolId } }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
    return (body as { reply: string }).reply
  }

  return (
    <>
      <BottomTabBar basePath={`/pool/${poolId}`} onAsk={() => setAskOpen(true)} />
      <Sheet
        open={askOpen}
        label="Assistant"
        onClose={() => {
          setAskOpen(false)
          // The agent may have saved or submitted picks — make the page
          // behind the sheet tell the truth the moment it closes.
          void qc.invalidateQueries()
        }}
      >
        <AssistantChat send={send} suggestions={SUGGESTIONS} />
      </Sheet>
    </>
  )
}
