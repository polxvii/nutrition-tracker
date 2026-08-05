// Small shared UI primitives so pages stay consistent and short.

import { useState } from 'react'

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-slate-900 p-4 ${className}`}>
      {children}
    </div>
  )
}

// Card with a tap-to-toggle header (title + optional subtitle / right node).
// Collapsed by default so a long Settings page stays compact as lists grow.
export function Collapsible({ title, subtitle, right, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-200">{title}</div>
          {subtitle && <div className="truncate text-xs text-slate-500">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  )
}

const buttonStyles = {
  primary:
    'bg-gradient-to-b from-green-500 to-green-600 text-white shadow-lg shadow-green-900/30 hover:from-green-400 hover:to-green-500',
  ghost: 'bg-slate-800 text-slate-200 hover:bg-slate-700',
  danger: 'bg-red-600/90 text-white hover:bg-red-500',
}

export function Button({ variant = 'primary', className = '', ...props }) {
  return (
    <button
      className={`rounded-xl px-4 py-2.5 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
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
