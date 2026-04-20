import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import GalleryImagePreview, { type AnnotationPreview } from '../components/GalleryImagePreview'
import HideGroupModal from '../components/HideGroupModal'
import FilterConfigPanel from '../components/FilterConfigPanel'
import BatchFilterModal from '../components/BatchFilterModal'
import ClearGroupLabelsModal from '../components/ClearGroupLabelsModal'
import DeleteAllGroupImagesModal from '../components/DeleteAllGroupImagesModal'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { apiErrorMessage } from '../utils/apiErrorMessage'

type LabelClassLite = { id: number; name: string; color_hex: string }

type GroupAssignmentRow = {
  id: number
  labeler: number
  labeler_email: string
  assigned_by_email: string | null
  created_at: string
}

type UserListRow = {
  id: number
  email: string
  first_name: string
  last_name: string
  is_etiquetador: boolean
  is_active: boolean
}

type Img = {
  id: number
  original_filename: string
  status: string
  width_px: number
  height_px: number
  file_url: string
  annotation_count?: number
  discarded_for_dataset?: boolean
  annotations_preview?: AnnotationPreview[]
}

/** Orden: pendientes → validar (pendientes de validación) → validadas */
const tabs = ['pendientes', 'validar', 'validadas'] as const
type Tab = (typeof tabs)[number]

function tabCount(
  t: Tab,
  c: { pendientes: number; pending_validation: number; validadas: number },
): number {
  if (t === 'pendientes') return c.pendientes
  if (t === 'validadas') return c.validadas
  return c.pending_validation
}

function tabLabel(t: Tab): string {
  if (t === 'pendientes') return 'Pendientes'
  if (t === 'validar') return 'Validar'
  return 'Validadas'
}

const PAGE_SIZES = [25, 50, 75, 100, 200] as const
type PageSizeOption = (typeof PAGE_SIZES)[number]
type GalleryDensity = 'normal' | 'compact'

const GALLERY_PREFS_KEY = 'robolabel.groupGallery.prefs'

function isPageSizeOption(n: number): n is PageSizeOption {
  return (PAGE_SIZES as readonly number[]).includes(n)
}

function readGalleryPrefs(): { pageSize: PageSizeOption; density: GalleryDensity } {
  const defaults: { pageSize: PageSizeOption; density: GalleryDensity } = {
    pageSize: 25,
    density: 'normal',
  }
  try {
    const raw = localStorage.getItem(GALLERY_PREFS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaults
    const o = parsed as Record<string, unknown>
    const pageSize =
      typeof o.pageSize === 'number' && isPageSizeOption(o.pageSize) ? o.pageSize : defaults.pageSize
    const density =
      o.density === 'normal' || o.density === 'compact' ? o.density : defaults.density
    return { pageSize, density }
  } catch {
    return defaults
  }
}

const GROUP_PAGE_REFRESH_MS = 60_000

const MAX_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 500 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.webm'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'])

