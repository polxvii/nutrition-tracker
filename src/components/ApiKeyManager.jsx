import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { addApiKey } from '../lib/analyzeApi'
import { Button, Collapsible, Field, Input } from './ui'

// Per-role cap (spec §2). Backed up by the DB trigger — this is just UX.
const KEY_LIMITS = { user: 1, admin: 10 }

const STATUS = {
  active: { label: 'Active', cls: 'text-green-400' },
  exhausted: { label: 'Daily limit reached', cls: 'text-amber-400' },
  invalid: { label: 'Invalid — please re-add', cls: 'text-red-400' },
}

function Onboarding() {
  return (
    <div className="space-y-2 rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">
      <p className="text-slate-300">Get a free Gemini API key (takes a minute):</p>
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          Open{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-green-400 underline"
          >
            aistudio.google.com/apikey
          </a>{' '}
          and sign in with a Google account.
        </li>
        <li>Accept the terms if asked — Google auto-creates a “Default Gemini Project”.</li>
        <li>A key is usually already listed — just copy it. (If not, click “Create API key”.)</li>
        <li>Check the Billing tier shows “Free tier” — no credit card needed.</li>
        <li>Paste it below.</li>
      </ol>
      <p className="text-amber-300/80">
        Privacy: on Google's free tier, submitted content may be used to improve Google's products
        and can be reviewed by humans. Avoid highly sensitive details, or use a paid key for stronger
        privacy. Adding extra free keys from other Google accounts can violate Google's terms.
      </p>
    </div>
  )
}

export default function ApiKeyManager() {
  const { profile } = useAuth()
  const role = profile?.role === 'admin' ? 'admin' : 'user'
  const limit = KEY_LIMITS[role]

  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('user_api_keys')
      .select('id,key_last4,key_label,status,last_used_at,created_at')
      .order('created_at', { ascending: true })
    setKeys(data ?? [])
    if ((data ?? []).length === 0) setShowAdd(true) // first-timer → open the form
    setLoading(false)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const atLimit = keys.length >= limit

  async function submitKey() {
    const k = keyInput.trim()
    if (!k) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const r = await addApiKey(k, label)
      setKeyInput('')
      setLabel('')
      setShowAdd(false)
      setOk(
        r.status === 'exhausted'
          ? "Key added — but its free daily quota is already used up (resets at midnight US Pacific)."
          : 'Key added ✓ AI is ready.'
      )
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Remove this key? AI analysis will stop working until you add one.')) return
    setKeys((prev) => prev.filter((k) => k.id !== id))
    setOk(null)
    await supabase.from('user_api_keys').delete().eq('id', id)
    load()
  }

  return (
    <Collapsible
      title="🤖 AI — your Gemini key"
      subtitle="Your own free Gemini key powers AI meal analysis"
      right={<span className="text-xs text-slate-500">{keys.length}/{limit}</span>}
    >
      <p className="text-xs text-slate-500">
        AI meal analysis runs on your own free Gemini key, on your quota. Your key is encrypted and
        used only on the server — never shared.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        keys.length > 0 && (
          <div className="space-y-2">
            {keys.map((k) => {
              const s = STATUS[k.status] || STATUS.active
              return (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-white">
                      {k.key_label || 'Gemini key'}{' '}
                      <span className="text-slate-500">····{k.key_last4}</span>
                    </div>
                    <div className={`text-xs ${s.cls}`}>
                      {s.label}
                      {k.last_used_at
                        ? ` · used ${new Date(k.last_used_at).toLocaleDateString()}`
                        : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(k.id)}
                    className="px-2 text-slate-500 hover:text-red-400"
                    aria-label="Remove key"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )
      )}

      {!loading && keys.length === 0 && !showAdd && <Onboarding />}

      {showAdd ? (
        <div className="space-y-2">
          {keys.length === 0 && <Onboarding />}
          <Field label="Gemini API key">
            <Input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIza… or AQ.Ab…"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Label (optional)">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. my key"
            />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={submitKey} disabled={busy || !keyInput.trim()}>
              {busy ? 'Validating…' : 'Validate & save'}
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : atLimit ? (
        <p className="text-xs text-slate-500">
          You're at your key limit ({limit}). Remove one to add another.
        </p>
      ) : (
        <Button
          variant="ghost"
          className="w-full text-sm"
          onClick={() => {
            setShowAdd(true)
            setError(null)
            setOk(null)
          }}
        >
          ＋ Add key
        </Button>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {ok && <p className="text-sm text-green-400">{ok}</p>}
    </Collapsible>
  )
}
