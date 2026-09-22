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

// Fallback tab icons — lucide's paths, inlined so mns-ui needs no icon
// package. An app passes its own lucide-react components instead.
const glyph = (d: ReactNode) => (
  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)
const HomeGlyph = () => glyph(<><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>)
const CheckGlyph = () => glyph(<path d="M20 6 9 17l-5-5" />)
const TrophyGlyph = () => glyph(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0z" /></>)

// ── BottomTabBar ────────────────────────────────────────────────────
// One nav model for every game: Home · Play · Standings inside a
// context. `basePath` is the context root (/pool/:id or /league/:id).
// `onAsk` adds the assistant button in the bar's center — a BUTTON,
// not a tab: it opens the assistant sheet over the current screen and
// navigates nowhere, so the tab model stays intact underneath.
// `extraTab` adds a fourth tab after Standings (NFL: Prizes), which
// also balances the bar two-and-two around the Ask button.
//
// Icons are passed IN (`icons`, and extraTab.icon) so an app can hand
// over its own lucide-react components; mns-ui carries no icon
// dependency of its own, because not every app installs one. The
// fallbacks below are lucide's paths inlined — same drawing, no import.
export function BottomTabBar({
  basePath,
  playLabel = 'Picks',
  playPath = 'picks',
  standingsLabel = 'Standings',
  standingsPath = 'standings',
  onAsk,
  askLabel = 'Ask',
  icons,
  extraTab,
}: {
  basePath: string
  playLabel?: string
  playPath?: string
  // The third slot defaults to Standings; a game may repoint it (WNBA:
  // Players → the free-agent pool, standings living on Home instead).
  standingsLabel?: string
  standingsPath?: string
  onAsk?: () => void
  askLabel?: string
  icons?: { home?: ReactNode; play?: ReactNode; standings?: ReactNode }
  extraTab?: { path: string; label: string; icon: ReactNode }
}) {
  const { pathname } = useLocation()
  const tabs = [
    { to: basePath, label: 'Home', icon: icons?.home ?? <HomeGlyph />, exact: true },
    { to: `${basePath}/${playPath}`, label: playLabel, icon: icons?.play ?? <CheckGlyph />, exact: false },
    { to: `${basePath}/${standingsPath}`, label: standingsLabel, icon: icons?.standings ?? <TrophyGlyph />, exact: false },
    ...(extraTab
      ? [{ to: `${basePath}/${extraTab.path}`, label: extraTab.label, icon: extraTab.icon, exact: false }]
      : []),
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
    <nav aria-label="Sections" className={'mns-tabbar' + (extraTab ? ' mns-tabbar--four' : '')}>
      {renderTab(tabs[0])}
      {renderTab(tabs[1])}
      {onAsk ? (
        // The visible label is the name ("Ask Bump") — no aria-label to
        // drift from what the member reads.
        <button type="button" className="mns-tab-ask" onClick={onAsk}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
          </svg>
          {askLabel}
        </button>
      ) : null}
      {renderTab(tabs[2])}
      {tabs[3] ? renderTab(tabs[3]) : null}
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
  compact,
}: {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
  /** Size to content instead of the chat sheet's near-full height. */
  compact?: boolean
}) {
  if (!open) return null
  return (
    <div className="mns-sheet-backdrop" onClick={onClose}>
      <div
        className={'mns-sheet' + (compact ? ' mns-sheet--compact' : '')}
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
  abort(): void
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
      }) => void)
    | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

// Detach a recognizer and end it, so nothing it fires later — a last
// result, a late onend — can touch the box or the mic state.
function retire(rec: SpeechRecognitionLike | null) {
  if (!rec) return
  rec.onresult = null
  rec.onend = null
  rec.onerror = null
  try {
    rec.abort()
  } catch {
    /* already ended */
  }
}

