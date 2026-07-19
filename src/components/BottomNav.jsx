import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Today', icon: '🍽️', end: true },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/weight', label: 'Weight', icon: '⚖️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-slate-800 bg-slate-900/95 backdrop-blur safe-bottom">
      <div className="grid grid-cols-4">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 text-xs transition ${
                isActive ? 'text-green-400' : 'text-slate-400'
              }`
            }
          >
            <span className="text-xl leading-none">{t.icon}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
