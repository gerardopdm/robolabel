import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { pickDistinctColor } from '../utils/labelColors'

type Lc = {
  id: number
  name: string
  color_hex: string
  sort_index: number
  annotation_count?: number
}

export default function ClassesPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [items, setItems] = useState<Lc[]>([])
  const [name, setName] = useState('')
  const [color, setColor] = useState(() => pickDistinctColor([]))
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  function load() {
    if (!projectId) return
    api.get(`/projects/${projectId}/classes/`).then((r) => {
      const list: Lc[] = r.data.results ?? r.data
      setItems(list)
      setColor(pickDistinctColor(list.map((c) => c.color_hex)))
    })
  }

  useEffect(() => {
    load()
  }, [projectId])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!projectId) return
    await api.post(`/projects/${projectId}/classes/`, {
      name,
      color_hex: color,
      sort_index: items.length,
    })
    setName('')
    load()
  }

  async function remove(id: number) {
    if (!confirm('¿Eliminar esta clase?')) return
    await api.delete(`/projects/${projectId}/classes/${id}/`)
    load()
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-slate-500">
        <Link to="/projects">Proyectos</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`}>Proyecto</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-800">Clases</span>
      </nav>
      <h1 className="text-2xl font-bold">Clases</h1>
      {canEdit && (
        <form onSubmit={onCreate} className="mt-4 flex max-w-xl flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-2 py-1" required />
          </div>
          <div>
            <label className="block text-xs text-slate-500">Color</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-14" />
          </div>
          <button type="submit" className="rounded-lg bg-sky-600 px-3 py-2 text-white">
            Añadir
          </button>
        </form>
      )}
      <ul className="mt-6 space-y-2">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded" style={{ backgroundColor: c.color_hex }} />
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-slate-400">sort {c.sort_index}</span>
              {c.annotation_count != null && (
                <span className="text-xs text-slate-500">{c.annotation_count} anotaciones</span>
              )}
            </div>
            {canEdit && (
              <button type="button" onClick={() => remove(c.id)} className="text-sm text-red-600">
                Eliminar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