// What a failed recording tells the member, in words. 'aborted' is
// ours (a retire), so it says nothing.
function micProblem(error: string): string | null {
  if (error === 'aborted') return null
  if (error === 'no-speech') return "Didn't hear anything — tap the mic and try again."
  if (error === 'not-allowed' || error === 'service-not-allowed')
    return "The microphone is blocked. Allow it for this site in your phone's settings, then tap the mic again."
  if (error === 'audio-capture') return 'No microphone was found.'
  return "Voice didn't work that time — tap the mic to try again."
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

// Two short tones, synthesised rather than shipped as files: no assets,
// no licence, and nothing to fail to load. Rising = the mic is live,
// falling = it stopped and Bump is answering. For a member who can't
// watch the screen these ARE the interface, so they never carry meaning
// alone — the screen says the same thing in words.
let toneCtx: AudioContext | null = null
function earcon(direction: 'start' | 'stop') {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    toneCtx ??= new Ctor()
    // A context created before the first tap starts suspended; every
    // call here follows one, so resuming is safe and usually a no-op.
    void toneCtx.resume()
    const t = toneCtx.currentTime
    const osc = toneCtx.createOscillator()
    const gain = toneCtx.createGain()
    osc.type = 'sine'
    const [from, to] = direction === 'start' ? [620, 880] : [660, 400]
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.12)
    // Eased in and out: a square-edged blip clicks on phone speakers.
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.connect(gain)
    gain.connect(toneCtx.destination)
    osc.start(t)
    osc.stop(t + 0.2)
  } catch {
    /* no audio here — the words on screen still carry the state */
  }
}

// 44 bytes of silence. Played inside a tap, it unlocks an <audio>
// element that can then speak a second later, when the answer arrives —
// phones only allow sound that a tap started, and hands-free's voice
// always arrives after the tap has ended.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA='

