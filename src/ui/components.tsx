// AUTO-SYNCED from mns-ui — do not edit here. Edit mns-ui/src/components.tsx and run sync.sh.
// mns-ui React components. Thin, typed wrappers over the classes in
// mns-ui.css — pages compose these and never restyle them. Sourced
// from the Phase 0 best-in-class picks: hub's forms, ncaa's cards and
// countdown, golf's empty state, nfl's tab bar / stepper / hero.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from './theme'

// ── Button ──────────────────────────────────────────────────────────
export function Button({
  variant = 'primary',
  full,
  to,
  className = '',
  children,
  ...rest
}: {
  variant?: 'primary' | 'quiet' | 'danger' | 'ghost'
  full?: boolean
  to?: string
  className?: string
  children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    'mns-btn',
    variant !== 'primary' ? `mns-btn--${variant}` : '',
    full ? 'mns-btn--full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}

// ── Card ────────────────────────────────────────────────────────────
export function Card({
  hero,
  admin,
  className = '',
  children,
}: {
  hero?: boolean
  admin?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={[
        'mns-card',
        hero ? 'mns-card--hero' : '',
        admin ? 'mns-card--admin' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}

// ── ListRow ─────────────────────────────────────────────────────────
export function ListRow({
  lead,
  title,
  sub,
  end,
  mine,
}: {
  lead?: ReactNode
  title: ReactNode
  sub?: ReactNode
  end?: ReactNode
  mine?: boolean
}) {
  return (
    <div className={'mns-row' + (mine ? ' mns-row--mine' : '')}>
      {lead != null ? <span className="mns-row__lead">{lead}</span> : null}
      <span className="mns-row__body">
        <span className="mns-row__title">{title}</span>
        {sub != null ? <span className="mns-row__sub">{sub}</span> : null}
      </span>
      {end != null ? <span className="mns-row__end">{end}</span> : null}
    </div>
  )
}

// ── Chip ────────────────────────────────────────────────────────────
export function Chip({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'accent' | 'key' | 'win' | 'loss'
  children: ReactNode
}) {
  return (
    <span className={'mns-chip' + (tone !== 'default' ? ` mns-chip--${tone}` : '')}>
      {children}
    </span>
  )
}

// ── Field ───────────────────────────────────────────────────────────
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="mns-field">
      <label className="mns-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? <p className="mns-field__hint">{hint}</p> : null}
      {children}
    </div>
  )
}

// ── Banner ──────────────────────────────────────────────────────────
export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'crit' | 'ok'
  children: ReactNode
}) {
  return (
    <p className={'mns-banner' + (tone !== 'info' ? ` mns-banner--${tone}` : '')}>{children}</p>
  )
}

// ── StatTile ────────────────────────────────────────────────────────
export function StatTile({
  label,
  value,
  sub,
  to,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  to?: string
}) {
  const body = (
    <>
      <span className="mns-tile__label">{label}</span>
      <b className="mns-tile__value">{value}</b>
      {sub != null ? <span className="mns-tile__sub">{sub}</span> : null}
    </>
  )
  return to ? (
    <Link to={to} className="mns-tile">
      {body}
    </Link>
  ) : (
    <div className="mns-tile">{body}</div>
  )
}

// ── EmptyState ──────────────────────────────────────────────────────
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mns-empty">
      <p className="mns-empty__title">{title}</p>
      {children}
    </div>
  )
}

// ── Skeleton ────────────────────────────────────────────────────────
export function Skeleton({ h = '1rem', w = '100%' }: { h?: string; w?: string }) {
  return <div className="mns-skel" style={{ height: h, width: w }} aria-hidden="true" />
}

// ── BottomTabBar ────────────────────────────────────────────────────
// One nav model for every game: Home · Play · Standings inside a
// context. `basePath` is the context root (/pool/:id or /league/:id).
// `onAsk` adds the assistant button in the bar's center — a BUTTON,
// not a tab: it opens the assistant sheet over the current screen and
// navigates nowhere, so the three-tab model stays intact underneath.
export function BottomTabBar({
  basePath,
  playLabel = 'Picks',
  playPath = 'picks',
  onAsk,
  askLabel = 'Ask',
}: {
  basePath: string
  playLabel?: string
  playPath?: string
  onAsk?: () => void
  askLabel?: string
}) {
  const { pathname } = useLocation()
  const tabs = [
    { to: basePath, label: 'Home', icon: '\u{1F3E0}', exact: true },
    { to: `${basePath}/${playPath}`, label: playLabel, icon: '✓', exact: false },
    { to: `${basePath}/standings`, label: 'Standings', icon: '\u{1F3C6}', exact: false },
  ]
  const renderTab = (t: (typeof tabs)[number]) => {
    const active = t.exact ? pathname === t.to : pathname.startsWith(t.to)
    return (
      <Link
        key={t.to}
        to={t.to}
        aria-current={active ? 'page' : undefined}
        className={'mns-tab' + (active ? ' mns-tab--active' : '')}
      >
        <span aria-hidden="true" className="mns-tab__icon">
          {t.icon}
        </span>
        {t.label}
      </Link>
    )
  }
  return (
    <nav aria-label="Sections" className="mns-tabbar">
      {renderTab(tabs[0])}
      {renderTab(tabs[1])}
      {onAsk ? (
        <button type="button" className="mns-tab-ask" onClick={onAsk} aria-label={`${askLabel} the assistant`}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
          </svg>
          {askLabel}
        </button>
      ) : null}
      {renderTab(tabs[2])}
    </nav>
  )
}

