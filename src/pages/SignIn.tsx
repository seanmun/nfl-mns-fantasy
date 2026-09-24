import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useSignIn, useUser } from '@clerk/clerk-react'
import { isClerkAPIResponseError } from '@clerk/clerk-react/errors'
import { Banner, Button, Field } from '@/ui/components'

// Our own sign-in screen, on Clerk's API, because Clerk's prebuilt one
// shows a member one method at a time and this pool's members were
// getting stuck: people who signed up with Google or an emailed code
// came back, saw a password box, typed a password they never set, and
// never found the small "use another method" link under it.
//
// The whole point of this screen is that nothing is hidden. Email,
// password, and a full-size "Email me a code" button all sit on the
// first screen, in this app's own theme so both modes are legible, and
// every failure names the way out in plain words instead of blocking.
//
// Sign-up stays Clerk's — it is not where anyone was getting lost.

type Stage = 'form' | 'code'

const GOOGLE_CALLBACK = '/sso-callback'

// Where to land after signing in. Clerk's own components and the join
// page both pass `redirect_url`; only a same-origin path is honoured.
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/dashboard'
}

// Clerk's error codes, in words a member can act on. Anything unknown
// falls back to Clerk's own long message rather than a shrug.
function explain(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    const first = err.errors[0]
    switch (first?.code) {
      case 'form_identifier_not_found':
        return "We can't find an account for that. Check the spelling, or sign up below."
      case 'form_password_incorrect':
        return "That password isn't right. No password? Tap Email me a code."
      case 'strategy_for_user_invalid':
      case 'form_password_pwned':
        return 'This account signs in by email — tap Email me a code.'
      case 'form_code_incorrect':
        return "That code isn't right. Check the email and try again."
      case 'verification_expired':
        return 'That code has expired. Tap Send a new code.'
      case 'too_many_requests':
        return 'Too many tries in a row. Wait a minute, then try again.'
      default:
        return first?.longMessage ?? first?.message ?? 'Something went wrong. Try again.'
    }
  }
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.'
}

