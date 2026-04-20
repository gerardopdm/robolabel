import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api/client'

type SelectOption = { value: string; label: string }

export type FilterParamSpec = {
  key: string
  label: string
  help: string
  param_type: 'int' | 'float' | 'select' | 'bool'
  default: number | string
  min_val?: number
  max_val?: number
  step?: number
  unit?: string
  options?: SelectOption[]
}

export type FilterDef = {
  name: string
  display_name: string
  param_specs: FilterParamSpec[]
}

type Props = {
  open: boolean
  projectId: string
  groupId: string
  currentFilterName: string
  currentFilterParams: Record<string, number | string>
  onClose: () => void
  onSave: (filterName: string, params: Record<string, number | string>) => void
}

type PreviewMode = 'result' | 'original_boxes' | 'debug'

const PREVIEW_TABS: { mode: PreviewMode; label: string; icon: string; help: string }[] = [
  { mode: 'result', label: 'Resultado', icon: 'fa-solid fa-crosshairs', help: 'Imagen procesada con boxes de detección' },
  { mode: 'original_boxes', label: 'Original + Boxes', icon: 'fa-solid fa-image', help: 'Imagen original con boxes semi-transparentes' },
  { mode: 'debug', label: 'Pasos del filtro', icon: 'fa-solid fa-table-cells', help: 'Matriz con el resultado de cada paso intermedio del filtrado' },
]

