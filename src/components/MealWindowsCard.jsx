import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { DEFAULT_MEAL_WINDOWS, MEAL_ORDER } from '../lib/mealWindows'
import { Button, Card, Field, Input } from './ui'

// Let each user set when their meals start — used to pick the default meal
// slot when logging (people eat on different schedules).
export default function MealWindowsCard() {
  const { user, profile, refreshProfile } = useAuth()
  const [w, setW] = useState({ ...DEFAULT_MEAL_WINDOWS, ...(profile?.meal_windows || {}) })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const set = (k) => (e) => {
    setW((p) => ({ ...p, [k]: e.target.value }))
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ meal_windows: w }).eq('id', user.id)
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    await refreshProfile()
    setSaved(true)
  }

  return (
    <Card className="space-y-3">
      <div>
        <span className="text-sm font-medium text-slate-200">🕒 Meal times</span>
        <p className="text-xs text-slate-500">
          When each meal starts. Used to pick the default meal when you log — each runs until the
          next begins, and Night wraps past midnight.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {MEAL_ORDER.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input type="time" value={w[k]} onChange={set(k)} />
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save meal times'}
        </Button>
        {saved && <span className="text-sm text-green-400">Saved ✓</span>}
      </div>
    </Card>
  )
}