// ── Stepper ─────────────────────────────────────────────────────────
// Half-point spread entry. Phone keyboards have no minus key; lines
// only move in halves. null = off the board.
export function Stepper({
  value,
  onChange,
  step = 0.5,
  disabled,
  nullLabel = 'off board',
  clearable = true,
}: {
  value: number | null
  onChange: (v: number | null) => void
  step?: number
  disabled?: boolean
  nullLabel?: string
  clearable?: boolean
}) {
  return (
    <span className="mns-stepper">
      <button
        type="button"
        aria-label="Decrease"
        disabled={disabled}
        onClick={() => onChange((value ?? 0) - step)}
      >
        &minus;
      </button>
      <span className="mns-stepper__value">
        {value == null ? (
          <span className="mns-stepper__off">{nullLabel}</span>
        ) : value > 0 ? (
          `+${value}`
        ) : (
          value
        )}
      </span>
      <button
        type="button"
        aria-label="Increase"
        disabled={disabled}
        onClick={() => onChange((value ?? 0) + step)}
      >
        +
      </button>
      {clearable && value != null ? (
        <button type="button" className="mns-btn mns-btn--ghost" disabled={disabled} onClick={() => onChange(null)}>
          Clear
        </button>
      ) : null}
    </span>
  )
}

// ── Countdown ───────────────────────────────────────────────────────
// Live time-to-deadline, urgent under an hour. Renders the deadline
// verbatim once passed — a countdown that goes negative reads broken.
export function Countdown({ until, prefix = 'Closes in' }: { until: string | Date; prefix?: string }) {
  const target = typeof until === 'string' ? new Date(until) : until
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const ms = target.getTime() - now
  if (ms <= 0) return <span className="mns-countdown">Closed</span>
  const mins = Math.floor(ms / 60_000)
  const urgent = mins < 60
  const label =
    mins < 60
      ? `${mins}m`
      : mins < 60 * 48
        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
        : `${Math.floor(mins / (60 * 24))} days`
  return (
    <span className={'mns-countdown' + (urgent ? ' mns-countdown--urgent' : '')}>
      {prefix} {label}
    </span>
  )
}

// ── ConfirmPanel ────────────────────────────────────────────────────
// The one shape for irreversible acts: say what happens, confirm or
// back out. Emails, publishes, bans.
export function ConfirmPanel({
  title,
  detail,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  title: ReactNode
  detail?: ReactNode
  confirmLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="mns-confirm">
      <b>{title}</b>
      {detail ? <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-muted-foreground)' }}>{detail}</p> : null}
      <div className="mns-confirm__actions">
        <Button full disabled={pending} onClick={onConfirm}>
          {pending ? 'Working…' : confirmLabel}
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  )
}

// ── PageHeader ──────────────────────────────────────────────────────
export function PageHeader({
  back,
  backLabel = 'Back',
  backState,
  eyebrow,
  title,
  status,
  children,
}: {
  back?: string
  backLabel?: string
  backState?: unknown
  eyebrow?: ReactNode
  title: ReactNode
  status?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mns-pagehead">
      {back ? (
        <Link to={back} state={backState} className="mns-pagehead__back">
          &larr; {backLabel}
        </Link>
      ) : null}
      {eyebrow ? <p className="mns-pagehead__eyebrow">{eyebrow}</p> : null}
      <h1 className="mns-pagehead__title">{title}</h1>
      {status ? <p className="mns-pagehead__status">{status}</p> : null}
      {children}
    </header>
  )
}

// ── ThemeToggle ─────────────────────────────────────────────────────
// One button: shows a moon in light mode, a sun in dark, and a tap pins
// the opposite theme (remembered — src/ui/theme.ts). Follow-the-phone
// stays the default until the first tap. The label says what tapping
// DOES; the icon is aria-hidden so it is never the only signal.
export function ThemeToggle() {
  const [choice, setChoice] = useTheme()
  const [osDark, setOsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setOsDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const dark = choice === 'dark' || (choice === 'system' && osDark)

  return (
    <button
      type="button"
      className="mns-theme-toggle"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setChoice(dark ? 'light' : 'dark')}
    >
      {dark ? (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

// ── Sheet ───────────────────────────────────────────────────────────
// The assistant layer: a bottom sheet OVER the current screen, so the
// member never leaves where they are. Tap the grip or the backdrop to
// dismiss. Deliberately no drag physics in v1 — the grip is a labeled
// 3rem+ target, which this audience can actually find.
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="mns-sheet-backdrop" onClick={onClose}>
      <div
        className="mns-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mns-sheet__grip" aria-label="Close" onClick={onClose} />
        {children}
      </div>
    </div>
  )
}

// ── AssistantChat ───────────────────────────────────────────────────
// The conversation itself, transport-injected: the app supplies
// `send(history)` (its own authed call to the platform agent) and this
// component owns messages, dictation and spoken replies. Dictation
// fills the box — the member still taps send, so a mis-hearing can
// never submit anything by itself.
interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
      }) => void)
    | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

