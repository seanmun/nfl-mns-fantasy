import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RedirectToSignIn, SignIn, SignUp, SignedIn, SignedOut, useUser } from '@clerk/clerk-react'
import { AppShell } from '@/components/layout/AppShell'
import { Home as Landing } from '@/pages/Home'
import { MyPools } from '@/pages/MyPools'
import { CreatePool } from '@/pages/CreatePool'
import { JoinPool } from '@/pages/JoinPool'
import { PoolHome } from '@/pages/PoolHome'
import { PoolPicks } from '@/pages/PoolPicks'
import { PoolWeekAdmin } from '@/pages/PoolWeekAdmin'
import { RulesPreview } from '@/pages/RulesPreview'
import { NotFound } from '@/pages/NotFound'

// Auth is the platform's, not this app's: one Clerk instance, one
// publishable key, a plain ClerkProvider in main.tsx with no satellite,
// domain or proxy config — same as golf and the hub. The session is
// shared across subdomains by the cookie on .mnsfantasy.com, so nothing
// is registered per-subdomain. Each app renders its own /sign-in.

function ProtectedRoute({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}

// Signed-in users get their pools as the home page; everyone else sees
// the landing. Rendered rather than redirected so the URL stays "/", and
// gated on isLoaded so neither flashes before Clerk resolves.
function HomeRoute() {
  const { isLoaded, isSignedIn } = useUser()
  if (!isLoaded) return null
  return isSignedIn ? <MyPools /> : <Landing />
}

function AuthPage({ children }: { children: ReactNode }) {
  return <div className="flex justify-center py-12 px-4">{children}</div>
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomeRoute />} />

        <Route
          path="/sign-in/*"
          element={
            <AuthPage>
              <SignIn
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                fallbackRedirectUrl="/dashboard"
              />
            </AuthPage>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <AuthPage>
              <SignUp
                routing="path"
                path="/sign-up"
                signInUrl="/sign-in"
                fallbackRedirectUrl="/dashboard"
              />
            </AuthPage>
          }
        />

        {/* Public on purpose, following golf's join route: an invite has
            to show what you were invited to BEFORE asking you to sign in,
            or the link is a bounce for anyone without an account yet. */}
        <Route path="/join" element={<JoinPool />} />

        <Route path="/dashboard" element={<ProtectedRoute><MyPools /></ProtectedRoute>} />
        <Route path="/create" element={<ProtectedRoute><CreatePool /></ProtectedRoute>} />
        <Route path="/pool/:id" element={<ProtectedRoute><PoolHome /></ProtectedRoute>} />
        <Route path="/pool/:id/picks" element={<ProtectedRoute><PoolPicks /></ProtectedRoute>} />
        {/* Manager tools live under /lm, matching wnba. */}
        <Route path="/lm/:id/week" element={<ProtectedRoute><PoolWeekAdmin /></ProtectedRoute>} />

        <Route path="/rules-preview" element={<RulesPreview />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  )
}
