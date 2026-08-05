import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  profileToForm,
  isFormValid,
  targetsFromForm,
  buildProfilePayload,
  pickEditableTargets,
  macroSplitOk,
} from '../lib/nutrition'
import ProfileFields from '../components/ProfileFields'
import TargetsEditor from '../components/TargetsEditor'
import ApiKeyManager from '../components/ApiKeyManager'
import MealWindowsCard from '../components/MealWindowsCard'
import GoalHistoryCard from '../components/GoalHistoryCard'
import { Button, Collapsible } from '../components/ui'
import { recordGoalHistory } from '../lib/goalHistory'

export default function Settings() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [values, setValues] = useState(profileToForm(profile))
  // Start from the SAVED targets (dirty=true keeps body edits from clobbering
  // them; "Reset to calculated" recomputes from the body fields).
  const [targets, setTargets] = useState({
    goal_calories: profile?.goal_calories ?? '',
    protein_g: profile?.goal_protein_g ?? '',
    carbs_g: profile?.goal_carbs_g ?? '',
    fat_g: profile?.goal_fat_g ?? '',
  })
  const [dirty, setDirty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const valid = isFormValid(values)
  const calc = useMemo(() => (valid ? targetsFromForm(values) : null), [values, valid])

  useEffect(() => {
    if (calc && !dirty) setTargets(pickEditableTargets(calc))
  }, [calc, dirty])

  const canSave =
    valid && targets && Number(targets.goal_calories) > 0 && macroSplitOk(targets)

  async function save() {
    if (!canSave) return
    setBusy(true)
    setSaved(false)
    setError(null)
    const merged = { bmr: calc.bmr, tdee: calc.tdee, ...targets }
    const payload = buildProfilePayload(user.id, user.email, values, merged)
    const { error } = await supabase.from('profiles').upsert(payload)
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    await recordGoalHistory(user.id, payload) // snapshot today's goal for history
    await refreshProfile()
    setBusy(false)
    setSaved(true)
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header className="flex items-center justify-between pt-4">
        <div>
          <h1 className="text-xl font-bold text-white">Settings ⚙️</h1>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <Collapsible title="🧍 Body info" subtitle="Age, weight, height, activity & goal type">
        <p className="text-xs text-slate-500">
          Edit your body info, then “Reset to calculated” in Targets to recompute.
        </p>
        <ProfileFields values={values} onChange={setValues} />
      </Collapsible>

      <Collapsible title="🎯 Targets" subtitle="Calorie goal & macro split">
        <TargetsEditor
          bare
          targets={targets}
          calc={calc}
          onChange={(t) => {
            setTargets(t)
            setDirty(true)
            setSaved(false)
          }}
          onReset={() => setDirty(false)}
        />

        {targets && !macroSplitOk(targets) && (
          <p className="text-sm text-red-400">
            Protein + carbs + fat must total 100% before saving.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-green-400">Saved ✓</p>}

        <Button className="w-full" disabled={!canSave || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save targets'}
        </Button>
      </Collapsible>

      <GoalHistoryCard />

      <MealWindowsCard />

      <ApiKeyManager />
    </div>
  )
}