function isVideoFile(f: File): boolean {
  if (VIDEO_TYPES.has(f.type)) return true
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext)
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function GroupDetailPage() {
  const { projectId, groupId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [images, setImages] = useState<Img[]>([])
  const [tab, setTab] = useState<Tab>('pendientes')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showAssignmentsModal, setShowAssignmentsModal] = useState(false)
  const [showGalleryUploadModal, setShowGalleryUploadModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Administrador o asignador: subir/ocultar/renombrar grupo y asignar etiquetadores (no validador ni etiquetador solo). */
  const canEdit = Boolean(user?.is_administrador || user?.is_asignador)
  const canManageLabelerAssignments = canEdit

  const [pendingVideo, setPendingVideo] = useState<File | null>(null)
  const [videoFps, setVideoFps] = useState<string>('1')
  const [showVideoModal, setShowVideoModal] = useState(false)
  const [videoProgress, setVideoProgress] = useState<string | null>(null)
  const [labelClasses, setLabelClasses] = useState<LabelClassLite[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSizeOption>(() => readGalleryPrefs().pageSize)
  const [totalCount, setTotalCount] = useState(0)
  const [groupCounts, setGroupCounts] = useState({
    pendientes: 0,
    pending_validation: 0,
    validadas: 0,
  })
  /** Total de imágenes en el grupo (todas las pestañas). */
  const [totalImagesInGroup, setTotalImagesInGroup] = useState(0)
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [density, setDensity] = useState<GalleryDensity>(() => readGalleryPrefs().density)

  const [groupName, setGroupName] = useState<string | null>(null)
  const [groupLoadError, setGroupLoadError] = useState<'notfound' | 'error' | null>(null)
  const [editingGroupName, setEditingGroupName] = useState(false)
  const [headerNameDraft, setHeaderNameDraft] = useState('')
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [showHideModal, setShowHideModal] = useState(false)
  const [hideModalPending, setHideModalPending] = useState(false)

  const [assignments, setAssignments] = useState<GroupAssignmentRow[]>([])
  const [assignableLabelers, setAssignableLabelers] = useState<UserListRow[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [selectedLabelerId, setSelectedLabelerId] = useState<string>('')
  const [assignSubmitting, setAssignSubmitting] = useState(false)

  const [showFilterModal, setShowFilterModal] = useState(false)
  const [groupFilterName, setGroupFilterName] = useState('')
  const [groupFilterParams, setGroupFilterParams] = useState<Record<string, number | string>>({})
  const [filterSaving, setFilterSaving] = useState(false)
  const [showBatchFilterModal, setShowBatchFilterModal] = useState(false)
  const [showClearLabelsModal, setShowClearLabelsModal] = useState(false)
  const [clearLabelsPending, setClearLabelsPending] = useState(false)
  const [clearLabelsError, setClearLabelsError] = useState<string | null>(null)
  const [showDeleteAllImagesModal, setShowDeleteAllImagesModal] = useState(false)
  const [deleteAllImagesPending, setDeleteAllImagesPending] = useState(false)
  const [deleteAllImagesError, setDeleteAllImagesError] = useState<string | null>(null)

  useEffect(() => {
    if (assignError) setShowAssignmentsModal(true)
  }, [assignError])

  useEffect(() => {
    if (uploadError) setShowGalleryUploadModal(true)
  }, [uploadError])

  useEffect(() => {
    if (!showAssignmentsModal && !showGalleryUploadModal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowAssignmentsModal(false)
        setShowGalleryUploadModal(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAssignmentsModal, showGalleryUploadModal])

  useEffect(() => {
    if (!projectId || !groupId) return
    setGroupLoadError(null)
    setGroupName(null)
    api
      .get<{ name: string; detection_filter?: string; detection_filter_params?: Record<string, number | string> }>(
        `/projects/${projectId}/groups/${groupId}/`,
      )
      .then((r) => {
        setGroupName(r.data.name)
        setGroupFilterName(r.data.detection_filter ?? '')
        setGroupFilterParams(r.data.detection_filter_params ?? {})
      })
      .catch((e: { response?: { status?: number } }) => {
        if (e.response?.status === 404) setGroupLoadError('notfound')
        else setGroupLoadError('error')
      })
  }, [projectId, groupId])

  const loadAssignmentsAndLabelers = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!projectId || !groupId || !canManageLabelerAssignments) return
      const silent = Boolean(opts?.silent)
      if (!silent) {
        setAssignmentsLoading(true)
        setAssignError(null)
      }
      try {
        const [ar, ur] = await Promise.all([
          api.get<{ results?: GroupAssignmentRow[] }>(
            `/projects/${projectId}/groups/${groupId}/assignments/`,
          ),
          api.get<{ results?: UserListRow[] }>('/users/', { params: { page_size: 200 } }),
        ])
        const alist = ar.data.results ?? (ar.data as unknown as GroupAssignmentRow[])
        setAssignments(Array.isArray(alist) ? alist : [])
        const ulist = ur.data.results ?? (ur.data as unknown as UserListRow[])
        const users = Array.isArray(ulist) ? ulist : []
        setAssignableLabelers(users.filter((u) => u.is_etiquetador && u.is_active))
      } catch (e) {
        if (!silent) {
          setAssignError(apiErrorMessage(e, 'No se pudieron cargar las asignaciones.'))
          setAssignments([])
          setAssignableLabelers([])
        }
      } finally {
        if (!silent) setAssignmentsLoading(false)
      }
    },
    [projectId, groupId, canManageLabelerAssignments],
  )

  useEffect(() => {
    void loadAssignmentsAndLabelers()
  }, [loadAssignmentsAndLabelers])

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_PREFS_KEY, JSON.stringify({ pageSize, density }))
    } catch {
      /* quota o modo privado */
    }
  }, [pageSize, density])

  const loadGallery = useCallback(
    async (forcedPage?: number, options?: { silent?: boolean }) => {
      if (!projectId || !groupId) return
      const p = forcedPage ?? page
      const silent = Boolean(options?.silent)
      if (!silent) setGalleryLoading(true)
      try {
        const params: Record<string, number | string> = { page: p, page_size: pageSize }
        if (tab === 'pendientes') params.status = 'pendientes'
        else if (tab === 'validar') params.status = 'pending_validation'
        else if (tab === 'validadas') params.status = 'validadas'
        const r = await api.get(`/projects/${projectId}/groups/${groupId}/images/`, { params })
        const list: Img[] = r.data.results ?? r.data
        setImages(Array.isArray(list) ? list : [])
        setTotalCount(typeof r.data.count === 'number' ? r.data.count : list.length)
        const gc = r.data.group_image_counts as
          | {
              all?: number
              pendientes?: number
              pending_validation?: number
              validadas?: number
              completed?: number
            }
          | undefined
        if (gc && typeof gc.pendientes === 'number') {
          const pend = gc.pendientes
          const pv = gc.pending_validation ?? 0
          const val = gc.validadas ?? gc.completed ?? 0
          setGroupCounts({
            pendientes: pend,
            pending_validation: pv,
            validadas: val,
          })
          const all =
            typeof gc.all === 'number' ? gc.all : pend + pv + val
          setTotalImagesInGroup(all)
        }
      } finally {
        if (!silent) setGalleryLoading(false)
      }
    },
    [projectId, groupId, page, pageSize, tab],
  )

  useEffect(() => {
    void loadGallery()
  }, [loadGallery])

  useEffect(() => {
    if (!projectId || !groupId) return
    const tick = window.setInterval(() => {
      void loadGallery(undefined, { silent: true }).catch(() => {
        /* refresco en segundo plano */
      })
      api
        .get<{ name: string }>(`/projects/${projectId}/groups/${groupId}/`)
        .then((r) => setGroupName(r.data.name))
        .catch(() => {
          /* ignorar errores de red en segundo plano */
        })
      if (canManageLabelerAssignments) void loadAssignmentsAndLabelers({ silent: true })
    }, GROUP_PAGE_REFRESH_MS)
    return () => clearInterval(tick)
  }, [projectId, groupId, loadGallery, canManageLabelerAssignments, loadAssignmentsAndLabelers])

  useEffect(() => {
    if (!projectId) return
    api.get(`/projects/${projectId}/classes/`).then((r) => {
      const list: LabelClassLite[] = r.data.results ?? r.data
      setLabelClasses(Array.isArray(list) ? list : [])
    })
  }, [projectId])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  function filterValidImages(files: File[]): { ok: File[]; rejected: string[] } {
    const ok: File[] = []
    const rejected: string[] = []
    for (const f of files) {
      if (!IMAGE_TYPES.has(f.type)) {
        rejected.push(`${f.name}: solo JPEG o PNG`)
        continue
      }
      if (f.size > MAX_BYTES) {
        rejected.push(`${f.name}: supera 10 MB`)
        continue
      }
      ok.push(f)
    }
    return { ok, rejected }
  }

  function addFilesFromList(fileList: FileList | null) {
    if (!fileList?.length) return
    const allFiles = Array.from(fileList)

    const videos = allFiles.filter(isVideoFile)
    const nonVideos = allFiles.filter((f) => !isVideoFile(f))

    if (videos.length > 0) {
      if (videos.length > 1) {
        setUploadError('Solo puedes subir un video a la vez.')
        return
      }
      const video = videos[0]
      if (video.size > MAX_VIDEO_BYTES) {
        setUploadError(`${video.name}: el video supera 500 MB`)
        return
      }
      setPendingVideo(video)
      setVideoFps('1')
      setShowVideoModal(true)
      setUploadError(null)

      if (nonVideos.length > 0) {
        const { ok, rejected } = filterValidImages(nonVideos)
        if (rejected.length) setUploadError(rejected.slice(0, 3).join(' · ') + (rejected.length > 3 ? '…' : ''))
        if (ok.length) setPendingFiles((prev) => [...prev, ...ok])
      }
      return
    }

    const { ok, rejected } = filterValidImages(nonVideos)
    if (rejected.length) setUploadError(rejected.slice(0, 3).join(' · ') + (rejected.length > 3 ? '…' : ''))
    else setUploadError(null)
    if (ok.length) setPendingFiles((prev) => [...prev, ...ok])
  }

  function removePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function clearPending() {
    setPendingFiles([])
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function cancelVideoModal() {
    setPendingVideo(null)
    setShowVideoModal(false)
    setVideoFps('1')
  }

  async function uploadVideo() {
    if (!pendingVideo || !projectId || !groupId) return
    const fpsNum = parseFloat(videoFps)
    if (isNaN(fpsNum) || fpsNum <= 0 || fpsNum > 60) {
      setUploadError('FPS debe ser un número entre 0.1 y 60.')
      return
    }
    setShowVideoModal(false)
    setUploading(true)
    setUploadError(null)
    setVideoProgress('Subiendo video al servidor…')

    const fd = new FormData()
    fd.append('video', pendingVideo)
    fd.append('fps', String(fpsNum))

    try {
      const res = await api.post(`/projects/${projectId}/groups/${groupId}/upload-video/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
      })
      const info = res.data?.video_info
      setVideoProgress(
        `Video procesado: ${info?.frames_extracted ?? '?'} frames extraídos de ${info?.duration_seconds ?? '?'}s a ${fpsNum} fps`,
      )
      setPendingVideo(null)
      setPage(1)
      void loadGallery(1)
      setTimeout(() => setVideoProgress(null), 8000)
    } catch {
      setUploadError('Error al procesar el video. Comprueba el formato y el tamaño.')
    } finally {
      setUploading(false)
    }
  }

  async function uploadPending() {
    if (!pendingFiles.length || !projectId || !groupId) return
    if (pendingFiles.length > 100) {
      setUploadError('Máximo 100 imágenes por envío.')
      return
    }
    setUploading(true)
    setUploadError(null)
    const fd = new FormData()
    for (let i = 0; i < pendingFiles.length; i++) fd.append('files', pendingFiles[i])
    try {
      const res = await api.post(`/projects/${projectId}/groups/${groupId}/images/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const errs = res.data?.errors as { file?: string; error?: string }[] | undefined
      if (errs?.length) {
        setUploadError(
          'Algunos archivos fallaron: ' + errs.map((e) => `${e.file ?? '?'} (${e.error})`).join('; '),
        )
      }
      clearPending()
      setPage(1)
      void loadGallery(1)
    } catch {
      setUploadError('Error al subir. Comprueba la red o el tamaño de los archivos.')
    } finally {
      setUploading(false)
    }
  }

  async function saveGroupRename(e: FormEvent) {
    e.preventDefault()
    if (!projectId || !groupId || !headerNameDraft.trim()) return
    setGroupActionBusy(true)
    try {
      const r = await api.patch<{ name: string }>(`/projects/${projectId}/groups/${groupId}/`, {
        name: headerNameDraft.trim(),
      })
      setGroupName(r.data.name)
      setEditingGroupName(false)
    } finally {
      setGroupActionBusy(false)
    }
  }

  function startHeaderRename() {
    if (groupName) setHeaderNameDraft(groupName)
    setEditingGroupName(true)
  }

  async function executeHideGroup() {
    if (!projectId || !groupId || !groupName) return
    setHideModalPending(true)
    setGroupActionBusy(true)
    try {
      await api.delete(`/projects/${projectId}/groups/${groupId}/`)
      setShowHideModal(false)
      navigate(`/projects/${projectId}/groups`)
    } finally {
      setHideModalPending(false)
      setGroupActionBusy(false)
    }
  }

  async function addGroupAssignment(e: FormEvent) {
    e.preventDefault()
    if (!projectId || !groupId || !selectedLabelerId) return
    setAssignSubmitting(true)
    setAssignError(null)
    try {
      await api.post(`/projects/${projectId}/groups/${groupId}/assignments/`, {
        labeler: Number(selectedLabelerId),
      })
      setSelectedLabelerId('')
      await loadAssignmentsAndLabelers()
    } catch (err) {
      setAssignError(apiErrorMessage(err, 'No se pudo asignar el etiquetador.'))
    } finally {
      setAssignSubmitting(false)
    }
  }

  async function removeGroupAssignment(assignmentId: number) {
    if (!projectId || !groupId) return
    setAssignSubmitting(true)
    setAssignError(null)
    try {
      await api.delete(`/projects/${projectId}/groups/${groupId}/assignments/${assignmentId}/`)
      await loadAssignmentsAndLabelers()
    } catch (err) {
      setAssignError(apiErrorMessage(err, 'No se pudo quitar la asignación.'))
    } finally {
      setAssignSubmitting(false)
    }
  }

  async function saveFilterConfig(filterName: string, params: Record<string, number | string>) {
    if (!projectId || !groupId) return
    setFilterSaving(true)
    try {
      await api.patch(`/projects/${projectId}/groups/${groupId}/`, {
        detection_filter: filterName,
        detection_filter_params: params,
      })
      setGroupFilterName(filterName)
      setGroupFilterParams(params)
    } finally {
      setFilterSaving(false)
    }
  }

  async function executeClearGroupLabels() {
    if (!projectId || !groupId) return
    setClearLabelsPending(true)
    setClearLabelsError(null)
    try {
      await api.post(`/projects/${projectId}/groups/${groupId}/clear-annotations/`)
      setShowClearLabelsModal(false)
      void loadGallery()
    } catch (e) {
      setClearLabelsError(apiErrorMessage(e, 'No se pudieron quitar las etiquetas.'))
    } finally {
      setClearLabelsPending(false)
    }
  }

  async function executeDeleteAllGroupImages() {
    if (!projectId || !groupId) return
    setDeleteAllImagesPending(true)
    setDeleteAllImagesError(null)
    try {
      await api.post(`/projects/${projectId}/groups/${groupId}/delete-all-images/`)
      setShowDeleteAllImagesModal(false)
      setPage(1)
      void loadGallery(1)
    } catch (e) {
      setDeleteAllImagesError(apiErrorMessage(e, 'No se pudieron borrar las imágenes.'))
    } finally {
      setDeleteAllImagesPending(false)
    }
  }

  const assignedLabelerIds = new Set(assignments.map((a) => a.labeler))
  const labelersForSelect = assignableLabelers.filter((u) => !assignedLabelerIds.has(u.id))

  const nav = (
    <nav className="mb-4 text-sm text-slate-500">
      <Link to="/projects">Proyectos</Link>
      <span className="mx-2">/</span>
      <Link to={`/projects/${projectId}`}>Proyecto</Link>
      <span className="mx-2">/</span>
      <Link to={`/projects/${projectId}/groups`}>Grupos</Link>
    </nav>
  )

  if (groupLoadError === 'notfound') {
    return (
      <div>
        {nav}
        <h1 className="text-xl font-semibold text-slate-800">Grupo no disponible</h1>
        <p className="mt-2 text-slate-600">No existe o fue ocultado.</p>
        <Link to={`/projects/${projectId}/groups`} className="mt-4 inline-block text-sky-600 hover:underline">
          Volver al listado de grupos
        </Link>
      </div>
    )
  }

  if (groupLoadError === 'error') {
    return (
      <div>
        {nav}
        <p className="text-rose-600">No se pudo cargar el grupo. Probá de nuevo más tarde.</p>
      </div>
    )
  }

  if (groupName === null) {
    return (
      <div>
        {nav}
        <p className="text-slate-500">Cargando grupo…</p>
      </div>
    )
  }

  return (
    <div>
      {nav}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {editingGroupName ? (
          <form onSubmit={saveGroupRename} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={headerNameDraft}
              onChange={(e) => setHeaderNameDraft(e.target.value)}
              className="w-full max-w-md rounded-lg border px-3 py-2 text-xl font-bold"
              disabled={groupActionBusy}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={groupActionBusy || !headerNameDraft.trim()}
                className="rounded-lg bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEditingGroupName(false)}
                disabled={groupActionBusy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <h1 className="text-2xl font-bold">{groupName}</h1>
        )}
        {canEdit && !editingGroupName && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={startHeaderRename}
              disabled={groupActionBusy}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-sky-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Renombrar
            </button>
            <button
              type="button"
              onClick={() => setShowHideModal(true)}
              disabled={groupActionBusy}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Ocultar grupo
            </button>
          </div>
        )}
      </div>

      {canManageLabelerAssignments && canEdit && (
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAssignmentsModal(true)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Etiquetadores asignados
          </button>
          <button
            type="button"
            onClick={() => setShowGalleryUploadModal(true)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Subir imágenes o video
          </button>
          <button
            type="button"
            onClick={() => setShowFilterModal(true)}
            disabled={filterSaving}
            className={`rounded-lg border px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 ${
              groupFilterName
                ? 'border-teal-300 bg-teal-50 text-teal-800'
                : 'border-slate-200 bg-white text-slate-800'
            }`}
          >
            <i className="fa-solid fa-filter mr-1.5" aria-hidden />
            {groupFilterName ? 'Filtro configurado' : 'Configurar filtro'}
          </button>
          {groupFilterName && (
            <button
              type="button"
              onClick={() => setShowBatchFilterModal(true)}
              className="rounded-lg border border-teal-300 bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
            >
              <i className="fa-solid fa-bolt mr-1.5" aria-hidden />
              Aplicar filtro a todas
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setClearLabelsError(null)
              setShowClearLabelsModal(true)
            }}
            disabled={totalImagesInGroup === 0}
            className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-800 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="fa-solid fa-eraser mr-1.5" aria-hidden />
            Quitar etiquetas de todas
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteAllImagesError(null)
              setShowDeleteAllImagesModal(true)
            }}
            disabled={totalImagesInGroup === 0}
            className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-900 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="fa-solid fa-trash-can mr-1.5" aria-hidden />
            Borrar todas las imágenes
          </button>
        </div>
      )}

      {showAssignmentsModal && canManageLabelerAssignments && canEdit && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setShowAssignmentsModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignments-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <h2 id="assignments-modal-title" className="text-lg font-semibold text-slate-800">
                Etiquetadores asignados
              </h2>
              <button
                type="button"
                onClick={() => setShowAssignmentsModal(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Cerrar"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs text-slate-500">
                Solo los usuarios con rol de etiquetador verán este grupo si no tienen otros roles con acceso
                global. Podés asignar varios etiquetadores al mismo grupo.
              </p>
              {assignError && (
                <p className="mt-2 text-xs text-red-600" role="alert">
                  {assignError}
                </p>
              )}
              {assignmentsLoading ? (
                <p className="mt-3 text-sm text-slate-500">Cargando asignaciones…</p>
              ) : (
                <>
                  {assignments.length > 0 ? (
                    <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {assignments.map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <div>
                            <span className="font-medium text-slate-800">{a.labeler_email}</span>
                            {a.assigned_by_email && (
                              <span className="ml-2 text-xs text-slate-500">
                                asignado por {a.assigned_by_email}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={assignSubmitting}
                            onClick={() => void removeGroupAssignment(a.id)}
                            className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Quitar
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">Nadie asignado aún.</p>
                  )}
                  <form onSubmit={addGroupAssignment} className="mt-4 flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <label htmlFor="labeler-select" className="block text-xs font-medium text-slate-600">
                        Añadir etiquetador
                      </label>
                      <select
                        id="labeler-select"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={selectedLabelerId}
                        onChange={(e) => setSelectedLabelerId(e.target.value)}
                        disabled={assignSubmitting || labelersForSelect.length === 0}
                      >
                        <option value="">
                          {labelersForSelect.length === 0
                            ? 'No hay más etiquetadores disponibles'
                            : 'Elige un usuario…'}
                        </option>
                        {labelersForSelect.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.email}
                            {u.first_name || u.last_name
                              ? ` (${[u.first_name, u.last_name].filter(Boolean).join(' ')})`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={assignSubmitting || !selectedLabelerId}
                      className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {assignSubmitting ? '…' : 'Asignar'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showGalleryUploadModal && canEdit && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setShowGalleryUploadModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gallery-upload-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <h2 id="gallery-upload-modal-title" className="text-lg font-semibold text-slate-800">
                Subir a la galería
              </h2>
              <button
                type="button"
                onClick={() => setShowGalleryUploadModal(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Cerrar"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <div
                className={`flex min-h-[12rem] flex-col justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  dragOver ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  addFilesFromList(e.dataTransfer.files)
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm"
                  className="hidden"
                  id="file-up"
                  onChange={(e) => {
                    addFilesFromList(e.target.files)
                    e.target.value = ''
                  }}
                />
                <p className="text-sm text-slate-600">
                  Arrastra aquí imágenes o un video, o{' '}
                  <label htmlFor="file-up" className="cursor-pointer font-medium text-sky-600 hover:underline">
                    elige archivos
                  </label>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Imágenes: JPEG/PNG · máx. 10 MB · hasta 100 por envío
                </p>
                <p className="text-xs text-slate-500">
                  Video: MP4, MOV, AVI, WebM · máx. 500 MB · se extraerán frames automáticamente
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!canEdit && <p className="mt-1 text-sm text-slate-500">Galería de imágenes</p>}
      {canEdit && (
        <div className="mt-4 space-y-3">
          {pendingFiles.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800">
                  Listas para subir ({pendingFiles.length})
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={clearPending}
                    disabled={uploading}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Vaciar selección
                  </button>
                  <button
                    type="button"
                    onClick={() => void uploadPending()}
                    disabled={uploading}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {uploading ? 'Subiendo…' : 'Subir al servidor'}
                  </button>
                </div>
              </div>
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-left text-sm">
                {pendingFiles.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-700">{f.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{formatSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => removePending(i)}
                      disabled={uploading}
                      className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {videoProgress && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2">
              <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-emerald-800">{videoProgress}</p>
            </div>
          )}

          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
        </div>
      )}

      {showVideoModal && pendingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">Extraer frames del video</h2>
            <p className="mt-2 text-sm text-slate-600">
              Se detectó un archivo de video: <span className="font-medium">{pendingVideo.name}</span>{' '}
              ({formatSize(pendingVideo.size)})
            </p>
            <p className="mt-3 text-sm text-slate-600">
              ¿Cuántos frames por segundo deseas extraer? Un valor más alto genera más imágenes.
            </p>
            <div className="mt-4">
              <label htmlFor="fps-input" className="block text-sm font-medium text-slate-700">
                Frames por segundo (FPS)
              </label>
              <input
                id="fps-input"
                type="number"
                min="0.1"
                max="60"
                step="0.1"
                value={videoFps}
                onChange={(e) => setVideoFps(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Ejemplo: 1 fps = 1 imagen cada segundo de video · 0.5 fps = 1 imagen cada 2 segundos
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelVideoModal}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void uploadVideo()}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Extraer frames
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t)
              setPage(1)
            }}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500'
            }`}
          >
            {tabLabel(t)} ({tabCount(t, groupCounts)})
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <label htmlFor="page-size" className="whitespace-nowrap">
            Por página
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as PageSizeOption)
              setPage(1)
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Vista</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => setDensity('normal')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                density === 'normal' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setDensity('compact')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                density === 'compact' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Compacta
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          density === 'compact'
            ? 'mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
            : 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
        }
      >
        {images.map((im) => (
          <Link
            key={im.id}
            to={`/projects/${projectId}/groups/${groupId}/annotate/${im.id}`}
            className="group block overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
          >
            <div className="relative aspect-[4/3] bg-slate-100">
              <GalleryImagePreview
                imageId={im.id}
                widthPx={im.width_px}
                heightPx={im.height_px}
                annotations={im.annotations_preview ?? []}
                classes={labelClasses}
              />
              {im.discarded_for_dataset && (
                <span
                  className={`pointer-events-none absolute left-1 top-1 rounded bg-amber-600/90 font-semibold text-white shadow-sm ${
                    density === 'compact'
                      ? 'px-1 py-0.5 text-[8px]'
                      : 'left-1.5 top-1.5 px-1.5 py-0.5 text-[10px]'
                  }`}
                  title="No se incluirá en el dataset de entrenamiento"
                >
                  Descartada
                </span>
              )}
              <span
                className={`pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 font-medium text-white tabular-nums shadow-sm ${
                  density === 'compact'
                    ? 'px-1 py-0.5 text-[8px]'
                    : 'bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px]'
                }`}
                title="Etiquetas (cajas) en esta imagen"
              >
                {(im.annotation_count ?? 0) === 1
                  ? '1 etiqueta'
                  : `${im.annotation_count ?? 0} etiquetas`}
              </span>
            </div>
            <div className={density === 'compact' ? 'p-1' : 'p-2'}>
              <p
                className={`truncate text-slate-700 ${density === 'compact' ? 'text-[10px]' : 'text-xs'}`}
              >
                {im.original_filename}
              </p>
              <span
                className={`mt-0.5 inline-block rounded px-1 font-medium ${
                  density === 'compact' ? 'text-[9px]' : 'mt-1 px-1.5 text-[10px]'
                } ${
                  im.status === 'completed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : im.status === 'pending_validation'
                      ? 'bg-violet-100 text-violet-800'
                      : im.status === 'rejected'
                        ? 'bg-rose-100 text-rose-800'
                        : im.status === 'in_progress'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-amber-100 text-amber-800'
                }`}
              >
                {im.status === 'completed'
                  ? 'Validada'
                  : im.status === 'pending_validation'
                    ? 'Por validar'
                    : im.status === 'rejected'
                      ? 'Rechazada'
                      : im.status === 'in_progress'
                        ? 'En progreso'
                        : 'Pendiente'}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {galleryLoading && images.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">Cargando imágenes…</p>
      )}

      {!galleryLoading && images.length === 0 && (
        <p className="mt-8 text-center text-slate-500">No hay imágenes en este filtro.</p>
      )}

      {totalCount > 0 && (
        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-4 sm:flex-row">
          <p className="text-sm text-slate-600">
            Mostrando{' '}
            <span className="font-medium tabular-nums">
              {totalCount === 0 ? 0 : (page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, totalCount)}
            </span>{' '}
            de <span className="font-medium tabular-nums">{totalCount}</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((x) => Math.max(1, x - 1))}
              disabled={page <= 1 || galleryLoading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-sm text-slate-600">
              Página <span className="tabular-nums font-medium">{page}</span> de{' '}
              <span className="tabular-nums font-medium">{totalPages}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
              disabled={page >= totalPages || galleryLoading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      <HideGroupModal
        open={showHideModal}
        groupName={groupName}
        variant="detail"
        pending={hideModalPending}
        onClose={() => !hideModalPending && setShowHideModal(false)}
        onConfirm={executeHideGroup}
      />

      {projectId && groupId && (
        <FilterConfigPanel
          open={showFilterModal}
          projectId={projectId}
          groupId={groupId}
          currentFilterName={groupFilterName}
          currentFilterParams={groupFilterParams}
          onClose={() => setShowFilterModal(false)}
          onSave={(name, params) => void saveFilterConfig(name, params)}
        />
      )}

      {projectId && groupId && groupFilterName && (
        <BatchFilterModal
          open={showBatchFilterModal}
          projectId={projectId}
          groupId={groupId}
          filterName={groupFilterName}
          filterParams={groupFilterParams}
          labelClasses={labelClasses.map((c) => ({ id: c.id, name: c.name }))}
          onClose={() => setShowBatchFilterModal(false)}
          onFinished={() => void loadGallery()}
        />
      )}

      {groupName && projectId && groupId && (
        <ClearGroupLabelsModal
          open={showClearLabelsModal}
          groupName={groupName}
          imageCount={totalImagesInGroup}
          pending={clearLabelsPending}
          errorMessage={clearLabelsError}
          onClose={() => !clearLabelsPending && setShowClearLabelsModal(false)}
          onConfirm={executeClearGroupLabels}
        />
      )}

      {groupName && projectId && groupId && (
        <DeleteAllGroupImagesModal
          open={showDeleteAllImagesModal}
          groupName={groupName}
          imageCount={totalImagesInGroup}
          pending={deleteAllImagesPending}
          errorMessage={deleteAllImagesError}
          onClose={() => !deleteAllImagesPending && setShowDeleteAllImagesModal(false)}
          onConfirm={executeDeleteAllGroupImages}
        />
      )}
    </div>
  )
}
