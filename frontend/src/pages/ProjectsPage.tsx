import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'

type Project = {
  id: number
  name: string
  description: string
  task_type: string
  updated_at: string
  groups_count: number
  images_count: number
}

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<{ results: Project[] }>('/projects/')
      .then((r) => setItems(r.data.results ?? (r.data as unknown as Project[])))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-slate-500">Cargando…</p>

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-slate-500">No hay proyectos aún.</p>
        <Link
          to="/projects/new"
          className="mt-4 inline-block rounded-lg bg-sky-600 px-4 py-2 text-white hover:bg-sky-700"
        >
          Crear tu primer proyecto
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Proyectos</h1>
        <Link
          to="/projects/new"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          Nuevo proyecto
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <h2 className="font-semibold text-slate-800">{p.name}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description || '—'}</p>
            <div className="mt-3 flex gap-3 text-xs text-slate-500">
              <span>{p.groups_count} grupos</span>
              <span>{p.images_count} imágenes</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
