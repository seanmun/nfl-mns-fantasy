import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import '@/ui/mns-ui.css'

// Simple Mode: the whole app on one screen, reached from one email
// link, no login. Giant type, one decision at a time, a big green
// Done. Fixed to the Chalk light palette — this page exists for the
// audience that light mode exists for. No header, no tabs, no chrome.

const CHALK: Record<string, string> = {
  '--color-background': '#f2f5f6',
  '--color-foreground': '#122020',
  '--color-card': '#ffffff',
  '--color-border': '#cdd8d9',
  '--color-border-interactive': '#7d9092',
  '--color-muted': '#e7edee',
  '--color-muted-foreground': '#4f6365',
  '--color-accent': '#026b4d',
  '--color-accent-foreground': '#ffffff',
  '--color-accent-soft': '#dff0ea',
  '--color-pick-win': '#026b4d',
  '--color-pick-loss': '#b62c1e',
  '--color-pick-push': '#5f7172',
  '--color-key': '#845600',
  '--color-locked': '#5f7172',
}

interface SimpleTeam { id: string; nickname: string; primaryColor: string | null }
interface SimpleGame {
  gameId: string
  kickoffAt: string
  spread: number | null
  offBoard: boolean
  home: SimpleTeam | null
  away: SimpleTeam | null
  open: boolean
}
interface SimplePayload {
  poolName: string
  entryName: string
  week: { week: number; label: string }
  spreadMode: 'straight_up' | 'ats'
  keyPick: boolean
  need: number
  deadline: string | null
  submittedAt: string | null
  slate: SimpleGame[]
  myPicks: Array<{ gameId: string; selectedTeamId: string; isKeyPick: boolean }>
}

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
})

