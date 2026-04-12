import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { apiErrorMessage } from '../utils/apiErrorMessage'

type Ver = {
  id: number
  name: string
  artifact_status: string
  images_count: number
  created_at: string
}

type Group = { id: number; name: string }

type ProjectStats = {
  groups: { id: number; name: string; total_images: number; completed_images: number }[]
}

function eligibleImageCount(
  stats: ProjectStats | null,
  selected: Set<number>,
  onlyCompleted: boolean,
): number {
  if (!stats?.groups) return 0
  let n = 0
  for (const g of stats.groups) {
    if (!selected.has(g.id)) continue
    n += onlyCompleted ? g.completed_images : g.total_images
  }
  return n
}

type Augmentations = {
  flip_horizontal: boolean
  flip_vertical: boolean
  rotate_deg: number
  brightness: number
  contrast: number
  blur_sigma: number
}

const DEFAULT_AUG: Augmentations = {
  flip_horizontal: false,
  flip_vertical: false,
  rotate_deg: 0,
  brightness: 1.0,
  contrast: 1.0,
  blur_sigma: 0,
}

function augToPayload(aug: Augmentations): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (aug.flip_horizontal) out.flip_horizontal = true
  if (aug.flip_vertical) out.flip_vertical = true
  if (aug.rotate_deg) out.rotate_deg = aug.rotate_deg
  if (aug.brightness !== 1.0) out.brightness = aug.brightness
  if (aug.contrast !== 1.0) out.contrast = aug.contrast
  if (aug.blur_sigma > 0) out.blur_sigma = aug.blur_sigma
  return out
}

/**
 * Variantes extra por cada imagen de train (misma lógica que `backend/api/augmentation.py`):
 * cada opción activa genera un archivo adicional además del original en train.
 */
function countExtraAugVariantsPerTrainImage(aug: Augmentations): number {
  let n = 0
  if (aug.flip_horizontal) n += 1
  if (aug.flip_vertical) n += 1
  if (Math.abs(aug.rotate_deg) > 0.01) n += 1
  if (aug.brightness !== 1.0) n += 1
  if (aug.contrast !== 1.0) n += 1
  if (aug.blur_sigma > 0) n += 1
  return n
}

