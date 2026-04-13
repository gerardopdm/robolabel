import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'

type Stats = {
  total_images: number
  completed_images: number
  pending_images: number
  in_progress_images: number
  groups: {
    id: number
    name: string
    total_images: number
    completed_images: number
    images_by_class?: { id: number; name: string; color_hex: string; image_count: number }[]
    labelers?: { id: number; email: string; display_name: string }[]
  }[]
}

const HUB_REFRESH_MS = 60_000

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
}

function StatCard({
  label,
  value,
  total,
  color,
  icon,
}: {
  label: string
  value: number
  total: number
  color: string
  icon: React.ReactNode
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const colorMap: Record<string, { text: string; bg: string; ring: string }> = {
    slate: { text: 'text-slate-700', bg: 'bg-slate-100', ring: 'text-slate-300' },
    emerald: { text: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'text-emerald-200' },
    amber: { text: 'text-amber-600', bg: 'bg-amber-50', ring: 'text-amber-200' },
    sky: { text: 'text-sky-600', bg: 'bg-sky-50', ring: 'text-sky-200' },
  }
  const c = colorMap[color] ?? colorMap.slate

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.bg}`}>
          <span className={c.text}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-slate-500">{label}</p>
          <div className="flex items-baseline gap-2">
            <p className={`text-2xl font-semibold ${c.text}`}>{value}</p>
            {color !== 'slate' && (
              <span className="text-sm text-slate-400">{pct}%</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NavCard({
  to,
  title,
  description,
  icon,
}: {
  to: string
  title: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-sky-300 hover:shadow-md"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 transition-colors group-hover:bg-sky-100">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-medium text-slate-800 group-hover:text-sky-700">{title}</p>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
    </Link>
  )
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? (completed / total) * 100 : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-sky-500' : 'bg-slate-200'}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

const IconImages = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909-4.22-4.22a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 7a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
  </svg>
)

const IconCheck = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
  </svg>
)

const IconClock = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
  </svg>
)

const IconPending = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
  </svg>
)

const IconFolder = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z" />
  </svg>
)

const IconTag = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path fillRule="evenodd" d="M4.5 2A2.5 2.5 0 0 0 2 4.5v3.879a2.5 2.5 0 0 0 .732 1.767l7.5 7.5a2.5 2.5 0 0 0 3.536 0l3.878-3.878a2.5 2.5 0 0 0 0-3.536l-7.5-7.5A2.5 2.5 0 0 0 8.38 2H4.5ZM5 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
  </svg>
)

const IconArchive = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="M2 3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2Z" />
    <path fillRule="evenodd" d="M2 7.5h16l-.811 7.71a2 2 0 0 1-1.99 1.79H4.802a2 2 0 0 1-1.99-1.79L2 7.5Zm5.22 1.72a.75.75 0 0 1 1.06 0L10 10.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
  </svg>
)

const IconDownload = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
  </svg>
)

const IconPencil = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
    <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25h5a.75.75 0 0 0 0-1.5h-5A2.75 2.75 0 0 0 2 5.75v8.5A2.75 2.75 0 0 0 4.75 17h8.5A2.75 2.75 0 0 0 16 14.25v-5a.75.75 0 0 0-1.5 0v5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" />
  </svg>
)

const IconChevron = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
    <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
  </svg>
)

export default function ProjectHubPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const canExportDataset = Boolean(user?.is_administrador || user?.is_asignador || user?.is_validador)
  const canEditProject = Boolean(user?.is_administrador)

  const loadHub = useCallback(
    async (showLoading: boolean) => {
      if (!projectId) return
      if (showLoading) setLoading(true)
      try {
        const [projectRes, statsRes] = await Promise.all([
          api.get(`/projects/${projectId}/`),
          api.get(`/projects/${projectId}/stats/`),
        ])
        setName(projectRes.data.name)
        setDescription(projectRes.data.description || '')
        setStats(statsRes.data)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [projectId],
  )

  useEffect(() => {
    if (!projectId) return
    void loadHub(true)
    const id = window.setInterval(() => void loadHub(false), HUB_REFRESH_MS)
    return () => clearInterval(id)
  }, [projectId, loadHub])

  async function doExport() {
    if (!projectId) return
    const res = await api.post(
      `/projects/${projectId}/export/yolov8/`,
      { only_completed: true, train_val_split: 0.8, augmentations: {} },
      { responseType: 'blob' },
    )
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `project_${projectId}_yolov8.zip`
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-slate-500">
        <Link to="/projects" className="hover:text-sky-600">
          Proyectos
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-800">{name || '…'}</span>
      </nav>

      {/* Header: título + acciones */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {loading ? (
            <SkeletonBlock className="h-8 w-64" />
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-800">{name}</h1>
              {description && (
                <p className="mt-1 text-sm text-slate-500">{description}</p>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canExportDataset && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              {IconDownload}
              <span className="hidden sm:inline">Exportar ZIP</span>
            </button>
          )}
          {canEditProject && (
            <Link
              to={`/projects/${projectId}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              {IconPencil}
              <span className="hidden sm:inline">Editar</span>
            </Link>
          )}
        </div>
      </div>

      {/* Tarjetas de estadísticas */}
      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20" />
          ))}
        </div>
      ) : stats && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Imágenes totales"
            value={stats.total_images}
            total={stats.total_images}
            color="slate"
            icon={IconImages}
          />
          <StatCard
            label="Completadas"
            value={stats.completed_images}
            total={stats.total_images}
            color="emerald"
            icon={IconCheck}
          />
          <StatCard
            label="Pendientes"
            value={stats.pending_images}
            total={stats.total_images}
            color="amber"
            icon={IconPending}
          />
          <StatCard
            label="En progreso"
            value={stats.in_progress_images}
            total={stats.total_images}
            color="sky"
            icon={IconClock}
          />
        </div>
      )}

      {/* Cards de navegación */}
      {loading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <NavCard
            to={`/projects/${projectId}/groups`}
            title="Grupos e imágenes"
            description={
              stats
                ? `${stats.groups.length} grupo${stats.groups.length !== 1 ? 's' : ''} · ${stats.total_images} imagen${stats.total_images !== 1 ? 'es' : ''}`
                : 'Etiqueta por lotes'
            }
            icon={IconFolder}
          />
          <NavCard
            to={`/projects/${projectId}/classes`}
            title="Clases"
            description="Gestiona categorías de etiquetado"
            icon={IconTag}
          />
          <NavCard
            to={`/projects/${projectId}/dataset-versions`}
            title="Versiones de dataset"
            description="Cortes versionados del dataset"
            icon={IconArchive}
          />
        </div>
      )}

      {/* Progreso por grupo */}
      {loading ? (
        <div className="mt-8">
          <SkeletonBlock className="mb-3 h-5 w-40" />
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-16" />
            ))}
          </div>
        </div>
      ) : stats && stats.groups.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-800">Progreso por grupo</h2>
          <div className="mt-3 space-y-2">
            {stats.groups.map((g) => {
              const pct = g.total_images > 0 ? Math.round((g.completed_images / g.total_images) * 100) : 0
              return (
                <Link
                  key={g.id}
                  to={`/projects/${projectId}/groups/${g.id}`}
                  className="group flex items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3 transition-all hover:border-sky-200 hover:shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700 group-hover:text-sky-700">{g.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">
                          {g.completed_images}/{g.total_images} completadas
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pct >= 100 ? 'bg-emerald-50 text-emerald-700' : pct > 0 ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <ProgressBar completed={g.completed_images} total={g.total_images} />
                    </div>
                    {(g.labelers?.length ?? 0) > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-slate-500">Etiquetadores:</span>
                        {g.labelers!.map((lb) => (
                          <span
                            key={lb.id}
                            className="inline-flex max-w-full truncate rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                            title={lb.email}
                          >
                            {lb.display_name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Sin etiquetadores asignados</p>
                    )}
                    {g.images_by_class && g.images_by_class.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-slate-500">Imágenes con al menos una etiqueta por clase:</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {g.images_by_class.map((c) => (
                            <span
                              key={c.id}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-0.5 text-xs text-slate-600"
                              title={`${c.name}: imágenes que contienen al menos una caja de esta clase`}
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/5"
                                style={{ backgroundColor: c.color_hex }}
                              />
                              <span className="truncate font-medium text-slate-700">{c.name}</span>
                              <span className="tabular-nums text-slate-500">{c.image_count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-slate-400 transition-colors group-hover:text-sky-500">
                    {IconChevron}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal de exportación */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                {IconDownload}
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Exportar dataset YOLOv8</h3>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Se incluirán imágenes en estado &quot;completada&quot; con sus anotaciones en formato YOLOv8.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => setExportOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
                onClick={doExport}
              >
                Descargar ZIP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