export function SimplePicks() {
  const { token = '' } = useParams()
  const [data, setData] = useState<SimplePayload | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [picks, setPicks] = useState<Map<string, { teamId: string; isKey: boolean }>>(new Map())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/simple/${token}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setFatal(body.error ?? 'This link did not work.'); return }
    setData(body)
    setPicks(new Map(body.myPicks.map((p: SimplePayload['myPicks'][number]) => [p.gameId, { teamId: p.selectedTeamId, isKey: p.isKeyPick }])))
    if (body.submittedAt) setDone(true)
  }, [token])
  useEffect(() => { void load() }, [load])

  const save = async (next: Map<string, { teamId: string; isKey: boolean }>) => {
    setPicks(next)
    setDone(false)
    setWarn(null)
    const res = await fetch(`/api/simple/${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        picks: [...next].map(([gameId, v]) => ({ gameId, selectedTeamId: v.teamId, isKeyPick: v.isKey })),
      }),
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setWarn(b.errors?.[0] ?? b.error ?? 'That change did not save — try again.')
      void load()
    }
  }

  const tapTeam = (g: SimpleGame, teamId: string) => {
    if (!g.open || !data) return
    const next = new Map(picks)
    const cur = next.get(g.gameId)
    if (cur?.teamId === teamId) next.delete(g.gameId)
    else {
      if (!cur && next.size >= data.need) { setWarn(`That's already ${data.need} picks — remove one first.`); return }
      next.set(g.gameId, { teamId, isKey: cur?.isKey ?? false })
    }
    void save(next)
  }

  const tapStar = (gameId: string) => {
    const next = new Map(picks)
    const mine = next.get(gameId)
    if (!mine) return
    for (const [k, v] of next) next.set(k, { ...v, isKey: false })
    next.set(gameId, { ...mine, isKey: !mine.isKey })
    void save(next)
  }

  const submit = async () => {
    setBusy(true)
    setWarn(null)
    const res = await fetch(`/api/simple/${token}`, { method: 'POST' })
    const b = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setWarn(b.errors?.[0] ?? b.error ?? 'Could not submit — try again.') ; return }
    setDone(true)
    window.scrollTo({ top: 0 })
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ ...CHALK, background: 'var(--color-background)', color: 'var(--color-foreground)', minHeight: '100vh' } as React.CSSProperties}>
      <div className="mns" style={{ maxWidth: '34rem', margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
        {children}
      </div>
    </div>
  )

  if (fatal) {
    return shell(
      <div className="mns-empty">
        <p className="mns-empty__title">{fatal}</p>
        <p>Text your pool manager and ask them to send a fresh link.</p>
      </div>
    )
  }
  if (!data) return shell(<div className="mns-skel" style={{ height: '8rem' }} />)

  const haveKey = [...picks.values()].some((p) => p.isKey)
  const complete = picks.size >= data.need && (!data.keyPick || haveKey)

  return shell(
    <>
      <p style={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)', margin: 0 }}>
        {data.poolName} · {data.week.label}
      </p>
      <h1 style={{ fontSize: '1.6rem', lineHeight: 1.2, margin: '0.25rem 0 0.5rem' }}>
        Hi {data.entryName} — pick {data.need} {data.need === 1 ? 'game' : 'games'}
        {data.keyPick ? ', then star your surest one' : ''}.
      </h1>
      {data.deadline ? (
        <p style={{ margin: '0 0 1rem', color: 'var(--color-muted-foreground)' }}>
          Picks close <b style={{ color: 'var(--color-foreground)' }}>{ET.format(new Date(data.deadline))} ET</b>.
        </p>
      ) : null}

      {done ? (
        <p className="mns-banner mns-banner--ok" role="status" style={{ fontSize: '1.15rem' }}>
          ✓ You&rsquo;re in — {picks.size} of {data.need} picks submitted. You can change
          them until the deadline; just press Done again after.
        </p>
      ) : null}
      {warn ? <p className="mns-banner mns-banner--crit" role="alert">{warn}</p> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: '1.25rem 0' }}>
        {data.slate.map((g) => {
          const picked = picks.get(g.gameId)
          const homeFav = data.spreadMode === 'ats' && g.spread != null && g.spread < 0
          const left = homeFav ? g.home : g.away
          const right = homeFav ? g.away : g.home
          const spreadFor = (team: SimpleTeam | null) => {
            if (data.spreadMode !== 'ats' || g.spread == null || !team) return null
            const homeSide = team.id === g.home?.id
            const v = homeSide ? g.spread : -g.spread
            return v > 0 ? `+${v}` : v === 0 ? 'pick ’em' : `${v}`
          }
          const teamBtn = (team: SimpleTeam | null) => {
            if (!team) return null
            const sel = picked?.teamId === team.id
            return (
              <button
                onClick={() => tapTeam(g, team.id)}
                disabled={!g.open}
                aria-pressed={sel}
                style={{
                  flex: 1, minHeight: '4.25rem', borderRadius: '0.75rem', cursor: g.open ? 'pointer' : 'default',
                  border: `3px solid ${sel ? 'var(--color-accent)' : 'var(--color-border-interactive)'}`,
                  background: sel ? 'var(--color-accent-soft)' : 'var(--color-card)',
                  color: 'var(--color-foreground)', fontSize: '1.2rem', fontWeight: 800,
                  opacity: g.open ? 1 : 0.55, position: 'relative',
                }}
              >
                {team.nickname}
                <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, color: sel ? 'var(--color-accent)' : 'var(--color-muted-foreground)' }}>
                  {spreadFor(team) ?? ''}
                </span>
                {sel ? (
                  <span aria-hidden="true" style={{ position: 'absolute', top: '0.4rem', right: '0.55rem', width: '1.4rem', height: '1.4rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', fontWeight: 900, fontSize: '0.9rem', display: 'grid', placeItems: 'center' }}>✓</span>
                ) : null}
              </button>
            )
          }
          return (
            <div key={g.gameId} className="mns-card" style={{ padding: '0.9rem' }}>
              {g.offBoard ? (
                <p style={{ margin: '0 0 0.5rem', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-key)' }}>
                  Off the board — can&rsquo;t be picked this week
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'stretch' }}>
                {teamBtn(left)}
                <span style={{ alignSelf: 'center', fontWeight: 800, color: 'var(--color-muted-foreground)' }}>
                  {right?.id === g.home?.id ? 'at' : 'vs'}
                </span>
                {teamBtn(right)}
              </div>
              {data.keyPick && picked ? (
                <button
                  onClick={() => tapStar(g.gameId)}
                  aria-pressed={picked.isKey}
                  style={{
                    marginTop: '0.6rem', width: '100%', minHeight: '3rem', borderRadius: '0.5rem',
                    fontWeight: 800, fontSize: '1rem', cursor: 'pointer',
                    border: `2px ${picked.isKey ? 'solid' : 'dashed'} ${picked.isKey ? 'var(--color-key)' : 'var(--color-border-interactive)'}`,
                    background: picked.isKey ? 'var(--color-key)' : 'transparent',
                    color: picked.isKey ? '#fff' : 'var(--color-muted-foreground)',
                  }}
                >
                  {picked.isKey ? '★ This is my star pick' : '☆ Make this my star pick'}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div style={{ position: 'sticky', bottom: '0.75rem' }}>
        <button
          onClick={submit}
          disabled={!complete || busy}
          className="mns-btn mns-btn--full"
          style={{ minHeight: '4rem', fontSize: '1.3rem', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
        >
          {busy ? 'Sending…' : done ? '✓ Submitted' : complete ? 'Done — submit my picks' : `${picks.size} of ${data.need} picked${data.keyPick && picks.size >= data.need && !haveKey ? ' — star one' : ''}`}
        </button>
      </div>
    </>
  )
}
