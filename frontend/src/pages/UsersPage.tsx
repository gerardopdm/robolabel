import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { apiErrorMessage } from '../utils/apiErrorMessage'

type CompanyUser = {
  id: number
  email: string
  first_name: string
  last_name: string
  is_administrador: boolean
  is_asignador: boolean
  is_etiquetador: boolean
  is_validador: boolean
  is_active: boolean
  created_at: string
}

function RoleCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
      <input
        type="checkbox"
        className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

export default function UsersPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<CompanyUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newRoles, setNewRoles] = useState({
    is_administrador: false,
    is_asignador: false,
    is_etiquetador: false,
    is_validador: false,
  })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .get<{ results?: CompanyUser[] }>('/users/')
      .then((r) => {
        const data = r.data.results ?? (r.data as unknown as CompanyUser[])
        setRows(Array.isArray(data) ? data : [])
      })
      .catch((e) => setError(apiErrorMessage(e, 'No se pudieron cargar los usuarios.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!user?.is_administrador) {
    return <Navigate to="/projects" replace />
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      await api.post('/users/', {
        email: newEmail.trim(),
        password: newPassword,
        first_name: newFirst.trim(),
        last_name: newLast.trim(),
        ...newRoles,
      })
      setNewEmail('')
      setNewPassword('')
      setNewFirst('')
      setNewLast('')
      setNewRoles({
        is_administrador: false,
        is_asignador: false,
        is_etiquetador: false,
        is_validador: false,
      })
      await load()
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo crear el usuario.'))
    } finally {
      setCreating(false)
    }
  }

  function updateLocal(id: number, patch: Partial<CompanyUser>) {
    setRows((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }

  async function saveUser(u: CompanyUser) {
    setSavingId(u.id)
    setError(null)
    try {
      await api.patch(`/users/${u.id}/`, {
        first_name: u.first_name,
        last_name: u.last_name,
        is_administrador: u.is_administrador,
        is_asignador: u.is_asignador,
        is_etiquetador: u.is_etiquetador,
        is_validador: u.is_validador,
        is_active: u.is_active,
      })
      await load()
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo guardar el usuario.'))
      await load()
    } finally {
      setSavingId(null)
    }
  }

  async function deactivateUser(u: CompanyUser) {
    if (!window.confirm(`¿Desactivar la cuenta de ${u.email}?`)) return
    setSavingId(u.id)
    setError(null)
    try {
      await api.delete(`/users/${u.id}/`)
      await load()
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo desactivar el usuario.'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Usuarios de la empresa</h1>
      <p className="mt-1 text-sm text-slate-500">
        Creá cuentas y asigná uno o varios roles: administrador, asignador, etiquetador y validador.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Nuevo usuario</h2>
        <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">Correo</label>
            <input
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">Contraseña (mín. 8 caracteres)</label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Nombre</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newFirst}
              onChange={(e) => setNewFirst(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Apellidos</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newLast}
              onChange={(e) => setNewLast(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-4">
            <RoleCheckbox
              label="Administrador"
              checked={newRoles.is_administrador}
              onChange={(v) => setNewRoles((r) => ({ ...r, is_administrador: v }))}
            />
            <RoleCheckbox
              label="Asignador"
              checked={newRoles.is_asignador}
              onChange={(v) => setNewRoles((r) => ({ ...r, is_asignador: v }))}
            />
            <RoleCheckbox
              label="Etiquetador"
              checked={newRoles.is_etiquetador}
              onChange={(v) => setNewRoles((r) => ({ ...r, is_etiquetador: v }))}
            />
            <RoleCheckbox
              label="Validador"
              checked={newRoles.is_validador}
              onChange={(v) => setNewRoles((r) => ({ ...r, is_validador: v }))}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {creating ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-slate-800">Usuarios</h2>
        {loading ? (
          <p className="mt-4 text-slate-500">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-slate-500">No hay usuarios en la empresa.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Correo</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Nombre</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Roles</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Activo</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-700">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((u) => {
                  const isSelf = user?.id === u.id
                  return (
                    <tr key={u.id} className={u.is_active ? '' : 'bg-slate-50 opacity-60'}>
                      <td className="px-3 py-2 font-medium text-slate-800">{u.email}</td>
                      <td className="px-3 py-2 text-slate-600">
                        <input
                          type="text"
                          className="w-full min-w-[8rem] rounded border border-slate-200 px-2 py-1"
                          value={u.first_name}
                          onChange={(e) => updateLocal(u.id, { first_name: e.target.value })}
                        />
                        <input
                          type="text"
                          className="mt-1 w-full min-w-[8rem] rounded border border-slate-200 px-2 py-1"
                          value={u.last_name}
                          onChange={(e) => updateLocal(u.id, { last_name: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <RoleCheckbox
                            label="Administrador"
                            checked={u.is_administrador}
                            disabled={isSelf && u.is_administrador}
                            onChange={(v) => updateLocal(u.id, { is_administrador: v })}
                          />
                          <RoleCheckbox
                            label="Asignador"
                            checked={u.is_asignador}
                            onChange={(v) => updateLocal(u.id, { is_asignador: v })}
                          />
                          <RoleCheckbox
                            label="Etiquetador"
                            checked={u.is_etiquetador}
                            onChange={(v) => updateLocal(u.id, { is_etiquetador: v })}
                          />
                          <RoleCheckbox
                            label="Validador"
                            checked={u.is_validador}
                            onChange={(v) => updateLocal(u.id, { is_validador: v })}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-sky-600"
                          checked={u.is_active}
                          disabled={isSelf}
                          onChange={(e) => updateLocal(u.id, { is_active: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="rounded-lg border border-sky-600 bg-white px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                          disabled={savingId === u.id}
                          onClick={() => void saveUser(u)}
                        >
                          Guardar
                        </button>
                        {!isSelf && u.is_active && (
                          <button
                            type="button"
                            className="ml-2 rounded-lg border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                            disabled={savingId === u.id}
                            onClick={() => void deactivateUser(u)}
                          >
                            Desactivar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
