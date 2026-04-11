import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
      <h1 className="text-4xl font-bold text-slate-800">404</h1>
      <p className="mt-2 text-slate-600">Página no encontrada</p>
      <Link to="/projects" className="mt-6 text-sky-600 hover:underline">
        Volver a proyectos
      </Link>
    </div>
  )
}
