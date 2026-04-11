import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'

export default function ProjectEditPage() {
  const { projectId } = useParams()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!projectId) return
    api.get(`/projects/${projectId}/`).then((r) => {
      setName(r.data.name)
      setDescription(r.data.description ?? '')
    })
  }, [projectId])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await api.patch(`/projects/${projectId}/`, { name, description })
    nav(`/projects/${projectId}`)
  }

  async function onDelete() {
    if (!confirm('¿Archivar este proyecto?')) return
    await api.delete(`/projects/${projectId}/`)
    nav('/projects')
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link to={`/projects/${projectId}`} className="text-sm text-sky-600 hover:underline">
        ← Volver
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Editar proyecto</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border bg-white p-6">
        <div>
          <label className="block text-sm font-medium">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
            rows={3}
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-white">
            Guardar
          </button>
          <button type="button" onClick={onDelete} className="rounded-lg border border-red-200 px-4 py-2 text-red-600">
            Archivar
          </button>
        </div>
      </form>
    </div>
  )
}
