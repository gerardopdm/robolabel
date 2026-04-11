import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/client'

export default function ProjectNewPage() {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { data } = await api.post<{ id: number }>('/projects/', { name, description })
      nav(`/projects/${data.id}`)
    } catch {
      setError('No se pudo crear el proyecto')
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/projects" className="text-sm text-sky-600 hover:underline">
        ← Volver
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-800">Nuevo proyecto</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-sky-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-sky-500"
            rows={3}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-white hover:bg-sky-700">
          Crear
        </button>
      </form>
    </div>
  )
}
