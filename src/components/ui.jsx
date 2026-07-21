// Small shared UI primitives so pages stay consistent and short.

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-2xl bg-slate-900 p-4 ${className}`}>{children}</div>
  )
}

const buttonStyles = {
  primary: 'bg-green-600 text-white hover:bg-green-500 active:bg-green-700',
  ghost: 'bg-slate-800 text-slate-200 hover:bg-slate-700',
  danger: 'bg-red-600/90 text-white hover:bg-red-500',
}

export function Button({ variant = 'primary', className = '', ...props }) {
  return (
    <button
      className={`rounded-xl px-4 py-2.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, hint, children }) {
  return (
    <div>
      {label && (
        <label className="mb-1 block text-sm text-slate-300">{label}</label>
      )}
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none focus:border-green-500'

export function Input({ className = '', ...props }) {
  return <input className={`${inputCls} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${inputCls} ${className}`} {...props}>
      {children}
    </select>
  )
}

// Pulsing placeholder shown while data loads (nicer than a "Loading…" flash).
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-slate-800 ${className}`} />
}
