import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Button, Card } from '../components/ui'

export default function Onboarding() {
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState(profileToForm(null))
  const [targets, setTargets] = useState(null) // editable goal_calories + macros
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = isFormValid(values)
  const calc = useMemo(() => (valid ? targetsFromForm(values) : null), [values, valid])

  // Seed / refresh editable targets from the calculation until the user edits.
  useEffect(() => {
    if (calc && !dirty) setTargets(pickEditableTargets(calc))
  }, [calc, dirty])

  const canSave =
    valid && targets && Number(targets.goal_calories) > 0 && macroSplitOk(targets)

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    const merged = { bmr: calc.bmr, tdee: calc.tdee, ...targets }
    const payload = buildProfilePayload(user.id, user.email, values, merged)
    const { error } = await supabase.from('profiles').upsert(payload)
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    await refreshProfile()
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <div className="pt-6">
        <h1 className="text-2xl font-bold text-white">Get started 🎯</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your body info and goal. Targets are calculated automatically —
          tweak the calories or macros below if you want, then confirm.
        </p>
      </div>

      <Card>
        <ProfileFields values={values} onChange={setValues} />
      </Card>

      {targets ? (
        <TargetsEditor
          targets={targets}
          calc={calc}
          onChange={(t) => {
            setTargets(t)
            setDirty(true)
          }}
          onReset={() => setDirty(false)}
        />
      ) : (
        <Card>
          <p className="text-sm text-slate-400">
            Fill in age / weight / height to see your targets
          </p>
        </Card>
      )}

      {targets && !macroSplitOk(targets) && (
        <p className="text-sm text-red-400">
          Protein + carbs + fat must total 100% before saving.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button className="w-full" disabled={!canSave || busy} onClick={save}>
        {busy ? 'Saving…' : 'Confirm & start'}
      </Button>
    </div>
  )
}
