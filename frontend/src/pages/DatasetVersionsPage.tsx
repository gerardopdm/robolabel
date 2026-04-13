import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client'
import DeleteVersionModal from '../components/DeleteVersionModal'
import { useAuth } from '../contexts/AuthContext'
import { apiErrorMessage } from '../utils/apiErrorMessage'

type ClassBreakdownRow = { label_class_id: number; name: string; images_count: number }

type Ver = {
  id: number
  name: string
  artifact_status: string
  images_count: number
  exported_image_count: number | null
  class_breakdown?: ClassBreakdownRow[]
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

/* ── Íconos inline ──────────────────────────────────────────────── */

const IconArchive = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="M2 3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2Z" />
    <path fillRule="evenodd" d="M2 7.5h16l-.811 7.71a2 2 0 0 1-1.99 1.79H4.802a2 2 0 0 1-1.99-1.79L2 7.5Zm5.22 1.72a.75.75 0 0 1 1.06 0L10 10.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
  </svg>
)

const IconDownload = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
  </svg>
)

const IconPlus = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
  </svg>
)

const IconTrash = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
  </svg>
)

/* ── Helpers ─────────────────────────────────────────────────────── */

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ready: { label: 'Listo', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  pending: { label: 'Generando…', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  failed: { label: 'Error', cls: 'bg-red-50 text-red-700 ring-red-600/20' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 ring-slate-500/20' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Justo ahora'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `Hace ${diffH}h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `Hace ${diffD}d`
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

/* ── Componente principal ────────────────────────────────────────── */

export default function DatasetVersionsPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [items, setItems] = useState<Ver[]>([])
  const [loading, setLoading] = useState(true)
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
  const [splitTrainPct, setSplitTrainPct] = useState(70)
  const [splitTestPct, setSplitTestPct] = useState(15)
  const splitValPct = 100 - splitTrainPct - splitTestPct

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  function load() {
    if (!projectId) return
    setLoading(true)
    api
      .get(`/projects/${projectId}/dataset-versions/`)
      .then((r) => setItems(r.data.results ?? r.data))
      .finally(() => setLoading(false))
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

  async function confirmDeleteVersion() {
    if (!projectId || !deleteTarget) return
    setDeletePending(true)
    try {
      await api.delete(`/projects/${projectId}/dataset-versions/${deleteTarget.id}/`)
      setDeleteTarget(null)
      load()
    } finally {
      setDeletePending(false)
    }
  }

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-slate-500">
        <Link to="/projects" className="hover:text-sky-600">Proyectos</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`} className="hover:text-sky-600">Proyecto</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-800">Versiones</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-800">Versiones de dataset</h1>
        {canEdit && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            {IconPlus}
            Nueva versión
          </button>
        )}
      </div>

      {/* ── Formulario de creación ─────────────────────────────── */}
      {canEdit && showForm && (
        <form
          onSubmit={onCreate}
          className="mt-6 space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
              {IconArchive}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Nueva versión de dataset</h2>
              <p className="text-sm text-slate-500">Configura qué incluir y cómo repartirlo</p>
            </div>
          </div>

          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Nombre</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder="v1.0, entrenamiento-abril, …"
              className="mt-1 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              required
              disabled={submitting}
            />
          </div>

          {/* Grupos */}
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

          {/* Solo completadas */}
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500/20"
              checked={onlyCompleted}
              onChange={(e) => {
                setOnlyCompleted(e.target.checked)
                setError(null)
              }}
              disabled={submitting}
            />
            <span>Solo imágenes completadas</span>
          </label>

          {/* Reparto train/test/val */}
          <fieldset disabled={submitting} className="space-y-4 rounded-lg border border-slate-100 bg-slate-50/50 p-4">
            <legend className="rounded-md bg-white px-2 text-sm font-medium text-slate-700">
              Reparto para el ZIP YOLO
            </legend>
            <p className="text-xs text-slate-500">
              Imágenes elegibles:{' '}
              <span className="font-semibold tabular-nums text-slate-700">{eligibleForVersion}</span>
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="flex items-baseline justify-between text-sm text-slate-700">
                  <span className="font-medium">Train</span>
                  <span className="tabular-nums text-xs text-slate-500">
                    {splitTrainPct}% &middot; ~{estTrain}
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
                <div className="flex items-baseline justify-between text-sm text-slate-700">
                  <span className="font-medium">Test</span>
                  <span className="tabular-nums text-xs text-slate-500">
                    {splitTestPct}% &middot; ~{estTest}
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
                <div className="flex items-baseline justify-between text-sm text-slate-700">
                  <span className="font-medium">Validación</span>
                  <span className="tabular-nums text-xs text-slate-500">
                    {splitValPct}% &middot; ~{estVal}
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

          {/* Augmentaciones */}
          <fieldset disabled={submitting} className="space-y-4 rounded-lg border border-slate-100 bg-slate-50/50 p-4">
            <legend className="rounded-md bg-white px-2 text-sm font-medium text-slate-700">
              Aumento de datos
            </legend>
            <p className="text-xs text-slate-500">
              Solo se aplica al split de train. Cada opción activa genera 1 copia extra por imagen.
            </p>

            {/* Resumen en vivo */}
            <div
              className="flex items-start gap-3 rounded-lg border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm"
              aria-live="polite"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-800">
                  Total estimado en el ZIP:{' '}
                  <span className="tabular-nums text-sky-700">{totalImagesInZip}</span> imágenes
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
                  <span>
                    Train: <span className="tabular-nums font-medium">{trainImagesInZip}</span>
                    {extraAugPerTrainImage > 0 && (
                      <span className="text-slate-400">
                        {' '}({estTrain} + {estTrain * extraAugPerTrainImage} aug)
                      </span>
                    )}
                  </span>
                  <span>Test: <span className="tabular-nums font-medium">{estTest}</span></span>
                  <span>Val: <span className="tabular-nums font-medium">{estVal}</span></span>
                </div>
              </div>
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <label className="flex items-center gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500/20"
                  checked={aug.flip_horizontal}
                  onChange={(e) => setAug((a) => ({ ...a, flip_horizontal: e.target.checked }))}
                />
                Volteo horizontal
              </label>
              <label className="flex items-center gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500/20"
                  checked={aug.flip_vertical}
                  onChange={(e) => setAug((a) => ({ ...a, flip_vertical: e.target.checked }))}
                />
                Volteo vertical
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Rotación (grados)</span>
                <input
                  type="number"
                  min={0}
                  max={45}
                  step={1}
                  value={aug.rotate_deg}
                  onChange={(e) => setAug((a) => ({ ...a, rotate_deg: Number(e.target.value) || 0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm shadow-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Brillo (1 = sin cambio)</span>
                <input
                  type="number"
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  value={aug.brightness}
                  onChange={(e) => setAug((a) => ({ ...a, brightness: Number(e.target.value) || 1.0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm shadow-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Contraste (1 = sin cambio)</span>
                <input
                  type="number"
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  value={aug.contrast}
                  onChange={(e) => setAug((a) => ({ ...a, contrast: Number(e.target.value) || 1.0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm shadow-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Desenfoque (sigma)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={aug.blur_sigma}
                  onChange={(e) => setAug((a) => ({ ...a, blur_sigma: Number(e.target.value) || 0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm shadow-sm"
                />
              </label>
            </div>
          </fieldset>

          {/* Error + acciones */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex gap-3 border-t border-slate-100 pt-4">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* ── Lista de versiones ─────────────────────────────────── */}
      <div className="mt-8">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
        ) : items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              {IconArchive}
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-700">Sin versiones todavía</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Creá tu primera versión de dataset para generar un ZIP con el formato YOLOv8 listo para entrenar.
            </p>
            {canEdit && !showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
              >
                {IconPlus}
                Nueva versión
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((v) => {
              const classRows = v.class_breakdown?.filter((r) => r.images_count > 0) ?? []
              const hasAug = v.exported_image_count != null && v.exported_image_count > v.images_count
              return (
                <div
                  key={v.id}
                  className={`rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
                    v.artifact_status === 'failed'
                      ? 'border-red-200/60'
                      : 'border-slate-200'
                  }`}
                >
                  {/* Fila superior: nombre + badge + fecha + descarga */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        v.artifact_status === 'ready'
                          ? 'bg-emerald-50 text-emerald-600'
                          : v.artifact_status === 'failed'
                            ? 'bg-red-50 text-red-500'
                            : 'bg-amber-50 text-amber-600'
                      }`}>
                        {IconArchive}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">{v.name}</h3>
                        <p className="text-xs text-slate-400">{formatDate(v.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={v.artifact_status} />
                      {v.artifact_status === 'ready' && (
                        <button
                          type="button"
                          onClick={() => download(v.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-sky-700"
                        >
                          {IconDownload}
                          Descargar
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ id: v.id, name: v.name })}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 hover:text-red-700"
                        >
                          {IconTrash}
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Estadísticas */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    <span className="text-slate-500">
                      Originales:{' '}
                      <span className="tabular-nums font-medium text-slate-700">{v.images_count}</span>
                    </span>
                    {v.exported_image_count != null && (
                      <span className="text-slate-500">
                        En ZIP:{' '}
                        <span className={`tabular-nums font-medium ${hasAug ? 'text-sky-700' : 'text-slate-700'}`}>
                          {v.exported_image_count}
                        </span>
                        {hasAug && (
                          <span className="ml-1 text-xs text-slate-400">
                            (con augmentación)
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Breakdown por clase */}
                  {classRows.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {classRows.map((r) => (
                        <span
                          key={r.label_class_id}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-0.5 text-xs text-slate-600"
                        >
                          <span className="truncate font-medium text-slate-700">{r.name}</span>
                          <span className="tabular-nums text-slate-500">{r.images_count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <DeleteVersionModal
        open={deleteTarget != null}
        versionName={deleteTarget?.name ?? ''}
        pending={deletePending}
        onClose={() => !deletePending && setDeleteTarget(null)}
        onConfirm={confirmDeleteVersion}
      />
    </div>
  )
}