export default function FilterConfigPanel({
  open,
  projectId,
  groupId,
  currentFilterName,
  currentFilterParams,
  onClose,
  onSave,
}: Props) {
  const [availableFilters, setAvailableFilters] = useState<FilterDef[]>([])
  const [selectedFilter, setSelectedFilter] = useState(currentFilterName)
  const [params, setParams] = useState<Record<string, number | string>>({ ...currentFilterParams })
  const [previewUrls, setPreviewUrls] = useState<Record<PreviewMode, string | null>>({
    result: null,
    original_boxes: null,
    debug: null,
  })
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewImageId, setPreviewImageId] = useState<number | null>(null)
  const [groupImages, setGroupImages] = useState<{ id: number; original_filename: string }[]>([])
  const [previewMode, setPreviewMode] = useState<PreviewMode>('result')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // --- YOLO label mapping state ---
  const [modelClasses, setModelClasses] = useState<string[]>([])
  const [projectClasses, setProjectClasses] = useState<{ id: number; name: string }[]>([])
  const [classMap, setClassMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    api.get<FilterDef[]>('/filters/').then((r) => {
      setAvailableFilters(Array.isArray(r.data) ? r.data : [])
    })
  }, [open])

  useEffect(() => {
    if (!open || !projectId || !groupId) return
    api
      .get(`/projects/${projectId}/groups/${groupId}/images/`, {
        params: { page_size: 20, page: 1 },
      })
      .then((r) => {
        const list = (r.data.results ?? r.data) as { id: number; original_filename: string }[]
        setGroupImages(Array.isArray(list) ? list : [])
        if (list.length > 0 && previewImageId === null) setPreviewImageId(list[0].id)
      })
  }, [open, projectId, groupId, previewImageId])

  useEffect(() => {
    if (!open || !projectId) return
    api.get(`/projects/${projectId}/classes/`).then((r) => {
      const list = (r.data.results ?? r.data) as { id: number; name: string }[]
      setProjectClasses(Array.isArray(list) ? list : [])
    })
  }, [open, projectId])

  useEffect(() => {
    if (open) {
      setSelectedFilter(currentFilterName)
      setParams({ ...currentFilterParams })
      try {
        const raw = currentFilterParams.class_map
        if (raw && typeof raw === 'string') {
          setClassMap(JSON.parse(raw) as Record<string, string>)
        } else {
          setClassMap({})
        }
      } catch {
        setClassMap({})
      }
    }
  }, [open, currentFilterName, currentFilterParams])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  const activeDef = availableFilters.find((f) => f.name === selectedFilter)
  const isYoloFilter = selectedFilter === 'yolo_detection'

  useEffect(() => {
    if (!activeDef) return
    const defaults: Record<string, number | string> = {}
    for (const s of activeDef.param_specs) {
      defaults[s.key] = s.default
    }
    if (selectedFilter === currentFilterName && Object.keys(currentFilterParams).length > 0) {
      setParams({ ...defaults, ...currentFilterParams })
    } else {
      setParams(defaults)
    }
  }, [activeDef, selectedFilter, currentFilterName, currentFilterParams])

  // Load model classes when model_file changes (YOLO filter)
  useEffect(() => {
    if (!isYoloFilter) {
      setModelClasses([])
      return
    }
    const modelFile = params.model_file
    if (!modelFile || typeof modelFile !== 'string') {
      setModelClasses([])
      return
    }
    api
      .get<{ classes: string[] }>(`/yolo-models/${encodeURIComponent(modelFile)}/classes/`)
      .then((r) => {
        setModelClasses(Array.isArray(r.data.classes) ? r.data.classes : [])
      })
      .catch(() => setModelClasses([]))
  }, [isYoloFilter, params.model_file])

  // Sync classMap → params.class_map JSON
  useEffect(() => {
    if (!isYoloFilter) return
    setParams((prev) => ({ ...prev, class_map: JSON.stringify(classMap) }))
  }, [classMap, isYoloFilter])

  const fetchPreview = useCallback(async () => {
    if (!selectedFilter || !previewImageId || !projectId || !groupId) return
    setPreviewLoading(true)
    try {
      const [resultResp, origResp, debugResp, countResp] = await Promise.all([
        api.post(
          `/projects/${projectId}/groups/${groupId}/filter-preview/`,
          { image_id: previewImageId, filter_name: selectedFilter, params, mode: 'result' },
          { responseType: 'blob' },
        ),
        api.post(
          `/projects/${projectId}/groups/${groupId}/filter-preview/`,
          { image_id: previewImageId, filter_name: selectedFilter, params, mode: 'original_boxes' },
          { responseType: 'blob' },
        ),
        api.post(
          `/projects/${projectId}/groups/${groupId}/filter-preview/`,
          { image_id: previewImageId, filter_name: selectedFilter, params, mode: 'debug' },
          { responseType: 'blob' },
        ),
        api.post(
          `/projects/${projectId}/groups/${groupId}/images/${previewImageId}/apply-filter/`,
          { filter_name: selectedFilter, params },
        ),
      ])

      setPreviewUrls((prev) => {
        for (const u of Object.values(prev)) {
          if (u) URL.revokeObjectURL(u)
        }
        return {
          result: URL.createObjectURL(resultResp.data as Blob),
          original_boxes: URL.createObjectURL(origResp.data as Blob),
          debug: URL.createObjectURL(debugResp.data as Blob),
        }
      })
      setPreviewCount(typeof countResp.data?.count === 'number' ? countResp.data.count : null)
    } catch {
      setPreviewCount(null)
    } finally {
      setPreviewLoading(false)
    }
  }, [selectedFilter, previewImageId, projectId, groupId, params])

  useEffect(() => {
    if (!selectedFilter || !previewImageId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchPreview()
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [params, selectedFilter, previewImageId])

  function handleSelectFilter(name: string) {
    setSelectedFilter(name)
    setPreviewUrls({ result: null, original_boxes: null, debug: null })
    setPreviewCount(null)
    setModelClasses([])
    setClassMap({})
  }

  function handleParamChange(key: string, value: number | string) {
    setParams((p) => ({ ...p, [key]: value }))
  }

  function handleSave() {
    onSave(selectedFilter, params)
    onClose()
  }

  function handleClear() {
    onSave('', {})
    onClose()
  }

  function handleClassMapChange(modelClass: string, projectClass: string) {
    setClassMap((prev) => {
      const next = { ...prev }
      if (projectClass) {
        next[modelClass] = projectClass
      } else {
        delete next[modelClass]
      }
      return next
    })
  }

  if (!open) return null

  const currentPreviewUrl = previewUrls[previewMode]
  const labelMode = isYoloFilter ? String(params.label_mode ?? 'single') : ''

  return (
    <dialog
      ref={dialogRef}
      className="robolabel-dialog h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-h-[min(calc(100vh-3rem),100dvh)] max-w-[110rem] rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-black/50"
      onCancel={onClose}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-slate-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">
              <i className="fa-solid fa-filter mr-2 text-teal-500" aria-hidden />
              Filtro de detección
            </h2>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={onClose}
            >
              <i className="fa-solid fa-xmark text-lg" aria-hidden />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar: filter select + params (scrollable) */}
          <div className="flex w-80 shrink-0 flex-col border-r border-slate-200">
            <div className="overflow-y-auto p-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Filtro</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  value={selectedFilter}
                  onChange={(e) => handleSelectFilter(e.target.value)}
                >
                  <option value="">Ninguno</option>
                  {availableFilters.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.display_name}
                    </option>
                  ))}
                </select>
              </div>

              {activeDef && (
                <div className="mt-4 space-y-3">
                  {activeDef.param_specs
                    .filter((spec) => !['class_map', 'single_class_name'].includes(spec.key))
                    .map((spec) => (
                    <div key={spec.key}>
                      {spec.param_type === 'select' && (
                        <>
                          <label className="text-xs font-medium text-slate-700">{spec.label}</label>
                          <select
                            className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            value={String(params[spec.key] ?? spec.default)}
                            onChange={(e) => handleParamChange(spec.key, e.target.value)}
                          >
                            {(spec.options ?? []).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-0.5 text-[0.625rem] leading-tight text-slate-400">{spec.help}</p>
                        </>
                      )}
                      {spec.param_type === 'bool' && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Number(params[spec.key] ?? spec.default) === 1}
                            onChange={(e) => handleParamChange(spec.key, e.target.checked ? 1 : 0)}
                            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <span className="text-xs font-medium text-slate-700">{spec.label}</span>
                          <span className="text-[0.6rem] text-slate-400" title={spec.help}>
                            <i className="fa-solid fa-circle-info" aria-hidden />
                          </span>
                        </label>
                      )}
                      {(spec.param_type === 'int' || spec.param_type === 'float') && (
                        <>
                          <div className="flex items-baseline justify-between">
                            <label className="text-xs font-medium text-slate-700">{spec.label}</label>
                            <span className="text-xs font-mono font-semibold text-teal-700">
                              {params[spec.key] ?? spec.default}
                              {spec.unit ?? ''}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={spec.min_val ?? 0}
                            max={spec.max_val ?? 100}
                            step={spec.step ?? 1}
                            value={Number(params[spec.key] ?? spec.default)}
                            onChange={(e) => handleParamChange(spec.key, Number(e.target.value))}
                            className="mt-0.5 w-full accent-teal-600"
                          />
                          <p className="mt-0.5 text-[0.625rem] leading-tight text-slate-400">{spec.help}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* YOLO label assignment — mode-specific UI */}
              {isYoloFilter && labelMode === 'single' && (
                <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
                  <h3 className="text-xs font-semibold text-slate-700">
                    <i className="fa-solid fa-tag mr-1" aria-hidden />
                    Etiqueta única
                  </h3>
                  <p className="mt-1 text-[0.6rem] text-slate-400">
                    Todas las detecciones del modelo usarán esta clase.
                  </p>
                  <select
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={String(params.single_class_name ?? '')}
                    onChange={(e) => handleParamChange('single_class_name', e.target.value)}
                  >
                    <option value="">(seleccionar clase…)</option>
                    {projectClasses.map((pc) => (
                      <option key={pc.id} value={pc.name}>
                        {pc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isYoloFilter && labelMode === 'map' && modelClasses.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h3 className="text-xs font-semibold text-slate-700">
                    <i className="fa-solid fa-table-list mr-1" aria-hidden />
                    Tabla de equivalencias
                  </h3>
                  <p className="mt-1 text-[0.6rem] text-slate-400">
                    Mapea cada clase del modelo a una clase de tu proyecto. Deja vacío para usar el nombre original.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {modelClasses.map((mc) => (
                      <div key={mc} className="flex items-center gap-2">
                        <span className="w-24 truncate text-[0.7rem] font-medium text-slate-600" title={mc}>
                          {mc}
                        </span>
                        <i className="fa-solid fa-arrow-right text-[0.55rem] text-slate-400" aria-hidden />
                        <select
                          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[0.7rem] focus:border-teal-500 focus:outline-none"
                          value={classMap[mc] ?? ''}
                          onChange={(e) => handleClassMapChange(mc, e.target.value)}
                        >
                          <option value="">(sin cambio)</option>
                          {projectClasses.map((pc) => (
                            <option key={pc.id} value={pc.name}>
                              {pc.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isYoloFilter && labelMode === 'model' && modelClasses.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h3 className="text-xs font-semibold text-slate-700">
                    <i className="fa-solid fa-brain mr-1" aria-hidden />
                    Clases del modelo
                  </h3>
                  <p className="mt-1 text-[0.6rem] text-slate-400">
                    Las detecciones usarán los nombres de clase del modelo. Asegurate de que existan como clases en tu proyecto.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {modelClasses.map((mc) => (
                      <span key={mc} className="rounded-md bg-white px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-600 border border-slate-200">
                        {mc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedFilter && (
                <div className="mt-5">
                  <label className="block text-sm font-medium text-slate-700">Imagen de muestra</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={previewImageId ?? ''}
                    onChange={(e) => {
                      setPreviewImageId(Number(e.target.value))
                      setPreviewUrls({ result: null, original_boxes: null, debug: null })
                      setPreviewCount(null)
                    }}
                  >
                    {groupImages.map((im) => (
                      <option key={im.id} value={im.id}>
                        {im.original_filename}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Right area: preview */}
          {selectedFilter ? (
            <div className="flex min-w-0 flex-1 flex-col">
              {/* View mode tabs */}
              <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-4 py-2">
                {PREVIEW_TABS.map((tab) => (
                  <button
                    key={tab.mode}
                    type="button"
                    title={tab.help}
                    onClick={() => setPreviewMode(tab.mode)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                      previewMode === tab.mode
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <i className={tab.icon} aria-hidden />
                    {tab.label}
                  </button>
                ))}
                {previewCount !== null && (
                  <span className="ml-auto text-sm font-medium text-teal-700">
                    {previewCount} objeto{previewCount !== 1 ? 's' : ''} detectado{previewCount !== 1 ? 's' : ''}
                  </span>
                )}
                {previewLoading && (
                  <i className="fa-solid fa-spinner fa-spin ml-2 text-teal-600" aria-hidden />
                )}
              </div>

              {/* Image preview area */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-900/95 p-2">
                {previewLoading && !currentPreviewUrl && (
                  <div className="flex flex-col items-center gap-2">
                    <i className="fa-solid fa-spinner fa-spin text-2xl text-teal-400" aria-hidden />
                    <span className="text-sm text-slate-400">Procesando…</span>
                  </div>
                )}
                {currentPreviewUrl ? (
                  <img
                    src={currentPreviewUrl}
                    alt={`Vista previa — ${PREVIEW_TABS.find((t) => t.mode === previewMode)?.label}`}
                    className={`max-h-full object-contain ${previewMode === 'debug' ? 'w-full' : 'max-w-full'}`}
                    style={{ imageRendering: previewMode === 'debug' ? 'auto' : undefined }}
                  />
                ) : !previewLoading ? (
                  <p className="text-sm text-slate-500">
                    {groupImages.length === 0
                      ? 'No hay imágenes en el grupo'
                      : 'Ajusta parámetros para ver la vista previa'}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center">
              <div className="text-center">
                <i className="fa-solid fa-filter text-4xl text-slate-300" aria-hidden />
                <p className="mt-3 text-sm text-slate-400">Selecciona un filtro para comenzar</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-6 py-3">
          <button
            type="button"
            className="text-[0.8125rem] text-slate-500 hover:text-slate-700 hover:underline"
            onClick={handleClear}
          >
            Quitar filtro
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[0.8125rem] font-medium text-slate-600 shadow-sm hover:bg-slate-50"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-teal-700"
              onClick={handleSave}
            >
              <i className="fa-solid fa-check" aria-hidden />
              Guardar configuración
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