export function SignIn() {
  const { isLoaded, signIn, setActive } = useSignIn()
  const { isSignedIn } = useUser()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get('redirect_url'))

  const [stage, setStage] = useState<Stage>('form')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  // Where the code went, as Clerk masks it: "g•••@gmail.com".
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState<'password' | 'code' | 'verify' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Already in — a stale link or a back button. Just go.
  useEffect(() => {
    if (isSignedIn) navigate(redirect, { replace: true })
  }, [isSignedIn, navigate, redirect])

  const finish = async (sessionId: string | null) => {
    if (!sessionId || !setActive) {
      throw new Error('Signed in, but no session came back. Try again.')
    }
    await setActive({ session: sessionId })
    navigate(redirect, { replace: true })
  }

  // ── Password ──────────────────────────────────────────────────
  const withPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!isLoaded || !signIn) return
    setError(null)
    setBusy('password')
    try {
      const res = await signIn.create({
        strategy: 'password',
        identifier: identifier.trim(),
        password,
      })
      if (res.status === 'complete') return await finish(res.createdSessionId)
      // A second step this screen does not carry (the instance has none
      // enabled). Point at the way that always works rather than stall.
      setError('This account needs a step we can’t do here. Tap Email me a code instead.')
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(null)
    }
  }

  // ── Email me a code ───────────────────────────────────────────
  const sendCode = async () => {
    if (!isLoaded || !signIn) return
    const who = identifier.trim()
    if (!who) {
      setError('Type your email address first, then tap Email me a code.')
      return
    }
    setError(null)
    setBusy('code')
    try {
      const res = await signIn.create({ identifier: who })
      const factor = res.supportedFirstFactors?.find((f) => f.strategy === 'email_code')
      if (!factor || factor.strategy !== 'email_code') {
        setError('We have no email on file for that account. Try your email address instead.')
        return
      }
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: factor.emailAddressId,
      })
      setSentTo(factor.safeIdentifier)
      setCode('')
      setStage('code')
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(null)
    }
  }

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!isLoaded || !signIn) return
    setError(null)
    setBusy('verify')
    try {
      const res = await signIn.attemptFirstFactor({ strategy: 'email_code', code: code.trim() })
      if (res.status === 'complete') return await finish(res.createdSessionId)
      setError('That code went through but sign-in did not finish. Tap Send a new code.')
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(null)
    }
  }

  // ── Google ────────────────────────────────────────────────────
  const withGoogle = async () => {
    if (!isLoaded || !signIn) return
    setError(null)
    setBusy('google')
    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: GOOGLE_CALLBACK,
        redirectUrlComplete: redirect,
      })
    } catch (err) {
      setError(explain(err))
      setBusy(null)
    }
  }

  const signUpHref = `/sign-up?redirect_url=${encodeURIComponent(redirect)}`

  return (
    <div className="px-4 py-8 flex flex-col gap-6 max-w-md mx-auto w-full">
      <div>
        <h1 className="text-[1.7rem] font-extrabold leading-tight">Sign in</h1>
        {stage === 'form' ? (
          <p className="mt-1 text-[var(--color-muted-foreground)]">
            Type your email, then pick whichever way in you use.
          </p>
        ) : null}
      </div>

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {stage === 'form' ? (
        <>
          <Button variant="quiet" full onClick={withGoogle} disabled={!isLoaded || busy != null}>
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </Button>

          <p className="text-center text-[0.85rem] font-bold tracking-[0.14em] uppercase text-[var(--color-muted-foreground)]">
            or
          </p>

          <form onSubmit={withPassword} className="flex flex-col gap-4">
            <Field label="Email address or username" htmlFor="si-identifier">
              <input
                id="si-identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mns-input"
              />
            </Field>

            <Field
              label="Password"
              hint="Only if you set one. Signed up with Google or a code? Skip this."
              htmlFor="si-password"
            >
              <input
                id="si-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mns-input"
              />
            </Field>

            <Button
              type="submit"
              full
              disabled={!isLoaded || busy != null || !identifier.trim() || !password}
            >
              {busy === 'password' ? 'Signing in…' : 'Sign in with password'}
            </Button>

            {/* THE button. Same size as the one above it, never a link. */}
            <Button
              type="button"
              variant="quiet"
              full
              onClick={sendCode}
              disabled={!isLoaded || busy != null}
            >
              {busy === 'code' ? 'Sending…' : 'Email me a code'}
            </Button>
            <p className="-mt-2 text-center text-[0.9rem] text-[var(--color-muted-foreground)]">
              No password? Use this — the code comes to your email.
            </p>
          </form>
        </>
      ) : (
        <form onSubmit={verifyCode} className="flex flex-col gap-4">
          <p className="text-[1.05rem]">
            We emailed a code to <b>{sentTo}</b>. It may take a minute — check junk mail too.
          </p>
          <Field label="Type the code here" htmlFor="si-code">
            <input
              id="si-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="mns-input font-mono text-[1.3rem] tracking-[0.3em]"
            />
          </Field>
          <Button type="submit" full disabled={busy != null || code.trim().length < 4}>
            {busy === 'verify' ? 'Checking…' : 'Sign in'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="quiet" className="flex-1" onClick={sendCode} disabled={busy != null}>
              {busy === 'code' ? 'Sending…' : 'Send a new code'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStage('form')
                setError(null)
              }}
              disabled={busy != null}
            >
              Back
            </Button>
          </div>
        </form>
      )}

      <p className="text-center text-[var(--color-muted-foreground)]">
        Don&rsquo;t have an account?{' '}
        <Link to={signUpHref} className="font-bold text-[var(--color-accent)]">
          Sign up
        </Link>
      </p>
    </div>
  )
}
