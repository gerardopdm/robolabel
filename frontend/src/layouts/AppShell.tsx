import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const nav = [
  { to: '/projects', label: 'Proyectos' },
]

export default function AppShell() {
  const { user, logout } = useAuth()
  const loc = useLocation()
  const hideSidebar = loc.pathname.includes('/annotate/')

  return (
    <div className="flex min-h-screen">
      {!hideSidebar && (
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-sky-100">
          <div className="p-4">
            <Link to="/projects" className="text-lg font-bold text-slate-800">
              RoboLabel
            </Link>
            <p className="mt-1 text-xs text-slate-500">{user?.company.name}</p>
          </div>
          <nav className="space-y-1 px-2">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  loc.pathname.startsWith(item.to)
                    ? 'border-l-4 border-sky-500 bg-sky-200/20 text-sky-800'
                    : 'text-slate-700 hover:bg-sky-200/20'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
      )}
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="text-sm text-slate-600">{user?.email}</div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cerrar sesión
          </button>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
