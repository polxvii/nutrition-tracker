import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Log', icon: '🍽️', end: true },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/weight', label: 'Progress', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function BottomNav() {
  return (
    <nav className="shrink-0 border-t border-white/[0.06] bg-slate-950 safe-bottom">
      <div className="grid grid-cols-4">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                isActive ? 'text-green-400' : 'text-slate-500 hover:text-slate-300'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 h-0.5 w-8 rounded-full bg-green-400" />
                )}
                <span className={`text-xl leading-none transition ${isActive ? '' : 'opacity-80'}`}>
                  {t.icon}
                </span>
                <span>{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
