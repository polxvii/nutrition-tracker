import { useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  profileToForm,
  isFormValid,
  targetsFromForm,
  buildProfilePayload,
} from '../lib/nutrition'
import ProfileFields from '../components/ProfileFields'
import TargetsPreview from '../components/TargetsPreview'
import { Button, Card } from '../components/ui'

export default function Settings() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [values, setValues] = useState(profileToForm(profile))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const valid = isFormValid(values)
  const targets = useMemo(
    () => (valid ? targetsFromForm(values) : null),
    [values, valid]
  )

  async function save() {
    if (!valid || !targets) return
    setBusy(true)
    setSaved(false)
    setError(null)
    const payload = buildProfilePayload(user.id, user.email, values, targets)
    const { error } = await supabase.from('profiles').upsert(payload)
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
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

      <Card>
        <p className="mb-3 text-sm text-slate-300">
          Edit your body info / goal, then save to recalculate your macros.
        </p>
        <ProfileFields values={values} onChange={setValues} />
      </Card>

      {targets && <TargetsPreview targets={targets} />}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && <p className="text-sm text-green-400">Saved and recalculated ✓</p>}

      <Button
        className="w-full"
        disabled={!valid || busy}
        onClick={() => {
          setSaved(false)
          save()
        }}
      >
        {busy ? 'Saving…' : 'Save & recalculate macros'}
      </Button>
    </div>
  )
}
