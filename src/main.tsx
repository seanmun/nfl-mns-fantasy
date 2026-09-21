import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import { initTheme } from './ui/theme'
import './index.css'

// Stamp the remembered theme before React mounts — after would flash
// the wrong palette on every load for anyone who has toggled.
initTheme()

// This throw is why a wrong Clerk key looks like a blank black page
// rather than an error: it fires before React mounts. If you are staring
// at nothing, check .env.local for pk_test_ keys first.
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!publishableKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: true },
  },
})

// Clerk's screens, in this pool's words.
//
// The beta's real failure: members who signed up with Google or an
// emailed code came back, typed a password they never set, and never
// noticed "Use another method" — it reads as fine print. Clerk shows
// one method at a time by design and neither its prebuilt component nor
// Elements can put them all on one screen, so the fix here is wording
// and weight: say on the FIRST screen that a password may not be
// theirs, and make every alternative read as a button that says what it
// does. Verified against the live instance 2026-09-21: email_code and
// email_link are both enabled first factors, so these screens do exist.
const localization = {
  signIn: {
    start: {
      subtitle:
        'Signed up with Google or an emailed code? Use that — you may not have a password.',
    },
    password: {
      subtitle: 'No password? You can have one emailed to you instead.',
      actionLink: 'No password? Email me a code',
    },
    alternativeMethods: {
      title: 'Another way in',
      subtitle: 'Pick one and we’ll email you right now.',
      blockButton__emailCode: 'Email a code to {{identifier}}',
      blockButton__emailLink: 'Email a sign-in link to {{identifier}}',
      blockButton__password: 'Type my password instead',
    },
    forgotPasswordAlternativeMethods: {
      label__alternativeMethods: 'Or sign in without a password',
    },
  },
  formFieldLabel__password: 'Password (only if you set one)',
  formFieldAction__forgotPassword: 'Forgot it? Email me a code',
}

// Alternatives get the size of a real button, in this app's own styles
// (mns-ui classes), instead of a link at the bottom of the card.
// Only the two places that carry the way out: the list of alternatives,
// and the action beside the password field. Clerk keeps its own styling
// everywhere else — including the Google button, whose icon-and-label
// layout is not ours to second-guess.
const appearance = {
  elements: {
    alternativeMethodsBlockButton: 'mns-btn mns-btn--quiet mns-btn--full',
    formFieldAction: 'mns-btn mns-btn--ghost',
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      afterSignOutUrl="/"
      localization={localization}
      appearance={appearance}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: 'var(--color-card)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-foreground)',
                fontSize: '1rem',
              },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>
)