// Speaks, and resolves when the speaking has FINISHED. Hands-free waits
// on this before listening again: a phone cannot record its own voice
// without hearing itself.
function speakAloud(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve()
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    utterance.onend = finish
    utterance.onerror = finish
    // Some browsers never fire onend at all. Hands-free waits on this
    // promise before reopening the mic, so a missing event would hang
    // the conversation — this caps the wait at a generous reading of
    // the text (~150 words a minute) plus a few seconds.
    const words = text.split(/\s+/).filter(Boolean).length
    window.setTimeout(finish, Math.min(60_000, words * 400 + 4_000))
    window.speechSynthesis.speak(utterance)
  })
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
  // One switch. On: Bump speaks his replies AND the mic reopens as soon
  // as he finishes, so the member just talks. Off: tap the mic per
  // question and read the reply.
  const [handsFree, setHandsFree] = useState(false)
  const handsFreeRef = useRef(false)
  handsFreeRef.current = handsFree
  // The conversation, readable from inside a recogniser callback —
  // hands-free sends without a render in between, and state read
  // through a closure there would be one turn stale.
  const messagesRef = useRef<AssistantMessage[]>([])
  // Consecutive turns that heard only noise.
  const noiseRef = useRef(0)
  const ttsRef = useRef(tts)
  ttsRef.current = tts
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null)
  // Bumps on every mic tap, so a spoken reply still being generated
  // when the member starts talking never plays over their recording.
  const speechSeq = useRef(0)
  const [micNote, setMicNote] = useState<string | null>(null)
  const [voiceSupported] = useState(() => typeof window !== 'undefined' && makeRecognizer() != null)
  const endRef = useRef<HTMLDivElement>(null)

  messagesRef.current = messages

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  // Closing the sheet ends everything — a recognizer or a voice left
  // running behind a closed sheet blocks the next one.
  useEffect(
    () => () => {
      handsFreeRef.current = false
      retire(recognizerRef.current)
      audioRef.current?.pause()
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    },
    []
  )

  const doSend = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    // Sending ends the dictation session, and deafens it first — a
    // still-open recognizer fires one last onresult AFTER the box is
    // cleared, refilling it with the old transcript and jamming the
    // next recording. (Found by Sean's dad-test-in-waiting, 2026-09-09.)
    // The mic flag is cleared HERE, not left to onend: phones don't
    // always fire onend, and a stuck "listening" turned every later mic
    // tap into a stop of a dead session — the mic worked once per sheet.
    retire(recognizerRef.current)
    recognizerRef.current = null
    setListening(false)
    setMicNote(null)
    const next: AssistantMessage[] = [...messagesRef.current, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const reply = await send(next)
      setMessages([...next, { role: 'assistant', content: reply }])
      // Speech is separate from the answer, and failing at it must never
      // overwrite an answer that arrived. Awaited so hands-free does not
      // reopen the mic over Bump's own voice.
      if (handsFreeRef.current) {
        try {
          await speakReply(reply)
        } catch {
          /* the reply is on screen; the voice is a bonus */
        }
      }
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

  // Called from a real tap, and only from a tap: hands the later,
  // untapped voice an audio element and a speech engine that are
  // already allowed to make sound. Silence now buys a voice later.
  const primeVoice = () => {
    try {
      const el = audioRef.current ?? new Audio()
      audioRef.current = el
      el.muted = true
      el.src = SILENT_WAV
      void el
        .play()
        .then(() => {
          el.pause()
          el.currentTime = 0
          el.muted = false
        })
        .catch(() => {
          el.muted = false
        })
    } catch {
      /* no audio element here; the device voice may still work */
    }
    try {
      if ('speechSynthesis' in window) {
        const warmup = new SpeechSynthesisUtterance(' ')
        warmup.volume = 0
        window.speechSynthesis.speak(warmup)
      }
    } catch {
      /* nothing to warm up */
    }
  }

  // Resolves when the speaking has finished, not when it starts. Custom
  // voice first, the device voice whenever that cannot be heard — a
  // blocked or failed playback FALLS THROUGH rather than going quiet,
  // which is how hands-free ended up replying in silence.
  const speakReply = async (raw: string): Promise<void> => {
    const text = speechText(raw)
    audioRef.current?.pause()
    const seq = speechSeq.current
    if (ttsRef.current) {
      try {
        const blob = await ttsRef.current(text)
        // The member tapped the mic while the voice was generating.
        if (seq !== speechSeq.current) return
        if (blob) {
          const url = URL.createObjectURL(blob)
          // The element primed by the tap — a freshly built one would be
          // blocked on a phone.
          const el = audioRef.current ?? new Audio()
          audioRef.current = el
          el.muted = false
          el.src = url
          const heard = await new Promise<boolean>((resolve) => {
            let settled = false
            const finish = (ok: boolean) => {
              if (settled) return
              settled = true
              URL.revokeObjectURL(url)
              resolve(ok)
            }
            el.onended = () => finish(true)
            el.onerror = () => finish(false)
            el.play().catch(() => finish(false))
          })
          if (heard) return
        }
      } catch {
        /* fall through to the device voice */
      }
    }
    if (seq !== speechSeq.current) return
    await speakAloud(text)
  }

  // Reopen the mic for the next turn. iPhone Safari may refuse to start
  // a recording that no tap asked for; startListening reports that as a
  // problem, so a refusal ends the conversation with a sound and a line
  // of words rather than a screen that quietly stopped working.
  const listenAgain = () => {
    if (!handsFreeRef.current) return
    // A breath between turns: back-to-back restarts in a noisy room
    // (a television during the 1 o'clock games) would spin.
    window.setTimeout(() => {
      if (!handsFreeRef.current) return
      earcon('start')
      startListeningRef.current()
    }, 400)
  }

  // Every tap starts a FRESH recording, whatever the last one left
  // behind. Nothing here trusts a previous session to have ended.
  const startListening = () => {
    retire(recognizerRef.current)
    // Phones can't reliably record while playing audio: silence the
    // reply first, including one still being generated.
    speechSeq.current++
    audioRef.current?.pause()
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()

    const rec = makeRecognizer()
    if (!rec) return
    recognizerRef.current = rec
    // Events from a retired recognizer never reach the state.
    const mine = () => recognizerRef.current === rec
    rec.onresult = (event) => {
      if (!mine()) return
      let text = ''
      let final = false
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript
        if (event.results[i].isFinal) final = true
      }
      setInput(text)
      // One utterance per tap: a final result IS the end, whether or not
      // the phone gets round to firing onend.
      if (!final) return
      setListening(false)
      if (!handsFreeRef.current) return
      // The pause that ended the utterance is the send signal. A word or
      // two off the television is not: too short to be a question, so it
      // is dropped and the mic simply stays open.
      const heard = text.trim()
      if (heard.length < 4) {
        setInput('')
        // Nothing but noise, over and over, means the room is winning.
        // Stop rather than listen forever with the speaker chirping.
        noiseRef.current += 1
        if (noiseRef.current >= 5) {
          earcon('stop')
          setHandsFree(false)
          setMicNote('Too noisy to hear you. Tap Hands-free to try again.')
          return
        }
        listenAgain()
        return
      }
      noiseRef.current = 0
      earcon('stop')
      void (async () => {
        await doSendRef.current(heard)
        listenAgain()
      })()
    }
    // No start timeout on purpose: the first tap can sit behind the
    // phone's microphone permission prompt for as long as it likes.
    rec.onend = () => {
      if (mine()) setListening(false)
    }
    rec.onerror = (event) => {
      if (!mine()) return
      setListening(false)
      // Silence ends a hands-free conversation rather than nagging: the
      // member walked away, or is watching the game.
      if (handsFreeRef.current && event.error === 'no-speech') {
        earcon('stop')
        setHandsFree(false)
        setMicNote('Stopped listening. Tap Hands-free to start again.')
        return
      }
      if (handsFreeRef.current) setHandsFree(false)
      setMicNote(micProblem(event.error))
    }
    setMicNote(null)
    setListening(true)
    try {
      rec.start()
    } catch {
      recognizerRef.current = null
      setListening(false)
      if (handsFreeRef.current) {
        // Most likely an iPhone refusing a recording no tap asked for.
        setHandsFree(false)
        earcon('stop')
        setMicNote('Tap the mic to keep going — this phone needs a tap each time.')
      } else {
        setMicNote("Voice didn't start — tap the mic to try again.")
      }
    }
  }

  // Callbacks fire from a recogniser that outlives this render, so the
  // loop reaches the current versions through refs.
  const doSendRef = useRef(doSend)
  doSendRef.current = doSend
  const startListeningRef = useRef(startListening)
  startListeningRef.current = startListening

  const toggleHandsFree = () => {
    if (handsFree) {
      setHandsFree(false)
      handsFreeRef.current = false
      speechSeq.current++
      audioRef.current?.pause()
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      retire(recognizerRef.current)
      recognizerRef.current = null
      setListening(false)
      earcon('stop')
      return
    }
    setHandsFree(true)
    handsFreeRef.current = true
    noiseRef.current = 0
    setMicNote(null)
    primeVoice()
    earcon('start')
    startListening()
  }

  const toggleMic = () => {
    if (!listening) {
      earcon('start')
      primeVoice()
      return startListening()
    }
    earcon('stop')
    // stop, not retire: the last words still land in the box. The flag
    // clears now rather than waiting on an onend that may never come.
    recognizerRef.current?.stop()
    setListening(false)
  }

  return (
    <div className="mns-chat">
      {/* Voice preference lives up top, out of the composer's way. */}
      <div className="mns-chat__bar">
        {voiceSupported ? (
        <button
          type="button"
          className={'mns-chat__voice' + (handsFree ? ' mns-chat__voice--on' : '')}
          aria-pressed={handsFree}
          onClick={toggleHandsFree}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            {handsFree ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /> : <path d="m16 9 6 6M22 9l-6 6" />}
          </svg>
          {handsFree ? 'Hands-free on' : 'Hands-free'}
        </button>
        ) : null}
      </div>
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

      {/* Whatever the tones just said, in words — the sounds are never
          the only signal, and a hands-free member needs to see which
          turn it is. */}
      {handsFree || micNote ? (
        <p
          className={'mns-chat__note' + (handsFree && !micNote ? ' mns-chat__note--live' : '')}
          role="status"
        >
          {micNote
            ? micNote
            : listening
              ? 'Listening — just talk. Tap Hands-free to stop.'
              : busy
                ? 'Answering…'
                : 'Hands-free is on.'}
        </p>
      ) : null}
      <form
        className="mns-chat__composer"
        onSubmit={(e) => {
          e.preventDefault()
          void doSend(input)
        }}
      >
        {/* One rounded panel, input on top, actions tucked inside —
            the shape every modern chat has trained thumbs for. */}
        <div className="mns-chat__box">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setMicNote(null)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void doSend(input)
              }
            }}
            rows={2}
            placeholder={listening ? 'Listening…' : placeholder}
            className="mns-chat__input"
          />
          <div className="mns-chat__actions">
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
            <button type="submit" className="mns-chat__btn mns-chat__btn--primary mns-chat__btn--send" aria-label="Send" disabled={busy || !input.trim()}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m22 2-7 20-4-9-9-4Z" />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
