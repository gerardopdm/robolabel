import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { normalizeHex, pickDistinctColor } from '../utils/labelColors'

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
  const canEdit = Boolean(user?.is_administrador || user?.is_asignador)

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

  function hexForColorInput(hex: string): string {
    const n = normalizeHex(hex.trim())
    return /^#[0-9a-f]{6}$/.test(n) ? n : '#808080'
  }

  async function updateClassColor(classId: number, newHex: string) {
    if (!projectId) return
    try {
      await api.patch(`/projects/${projectId}/classes/${classId}/`, { color_hex: newHex })
      load()
    } catch {
      alert('No se pudo actualizar el color. Inténtalo de nuevo.')
      load()
    }
  }

  const totalAnnotations = items.reduce((sum, c) => sum + (c.annotation_count ?? 0), 0)

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
      {items.length > 0 && (
        <p className="mt-6 max-w-4xl text-sm text-slate-500">
          Cada barra muestra la proporción de anotaciones de esa clase respecto al total del proyecto (
          <span className="font-medium text-slate-600 tabular-nums">{totalAnnotations}</span> en total).
        </p>
      )}
      <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((c) => {
          const count = c.annotation_count ?? 0
          const pct = totalAnnotations > 0 ? (count / totalAnnotations) * 100 : 0
          const pctLabel = totalAnnotations > 0 ? pct.toFixed(1) : '0'
          return (
            <li
              key={c.id}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              role="group"
              aria-label={`Clase ${c.name}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {canEdit ? (
                    <label className="mt-0.5 shrink-0">
                      <span className="sr-only">Color de la clase {c.name}</span>
                      <input
                        type="color"
                        value={hexForColorInput(c.color_hex)}
                        onChange={(e) => updateClassColor(c.id, e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-slate-200 bg-white p-0.5 shadow-inner"
                        title="Cambiar color"
                      />
                    </label>
                  ) : (
                    <span
                      className="mt-0.5 h-10 w-10 shrink-0 rounded-lg shadow-inner ring-1 ring-black/5"
                      style={{ backgroundColor: c.color_hex }}
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-base font-semibold text-slate-800">{c.name}</span>
                      <span className="text-xs text-slate-400">orden {c.sort_index}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="tabular-nums font-medium text-slate-700">{count}</span>
                      <span className="text-slate-500">
                        {' '}
                        {count === 1 ? 'anotación' : 'anotaciones'}
                        {totalAnnotations > 0 && (
                          <>
                            {' '}
                            · <span className="tabular-nums">{pctLabel}%</span> del total
                          </>
                        )}
                      </span>
                    </p>
                    <div className="mt-3">
                      <div
                        className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(pct * 10) / 10}
                        aria-label={`${pctLabel} por ciento de todas las anotaciones`}
                      >
                        <div
                          className="h-full min-w-0 rounded-full transition-[width] duration-500 ease-out"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: c.color_hex,
                            minWidth: count > 0 && pct > 0 && pct < 1 ? '4px' : count > 0 ? undefined : 0,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="shrink-0 self-end text-sm font-medium text-red-600 transition-colors hover:text-red-700 sm:self-start"
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
