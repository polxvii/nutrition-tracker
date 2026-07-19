import { useState } from 'react'
import { supabase, setRememberMe } from '../lib/supabase'
import { Button, Card, Field, Input } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    setRememberMe(remember) // decide storage before the session is written
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          setInfo(
            'Account created! If email confirmation is enabled, check your inbox before signing in.'
          )
          setMode('signin')
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <div className="text-5xl">🥗</div>
        <h1 className="mt-2 text-2xl font-bold text-white">Nutrition Tracker</h1>
      </div>

      <Card className="space-y-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="at least 6 characters"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-green-500"
            />
            Remember me
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-green-400">{info}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </Button>
        </form>

        <button
          type="button"
          className="w-full text-center text-sm text-slate-400 hover:text-slate-200"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setInfo(null)
          }}
        >
          {mode === 'signin'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>
      </Card>
    </div>
  )
}
