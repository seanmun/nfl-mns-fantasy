import { useCallback, useRef, useState } from 'react'

// Auto-save for the picks screen.
//
// There is no Save button, so this is the only thing standing between a
// member and losing their week. Two rules follow from that:
//
//  1. Every save sends the FULL desired set, never a delta. That makes
//     saves idempotent and last-write-wins correct, so an out-of-order
//     response cannot resurrect a pick the member removed.
//  2. A failure is never silent. Without a button there is no moment
//     where someone would notice nothing happened, so `error` has to be
//     surfaced loudly and stay until it succeeds.

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useAutoSave<T>(save: (value: T) => Promise<unknown>) {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Sequence number so a slow earlier response cannot overwrite the
  // status of a faster later one. Taps come fast on a phone.
  const seq = useRef(0)
  // The most recent value, kept so a retry sends current state rather
  // than whatever failed a minute ago.
  const latest = useRef<T | null>(null)

  const run = useCallback(
    async (value: T) => {
      latest.current = value
      const mine = ++seq.current
      setState('saving')
      setError(null)

      try {
        await save(value)
        // A newer save started while this was in flight; let it own the
        // status rather than flashing "saved" for stale data.
        if (mine !== seq.current) return
        setState('saved')
      } catch (err) {
        if (mine !== seq.current) return
        setState('error')
        setError(err instanceof Error ? err.message : 'Could not save')
      }
    },
    [save]
  )

  const retry = useCallback(() => {
    if (latest.current !== null) void run(latest.current)
  }, [run])

  return { state, error, save: run, retry }
}
