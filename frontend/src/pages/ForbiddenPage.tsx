import { Link } from 'react-router-dom'

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
      <h1 className="text-2xl font-bold text-slate-800">403 — Sin permiso</h1>
      <Link to="/projects" className="mt-6 text-sky-600 hover:underline">
        Volver a proyectos
      </Link>
    </div>
  )
}
