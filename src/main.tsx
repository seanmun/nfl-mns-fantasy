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

// Clerk's screens are Clerk's. The only thing this app adds is WORDS,
// and only where members were getting stuck: people who signed up with
// Google or an emailed code came back, typed a password they never set,
// and never noticed "Use another method". No styling and no theming —
// handing Clerk's elements our classes put white text on Clerk's white
// card in dark mode (2026-09-24), and a global label meant for sign-in
// showed up on sign-up. Clerk's own card is legible in both modes on
// its own; leave it alone.
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
  },
}

function Root() {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      afterSignOutUrl="/"
      localization={localization}
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
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
