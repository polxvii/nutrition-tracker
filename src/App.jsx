import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Today from './pages/Today'
import Weight from './pages/Weight'
import Settings from './pages/Settings'
import BottomNav from './components/BottomNav'

function FullScreen({ children }) {
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      {children}
    </div>
  )
}

// Onboarding is "done" once we have a computed calorie target stored.
function isProfileComplete(profile) {
  return !!profile && profile.goal_calories != null
}

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) return <FullScreen>Loading…</FullScreen>

  // Not signed in → only the login screen is reachable.
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Signed in but hasn't finished onboarding → force onboarding.
  if (!isProfileComplete(profile)) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    )
  }

  // Main app shell (mobile-first, capped width, bottom nav).
  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto pb-24">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/weight" element={<Weight />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/onboarding" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}
