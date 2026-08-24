import { useState } from 'react'
import { Field, Input } from './ui'
import { alcoholGramsFromAbv } from '../lib/macros'

// Alcohol (g) input with an optional "ml × %ABV → g" calculator, so you can
// enter a drink's size + strength and let it fill the grams. `value` is the
// grams string; `onChange(v)` receives the new grams string.
export default function AlcoholField({ value, onChange }) {
  const [ml, setMl] = useState('')
  const [abv, setAbv] = useState('')
  const calc = (mlV, abvV) => {
    const g = alcoholGramsFromAbv(mlV, abvV)
    if (g > 0) onChange(String(Math.round(g * 10) / 10))
  }
  return (
    <div className="space-y-1.5">
      <Field label="Alcohol (g)" hint="Pure alcohol — 7 kcal/g.">
        <Input type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="shrink-0">or</span>
        <Input
          type="number"
          inputMode="decimal"
          value={ml}
          onChange={(e) => {
            setMl(e.target.value)
            calc(e.target.value, abv)
          }}
          placeholder="ml"
          className="w-16 px-1 text-center"
        />
        <span>×</span>
        <Input
          type="number"
          inputMode="decimal"
          value={abv}
          onChange={(e) => {
            setAbv(e.target.value)
            calc(ml, e.target.value)
          }}
          placeholder="%ABV"
          className="w-20 px-1 text-center"
        />
        <span className="shrink-0">→ g</span>
      </div>
    </div>
  )
}
