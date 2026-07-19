import { useState } from 'react'
import { Button, Field, Input } from './ui'

export default function ExerciseForm({ onSubmit, onCancel, busy }) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!name.trim() || !(Number(kcal) > 0)) return
    onSubmit({ name: name.trim(), calories: Number(kcal) })
    setName('')
    setKcal('')
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Exercise">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Running, Gym, Walk"
          autoFocus
        />
      </Field>
      <Field label="Calories burned (kcal)">
        <Input
          type="number"
          inputMode="decimal"
          value={kcal}
          onChange={(e) => setKcal(e.target.value)}
          placeholder="250"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy ? 'Adding…' : 'Add exercise'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