export default function DatasetVersionsPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [items, setItems] = useState<Ver[]>([])
  const [name, setName] = useState('')
  const [onlyCompleted, setOnlyCompleted] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const canEdit = Boolean(user?.is_administrador || user?.is_asignador)

  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [aug, setAug] = useState<Augmentations>({ ...DEFAULT_AUG })
  const [showForm, setShowForm] = useState(false)
  const [stats, setStats] = useState<ProjectStats | null>(null)
  /** Porcentajes 0–100 que suman 100: train + test + validación */
  const [splitTrainPct, setSplitTrainPct] = useState(70)
  const [splitTestPct, setSplitTestPct] = useState(15)
  const splitValPct = 100 - splitTrainPct - splitTestPct

  function load() {
    if (!projectId) return
    api.get(`/projects/${projectId}/dataset-versions/`).then((r) => setItems(r.data.results ?? r.data))
  }

  function loadGroups() {
    if (!projectId) return
    api.get(`/projects/${projectId}/groups/`).then((r) => {
      const list: Group[] = r.data.results ?? r.data
      setGroups(list)
      setSelectedGroupIds(new Set(list.map((g) => g.id)))
    })
  }

  useEffect(() => {
    load()
    loadGroups()
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    api.get(`/projects/${projectId}/stats/`).then((r) => setStats(r.data))
  }, [projectId])

  function toggleGroup(id: number) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllGroups() {
    setSelectedGroupIds(new Set(groups.map((g) => g.id)))
  }

  function deselectAllGroups() {
    setSelectedGroupIds(new Set())
  }

  function resetForm() {
    setName('')
    setOnlyCompleted(true)
    setAug({ ...DEFAULT_AUG })
    setSelectedGroupIds(new Set(groups.map((g) => g.id)))
    setSplitTrainPct(70)
    setSplitTestPct(15)
    setError(null)
  }

  function onSplitTrainChange(raw: number) {
    const t = Math.max(0, Math.min(100, Math.round(raw)))
    const rest = 100 - t
    setSplitTrainPct(t)
    setSplitTestPct((prev) => Math.min(prev, rest))
  }

  function onSplitTestChange(raw: number) {
    const maxTest = 100 - splitTrainPct
    const e = Math.max(0, Math.min(maxTest, Math.round(raw)))
    setSplitTestPct(e)
  }

  function onSplitValChange(raw: number) {
    const maxV = 100 - splitTrainPct
    const v = Math.max(0, Math.min(maxV, Math.round(raw)))
    setSplitTestPct(100 - splitTrainPct - v)
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!projectId || !name.trim()) return
    if (selectedGroupIds.size === 0) {
      setError('Seleccioná al menos un grupo.')
      return
    }
    const vPct = 100 - splitTrainPct - splitTestPct
    if (vPct < 0) {
      setError('Los porcentajes de split deben sumar 100 %.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const allSelected = selectedGroupIds.size === groups.length
      await api.post(`/projects/${projectId}/dataset-versions/`, {
        name: name.trim(),
        notes: '',
        only_completed: onlyCompleted,
        split_train: splitTrainPct / 100,
        split_test: splitTestPct / 100,
        split_val: (100 - splitTrainPct - splitTestPct) / 100,
        ...(allSelected ? {} : { group_ids: [...selectedGroupIds] }),
        augmentations: augToPayload(aug),
      })
      resetForm()
      setShowForm(false)
      load()
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo crear la versión.'))
    } finally {
      setSubmitting(false)
    }
  }

  const eligibleForVersion = eligibleImageCount(stats, selectedGroupIds, onlyCompleted)
  const estTrain =
    eligibleForVersion > 0 ? Math.round((eligibleForVersion * splitTrainPct) / 100) : 0
  const estTest =
    eligibleForVersion > 0 ? Math.round((eligibleForVersion * splitTestPct) / 100) : 0
  const estVal = Math.max(0, eligibleForVersion - estTrain - estTest)
  const extraAugPerTrainImage = countExtraAugVariantsPerTrainImage(aug)
  const trainImagesInZip = estTrain * (1 + extraAugPerTrainImage)
  const totalImagesInZip = trainImagesInZip + estTest + estVal

  async function download(id: number) {
    if (!projectId) return
    const res = await api.get(`/projects/${projectId}/dataset-versions/${id}/export/yolov8/`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `dataset_v${id}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-slate-500">
        <Link to="/projects">Proyectos</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`}>Proyecto</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-800">Versiones</span>
      </nav>
      <h1 className="text-2xl font-bold">Versiones de dataset</h1>

      {canEdit && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          Nueva versión
        </button>
      )}

      {canEdit && showForm && (
        <form onSubmit={onCreate} className="mt-4 max-w-xl space-y-5 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-800">Nueva versión de dataset</h2>

          {/* --- Nombre --- */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Nombre</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder="v1.0, entrenamiento-abril, …"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-sky-500"
              required
              disabled={submitting}
            />
          </div>

          {/* --- Grupos --- */}
          <fieldset disabled={submitting}>
            <legend className="text-sm font-medium text-slate-700">Grupos a incluir</legend>
            {groups.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">Este proyecto no tiene grupos.</p>
            ) : (
              <>
                <div className="mt-1 flex gap-3 text-xs text-sky-600">
                  <button type="button" onClick={selectAllGroups} className="hover:underline">
                    Todos
                  </button>
                  <button type="button" onClick={deselectAllGroups} className="hover:underline">
                    Ninguno
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                        selectedGroupIds.has(g.id)
                          ? 'border-sky-300 bg-sky-50 text-sky-700'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={selectedGroupIds.has(g.id)}
                        onChange={() => toggleGroup(g.id)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>

          {/* --- Solo completadas --- */}
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={onlyCompleted}
              onChange={(e) => {
                setOnlyCompleted(e.target.checked)
                setError(null)
              }}
              disabled={submitting}
            />
            <span>Solo imágenes completadas</span>
          </label>

          {/* --- Reparto train / test / valid (ZIP YOLO) --- */}
          <fieldset disabled={submitting} className="space-y-4">
            <legend className="text-sm font-medium text-slate-700">Reparto para el ZIP YOLO</legend>
            <p className="text-xs text-slate-500">
              Imágenes elegibles según grupos y filtro:{' '}
              <span className="font-medium text-slate-700">{eligibleForVersion}</span>. Los conteos
              finales pueden variar ±1 por redondeo; el total siempre coincide con las elegibles.
            </p>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm text-slate-700">
                  <span>Train</span>
                  <span>
                    {splitTrainPct}% (~{estTrain} img.)
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={splitTrainPct}
                  onChange={(e) => onSplitTrainChange(Number(e.target.value))}
                  className="mt-1 w-full accent-sky-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-sm text-slate-700">
                  <span>Test</span>
                  <span>
                    {splitTestPct}% (~{estTest} img.)
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, 100 - splitTrainPct)}
                  value={splitTestPct}
                  onChange={(e) => onSplitTestChange(Number(e.target.value))}
                  className="mt-1 w-full accent-sky-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-sm text-slate-700">
                  <span>Validación</span>
                  <span>
                    {splitValPct}% (~{estVal} img.)
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, 100 - splitTrainPct)}
                  value={splitValPct}
                  onChange={(e) => onSplitValChange(Number(e.target.value))}
                  className="mt-1 w-full accent-sky-600"
                />
              </div>
            </div>
          </fieldset>

          {/* --- Augmentaciones --- */}
          <fieldset disabled={submitting} className="space-y-3">
            <legend className="text-sm font-medium text-slate-700">Aumento de datos (augmentation)</legend>
            <p className="text-xs text-slate-500">
              Las variantes aumentadas se generan solo sobre el split de entrenamiento. Cada opción activa
              añade una copia extra por imagen de train (además del original en train).
            </p>

            <div
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800"
              aria-live="polite"
            >
              <p className="font-medium text-slate-900">
                Total estimado en el ZIP:{' '}
                <span className="tabular-nums text-sky-700">{totalImagesInZip}</span> imágenes
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-slate-600">
                <li>
                  Train: <span className="tabular-nums font-medium">{trainImagesInZip}</span> (
                  {estTrain} originales
                  {extraAugPerTrainImage > 0 ? (
                    <>
                      {' '}
                      + {estTrain * extraAugPerTrainImage} aumentadas ({extraAugPerTrainImage} por imagen)
                    </>
                  ) : (
                    ', sin aumentos'
                  )}
                  )
                </li>
                <li>
                  Test: <span className="tabular-nums font-medium">{estTest}</span>
                </li>
                <li>
                  Validación: <span className="tabular-nums font-medium">{estVal}</span>
                </li>
              </ul>
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {/* Flip horizontal */}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={aug.flip_horizontal}
                  onChange={(e) => setAug((a) => ({ ...a, flip_horizontal: e.target.checked }))}
                />
                Volteo horizontal
              </label>

              {/* Flip vertical */}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={aug.flip_vertical}
                  onChange={(e) => setAug((a) => ({ ...a, flip_vertical: e.target.checked }))}
                />
                Volteo vertical
              </label>

              {/* Rotación */}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Rotación (grados)</span>
                <input
                  type="number"
                  min={0}
                  max={45}
                  step={1}
                  value={aug.rotate_deg}
                  onChange={(e) => setAug((a) => ({ ...a, rotate_deg: Number(e.target.value) || 0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1"
                />
              </label>

              {/* Brillo */}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Brillo (factor, 1 = sin cambio)</span>
                <input
                  type="number"
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  value={aug.brightness}
                  onChange={(e) => setAug((a) => ({ ...a, brightness: Number(e.target.value) || 1.0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1"
                />
              </label>

              {/* Contraste */}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Contraste (factor, 1 = sin cambio)</span>
                <input
                  type="number"
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  value={aug.contrast}
                  onChange={(e) => setAug((a) => ({ ...a, contrast: Number(e.target.value) || 1.0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1"
                />
              </label>

              {/* Blur */}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Desenfoque gaussiano (sigma)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={aug.blur_sigma}
                  onChange={(e) => setAug((a) => ({ ...a, blur_sigma: Number(e.target.value) || 0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1"
                />
              </label>
            </div>
          </fieldset>

          {/* --- Error / acciones --- */}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Creando…' : 'Crear versión'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                resetForm()
                setShowForm(false)
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Nombre</th>
            <th>Imágenes</th>
            <th>ZIP</th>
            <th>Fecha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => (
            <tr key={v.id} className="border-b border-slate-100">
              <td className="py-2 font-medium">{v.name}</td>
              <td>{v.images_count}</td>
              <td>{v.artifact_status}</td>
              <td className="text-slate-500">{new Date(v.created_at).toLocaleString()}</td>
              <td>
                {v.artifact_status === 'ready' && (
                  <button type="button" onClick={() => download(v.id)} className="text-sky-600 hover:underline">
                    Descargar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
