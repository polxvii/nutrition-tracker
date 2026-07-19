import { Field, Input, Select } from './ui'
import { ACTIVITY_LABELS, GOAL_LABELS } from '../lib/nutrition'

// Controlled set of body + goal inputs. `values` is the form object from
// nutrition.profileToForm(); `onChange` receives the whole updated object.
export default function ProfileFields({ values, onChange }) {
  const set = (key) => (e) => onChange({ ...values, [key]: e.target.value })
  const showRate = values.goal_type === 'cut' || values.goal_type === 'bulk'

  const rateOptions =
    values.goal_type === 'cut'
      ? [
          ['slow', 'Slow (−15%)'],
          ['medium', 'Medium (−20%)'],
          ['fast', 'Fast (−25%)'],
        ]
      : [
          ['slow', 'Slow (+5%)'],
          ['medium', 'Medium (+10%)'],
          ['fast', 'Fast (+15%)'],
        ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Age (years)">
          <Input
            type="number"
            inputMode="numeric"
            value={values.age}
            onChange={set('age')}
            placeholder="30"
          />
        </Field>
        <Field label="Sex">
          <Select value={values.sex} onChange={set('sex')}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </Select>
        </Field>
        <Field label="Weight (kg)">
          <Input
            type="number"
            inputMode="decimal"
            value={values.weight_kg}
            onChange={set('weight_kg')}
            placeholder="70"
          />
        </Field>
        <Field label="Height (cm)">
          <Input
            type="number"
            inputMode="decimal"
            value={values.height_cm}
            onChange={set('height_cm')}
            placeholder="175"
          />
        </Field>
      </div>

      <Field
        label="Body fat %"
        hint="Optional — if known, uses the more accurate Katch-McArdle formula"
      >
        <Input
          type="number"
          inputMode="decimal"
          value={values.body_fat_pct}
          onChange={set('body_fat_pct')}
          placeholder="e.g. 18"
        />
      </Field>

      <Field label="Activity level">
        <Select value={values.activity_level} onChange={set('activity_level')}>
          {Object.entries(ACTIVITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Goal">
        <Select value={values.goal_type} onChange={set('goal_type')}>
          {Object.entries(GOAL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>

      {showRate && (
        <Field label="Rate">
          <Select value={values.goal_rate} onChange={set('goal_rate')}>
            {rateOptions.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  )
}
