import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import GalleryImagePreview, { type AnnotationPreview } from '../components/GalleryImagePreview'
import HideGroupModal from '../components/HideGroupModal'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'

type LabelClassLite = { id: number; color_hex: string }

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

const tabs = ['all', 'completed', 'pending'] as const
type Tab = (typeof tabs)[number]

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
  const [tab, setTab] = useState<Tab>('all')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canEdit = user?.role === 'admin' || user?.role === 'editor'

  const [pendingVideo, setPendingVideo] = useState<File | null>(null)
  const [videoFps, setVideoFps] = useState<string>('1')
  const [showVideoModal, setShowVideoModal] = useState(false)
  const [videoProgress, setVideoProgress] = useState<string | null>(null)
  const [labelClasses, setLabelClasses] = useState<LabelClassLite[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSizeOption>(() => readGalleryPrefs().pageSize)
  const [totalCount, setTotalCount] = useState(0)
  const [groupCounts, setGroupCounts] = useState({ all: 0, completed: 0, pending: 0 })
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [density, setDensity] = useState<GalleryDensity>(() => readGalleryPrefs().density)

  const [groupName, setGroupName] = useState<string | null>(null)
  const [groupLoadError, setGroupLoadError] = useState<'notfound' | 'error' | null>(null)
  const [editingGroupName, setEditingGroupName] = useState(false)
  const [headerNameDraft, setHeaderNameDraft] = useState('')
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [showHideModal, setShowHideModal] = useState(false)
  const [hideModalPending, setHideModalPending] = useState(false)

  useEffect(() => {
    if (!projectId || !groupId) return
    setGroupLoadError(null)
    setGroupName(null)
    api
      .get<{ name: string }>(`/projects/${projectId}/groups/${groupId}/`)
      .then((r) => setGroupName(r.data.name))
      .catch((e: { response?: { status?: number } }) => {
        if (e.response?.status === 404) setGroupLoadError('notfound')
        else setGroupLoadError('error')
      })
  }, [projectId, groupId])

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_PREFS_KEY, JSON.stringify({ pageSize, density }))
    } catch {
      /* quota o modo privado */
    }
  }, [pageSize, density])

  const loadGallery = useCallback(
    async (forcedPage?: number) => {
      if (!projectId || !groupId) return
      const p = forcedPage ?? page
      setGalleryLoading(true)
      try {
        const params: Record<string, number | string> = { page: p, page_size: pageSize }
        if (tab === 'completed') params.status = 'completed'
        else if (tab === 'pending') params.status = 'pending'
        const r = await api.get(`/projects/${projectId}/groups/${groupId}/images/`, { params })
        const list: Img[] = r.data.results ?? r.data
        setImages(Array.isArray(list) ? list : [])
        setTotalCount(typeof r.data.count === 'number' ? r.data.count : list.length)
        const gc = r.data.group_image_counts as
          | { all: number; completed: number; pending: number }
          | undefined
        if (gc && typeof gc.all === 'number') {
          setGroupCounts({ all: gc.all, completed: gc.completed, pending: gc.pending })
        }
      } finally {
        setGalleryLoading(false)
      }
    },
    [projectId, groupId, page, pageSize, tab],
  )

  useEffect(() => {
    void loadGallery()
  }, [loadGallery])

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
      <p className="mt-1 text-sm text-slate-500">Galería de imágenes</p>
      {canEdit && (
        <div className="mt-4 space-y-3">
          <div
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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

      <div className="mt-6 flex gap-2 border-b border-slate-200">
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
            {t === 'all' ? 'Todas' : t === 'completed' ? 'Etiquetadas' : 'Pendientes'} (
            {groupCounts[t === 'pending' ? 'pending' : t === 'completed' ? 'completed' : 'all']})
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
                    : im.status === 'in_progress'
                      ? 'bg-sky-100 text-sky-800'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                {im.status}
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
    </div>
  )
}