function makeRecognizer(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.continuous = false
  rec.interimResults = true
  return rec
}

function speakAloud(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

// What a voice should actually say: markdown syntax stripped, so
// "**Giants +3.5**" reads as "Giants plus three and a half", not
// "asterisk asterisk…". Applied to every voice path, custom or device.
function speechText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
}

const MicIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
  </svg>
)

export function AssistantChat({
  send,
  tts,
  suggestions = [],
  placeholder = 'Ask about your pools…',
}: {
  send: (messages: AssistantMessage[]) => Promise<string>
  // Optional custom voice (e.g. ElevenLabs via the hub's /api/tts):
  // return audio, or null to decline. Any failure falls back to the
  // free device voice, so an unconfigured voice never breaks speech.
  tts?: (text: string) => Promise<Blob | null>
  suggestions?: string[]
  placeholder?: string
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(false)
  const speakRef = useRef(false)
  speakRef.current = speakReplies
  const ttsRef = useRef(tts)
  ttsRef.current = tts
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceSupported] = useState(() => typeof window !== 'undefined' && makeRecognizer() != null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const doSend = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    // Sending ends the dictation session, and deafens it first — a
    // still-open recognizer fires one last onresult AFTER the box is
    // cleared, refilling it with the old transcript and jamming the
    // next recording. (Found by Sean's dad-test-in-waiting, 2026-09-09.)
    if (recognizerRef.current) {
      recognizerRef.current.onresult = null
      recognizerRef.current.stop()
    }
    const next: AssistantMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const reply = await send(next)
      setMessages([...next, { role: 'assistant', content: reply }])
      if (speakRef.current) void speakReply(reply)
    } catch (e) {
      setMessages([
        ...next,
        {
          role: 'assistant',
          content:
            e instanceof Error && e.message
              ? `Something went wrong: ${e.message}`
              : 'Something went wrong — try that again.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  const speakReply = async (raw: string) => {
    const text = speechText(raw)
    audioRef.current?.pause()
    if (ttsRef.current) {
      try {
        const blob = await ttsRef.current(text)
        if (blob) {
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended = () => URL.revokeObjectURL(url)
          await audio.play()
          return
        }
      } catch {
        /* fall through to the device voice */
      }
    }
    speakAloud(text)
  }

  const toggleMic = () => {
    if (listening) {
      recognizerRef.current?.stop()
      return
    }
    const rec = makeRecognizer()
    if (!rec) return
    recognizerRef.current = rec
    rec.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript
      setInput(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }

  return (
    <div className="mns-chat">
      <div className="mns-chat__scroll">
        {messages.length === 0
          ? suggestions.map((s) => (
              <button key={s} type="button" className="mns-chat__suggestion" onClick={() => void doSend(s)}>
                {s}
              </button>
            ))
          : messages.map((m, i) => (
              <div
                key={i}
                className={
                  'mns-chat__bubble ' +
                  (m.role === 'user' ? 'mns-chat__bubble--user' : 'mns-chat__bubble--assistant')
                }
              >
                {m.content}
              </div>
            ))}
        {busy ? (
          <div className="mns-chat__bubble mns-chat__bubble--assistant" style={{ color: 'var(--color-muted-foreground)' }}>
            Checking your pools…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="mns-chat__composer"
        onSubmit={(e) => {
          e.preventDefault()
          void doSend(input)
        }}
      >
        <button
          type="button"
          className={'mns-chat__btn' + (speakReplies ? ' mns-chat__btn--active' : '')}
          aria-pressed={speakReplies}
          aria-label={speakReplies ? 'Stop reading replies aloud' : 'Read replies aloud'}
          onClick={() => {
            if (speakReplies) {
              if ('speechSynthesis' in window) window.speechSynthesis.cancel()
              audioRef.current?.pause()
            }
            setSpeakReplies((s) => !s)
          }}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            {speakReplies ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /> : <path d="m16 9 6 6M22 9l-6 6" />}
          </svg>
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void doSend(input)
            }
          }}
          rows={1}
          placeholder={listening ? 'Listening…' : placeholder}
          className="mns-chat__input"
        />
        {voiceSupported ? (
          <button
            type="button"
            className={'mns-chat__btn' + (listening ? ' mns-chat__btn--active' : '')}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Speak your question'}
            onClick={toggleMic}
          >
            <MicIcon />
          </button>
        ) : null}
        <button type="submit" className="mns-chat__btn mns-chat__btn--primary" aria-label="Send" disabled={busy || !input.trim()}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z" />
          </svg>
        </button>
      </form>
    </div>
  )
}
