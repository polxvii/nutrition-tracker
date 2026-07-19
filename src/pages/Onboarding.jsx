import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export default function Onboarding() {
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState(profileToForm(null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = isFormValid(values)
  const targets = useMemo(
    () => (valid ? targetsFromForm(values) : null),
    [values, valid]
  )

  async function save() {
    if (!valid || !targets) return
    setBusy(true)
    setError(null)
    const payload = buildProfilePayload(user.id, user.email, values, targets)
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
          Enter your body info and goal — your calories and macros are
          calculated automatically. Review below and confirm.
        </p>
      </div>

      <Card>
        <ProfileFields values={values} onChange={setValues} />
      </Card>

      {targets ? (
        <TargetsPreview targets={targets} />
      ) : (
        <Card>
          <p className="text-sm text-slate-400">
            Fill in age / weight / height to see your calculated targets
          </p>
        </Card>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button className="w-full" disabled={!valid || busy} onClick={save}>
        {busy ? 'Saving…' : 'Confirm & start'}
      </Button>
    </div>
  )
}
