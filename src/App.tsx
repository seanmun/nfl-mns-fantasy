import { Route, Routes } from 'react-router-dom'
import { SignIn, SignUp } from '@clerk/clerk-react'
import { AppShell } from '@/components/layout/AppShell'
import { Home } from '@/pages/Home'
import { RulesPreview } from '@/pages/RulesPreview'
import { NotFound } from '@/pages/NotFound'
import { PoolPicks } from '@/pages/PoolPicks'
import { PoolWeekAdmin } from '@/pages/PoolWeekAdmin'
import { CreatePool } from '@/pages/CreatePool'
import { JoinPool } from '@/pages/JoinPool'
import { MyPools } from '@/pages/MyPools'

// Routing is intentionally shallow. Members reach everything from their
// pool page; there is no nested navigation to get lost in.
export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Renders the generated rules against a real pool config while
            the pool API is still being built. */}
        <Route path="/rules-preview" element={<RulesPreview />} />
        <Route path="/dashboard" element={<MyPools />} />
        <Route path="/create" element={<CreatePool />} />
        <Route path="/join" element={<JoinPool />} />
        <Route path="/pool/:id/picks" element={<PoolPicks />} />
        {/* Manager tools live under /lm, matching the wnba app. */}
        <Route path="/lm/:id/week" element={<PoolWeekAdmin />} />
        <Route
          path="/sign-in/*"
          element={
            <div className="flex justify-center py-12 px-4">
              <SignIn routing="path" path="/sign-in" />
            </div>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <div className="flex justify-center py-12 px-4">
              <SignUp routing="path" path="/sign-up" />
            </div>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  )
}
