import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import HideGroupModal from '../components/HideGroupModal'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'

type Group = {
  id: number
  name: string
  sort_order: number
}

type GroupStatsRow = {
  id: number
  name: string
  total_images: number
  completed_images: number
  pendientes?: number
  pending_validation?: number
  validadas?: number
  images_by_class?: { id: number; name: string; color_hex: string; image_count: number }[]
  labelers?: { id: number; email: string; display_name: string }[]
}

export default function GroupsListPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [stats, setStats] = useState<{ groups: GroupStatsRow[] } | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [hideTarget, setHideTarget] = useState<{ id: number; name: string } | null>(null)
  const [hidePending, setHidePending] = useState(false)
  const canEdit = Boolean(user?.is_administrador || user?.is_asignador)

  function load() {
    if (!projectId) return
    api.get(`/projects/${projectId}/groups/`).then((r) => {
      setGroups(r.data.results ?? r.data)
    })
    api.get(`/projects/${projectId}/stats/`).then((r) => setStats(r.data))
  }

  useEffect(() => {
    load()
  }, [projectId])

  async function createGroup(e: FormEvent) {
    e.preventDefault()
    if (!projectId || !newName.trim()) return
    await api.post(`/projects/${projectId}/groups/`, { name: newName, sort_order: 0 })
    setNewName('')
    load()
  }

  function startEdit(g: Group) {
    setEditingId(g.id)
    setEditName(g.name)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
  }

  async function saveRename(e: FormEvent) {
    e.preventDefault()
    if (!projectId || editingId == null || !editName.trim()) return
    setBusyId(editingId)
    try {
      await api.patch(`/projects/${projectId}/groups/${editingId}/`, { name: editName.trim() })
      cancelEdit()
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function confirmHideGroup() {
    if (!projectId || !hideTarget) return
    setHidePending(true)
    setBusyId(hideTarget.id)
    try {
      await api.delete(`/projects/${projectId}/groups/${hideTarget.id}/`)
      setHideTarget(null)
      load()
    } finally {
      setHidePending(false)
      setBusyId(null)
    }
  }

  /** Imágenes que ya salieron de la cola del etiquetador (en validación o aprobadas). */
  function pctEtiquetado(gid: number): number {
    const row = stats?.groups.find((x) => x.id === gid)
    if (!row || !row.total_images) return 0
    const pv = row.pending_validation ?? 0
    const val = row.validadas ?? row.completed_images ?? 0
    return Math.round((100 * (pv + val)) / row.total_images)
  }

  /** Imágenes con validación completada (aprobadas). */
  function pctValidacion(gid: number): number {
    const row = stats?.groups.find((x) => x.id === gid)
    if (!row || !row.total_images) return 0
    const val = row.validadas ?? row.completed_images ?? 0
    return Math.round((100 * val) / row.total_images)
  }

  function groupRow(gid: number): GroupStatsRow | undefined {
    return stats?.groups.find((x) => x.id === gid)
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-slate-500">
        <Link to="/projects">Proyectos</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`} className="hover:text-sky-600">
          Proyecto
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-800">Grupos</span>
      </nav>
      <h1 className="text-2xl font-bold">Grupos</h1>
      {canEdit && (
        <form onSubmit={createGroup} className="mt-4 flex max-w-md gap-2">
          <input
            placeholder="Nombre del grupo"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-lg border px-3 py-2"
          />
          <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-white">
            Crear
          </button>
        </form>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div
            key={g.id}
            className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${
              editingId === g.id ? '' : 'cursor-pointer'
            }`}
          >
            {editingId === g.id ? (
              <form onSubmit={saveRename} className="space-y-2 p-4">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  autoFocus
                  disabled={busyId === g.id}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={busyId === g.id || !editName.trim()}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={busyId === g.id}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <>
                <Link
                  to={`/projects/${projectId}/groups/${g.id}`}
                  className="absolute inset-0 z-0 block rounded-xl"
                  aria-label={`Abrir grupo ${g.name}`}
                />
                <div className="relative z-10 space-y-3 p-4 pointer-events-none">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 flex-1 font-semibold text-slate-800 transition-colors group-hover:text-sky-700">
                      {g.name}
                    </h2>
                    {canEdit && (
                      <div className="pointer-events-auto flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(g)}
                          disabled={busyId != null}
                          className="rounded-lg px-2 py-1 text-xs text-sky-600 hover:bg-sky-50 disabled:opacity-50"
                        >
                          Renombrar
                        </button>
                        <button
                          type="button"
                          onClick={() => setHideTarget({ id: g.id, name: g.name })}
                          disabled={busyId != null}
                          className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Ocultar
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 space-y-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-600">Etiquetado</span>
                        <span className="tabular-nums text-slate-500">{pctEtiquetado(g.id)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full bg-sky-500 transition-all"
                          style={{ width: `${pctEtiquetado(g.id)}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Enviadas a validación o ya validadas
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-600">Validación</span>
                        <span className="tabular-nums text-slate-500">{pctValidacion(g.id)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${pctValidacion(g.id)}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">Aprobadas por validador</p>
                    </div>
                  </div>
                  {(() => {
                    const row = groupRow(g.id)
                    const pend = row?.pendientes ?? 0
                    const pv = row?.pending_validation ?? 0
                    const val = row?.validadas ?? row?.completed_images ?? 0
                    const byClass = row?.images_by_class ?? []
                    const labelers = row?.labelers ?? []
                    return (
                      <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-left">
                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div className="rounded-lg bg-amber-50 px-2 py-1.5">
                            <p className="font-medium text-amber-800">{pend}</p>
                            <p className="text-[10px] leading-tight text-amber-700/80">Pendientes</p>
                          </div>
                          <div className="rounded-lg bg-sky-50 px-2 py-1.5">
                            <p className="font-medium text-sky-800">{pv}</p>
                            <p className="text-[10px] leading-tight text-sky-700/80">Por validar</p>
                          </div>
                          <div className="rounded-lg bg-emerald-50 px-2 py-1.5">
                            <p className="font-medium text-emerald-800">{val}</p>
                            <p className="text-[10px] leading-tight text-emerald-700/80">Validadas</p>
                          </div>
                        </div>
                        {byClass.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                              Clases (imágenes con etiqueta)
                            </p>
                            <ul className="flex flex-wrap gap-1.5">
                              {byClass.map((c) => (
                                <li
                                  key={c.id}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                                >
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: c.color_hex || '#3B82F6' }}
                                    title={c.name}
                                  />
                                  <span className="max-w-[140px] truncate">{c.name}</span>
                                  <span className="tabular-nums text-slate-500">{c.image_count}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="text-xs text-slate-600">
                          <span className="font-medium text-slate-500">Etiquetación: </span>
                          {labelers.length === 0 ? (
                            <span className="text-slate-400">sin asignar</span>
                          ) : (
                            <span>{labelers.map((l) => l.display_name).join(', ')}</span>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <HideGroupModal
        open={hideTarget != null}
        groupName={hideTarget?.name ?? ''}
        variant="list"
        pending={hidePending}
        onClose={() => !hidePending && setHideTarget(null)}
        onConfirm={confirmHideGroup}
      />
    </div>
  )
}
