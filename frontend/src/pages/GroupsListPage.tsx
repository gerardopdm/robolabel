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

export default function GroupsListPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [stats, setStats] = useState<{ groups: { id: number; name: string; total_images: number; completed_images: number }[] } | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [hideTarget, setHideTarget] = useState<{ id: number; name: string } | null>(null)
  const [hidePending, setHidePending] = useState(false)
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

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

  function pct(gid: number) {
    const g = stats?.groups.find((x) => x.id === gid)
    if (!g || !g.total_images) return 0
    return Math.round((100 * g.completed_images) / g.total_images)
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
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md"
          >
            {editingId === g.id ? (
              <form onSubmit={saveRename} className="space-y-2">
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
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/projects/${projectId}/groups/${g.id}`} className="min-w-0 flex-1">
                    <h2 className="font-semibold text-slate-800 hover:text-sky-700">{g.name}</h2>
                  </Link>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
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
                <Link to={`/projects/${projectId}/groups/${g.id}`} className="mt-2 block">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct(g.id)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{pct(g.id)}% etiquetado</p>
                </Link>
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
