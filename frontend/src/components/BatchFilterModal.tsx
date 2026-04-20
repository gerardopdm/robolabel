import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api/client'
import { apiErrorMessage } from '../utils/apiErrorMessage'

type LabelClassOption = { id: number; name: string }

type ImageSummary = {
  id: number
  original_filename: string
  file_url: string
  width_px: number
  height_px: number
}

type DetectionResult = {
  label_class_id: number
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class_name?: string
}

type ImageResult = {
  image: ImageSummary
  status: 'pending' | 'processing' | 'done' | 'error'
  detections: DetectionResult[]
  error?: string
  /** Filtro OK pero falló guardar en el servidor */
  persistError?: string
}

type Props = {
  open: boolean
  projectId: string
  groupId: string
  filterName: string
  filterParams: Record<string, number | string>
  labelClasses: LabelClassOption[]
  onClose: () => void
  onFinished?: () => void
}

function buildReplacePayload(
  detections: DetectionResult[],
  widthPx: number,
  heightPx: number,
  defaultClassId: number,
  classNameMap: Map<string, number>,
): Array<{ label_class_id: number; x: string; y: string; width: string; height: string }> {
  return detections.map((d) => {
    let labelId = d.label_class_id
    if (d.class_name) {
      const resolved = classNameMap.get(d.class_name.toLowerCase())
      if (resolved) labelId = resolved
    }
    if (!labelId || labelId === 0) labelId = defaultClassId
    const x = Math.round(d.x * widthPx * 10000) / 10000
    const y = Math.round(d.y * heightPx * 10000) / 10000
    const w = Math.round(d.width * widthPx * 10000) / 10000
    const h = Math.round(d.height * heightPx * 10000) / 10000
    return {
      label_class_id: labelId,
      x: x.toFixed(4),
      y: y.toFixed(4),
      width: w.toFixed(4),
      height: h.toFixed(4),
    }
  })
}

export default function BatchFilterModal({
  open,
  projectId,
  groupId,
  filterName,
  filterParams,
  labelClasses,
  onClose,
  onFinished,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const abortRef = useRef(false)
  const [results, setResults] = useState<ImageResult[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [totalImages, setTotalImages] = useState(0)
  const [loadingImages, setLoadingImages] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null)

  const classNameMap = useMemo(
    () => new Map(labelClasses.map((c) => [c.name.toLowerCase(), c.id])),
    [labelClasses],
  )

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    if (!open) {
      abortRef.current = true
      setResults([])
      setRunning(false)
      setDone(false)
      setCurrentIndex(-1)
      setTotalImages(0)
      setErrorMsg(null)
      return
    }
    setSelectedClassId((prev) => {
      if (prev != null && labelClasses.some((c) => c.id === prev)) return prev
      return labelClasses[0]?.id ?? null
    })
  }, [open, labelClasses])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [results, currentIndex])

  const fetchAllImages = useCallback(async (): Promise<ImageSummary[]> => {
    const all: ImageSummary[] = []
    let page = 1
    const pageSize = 200
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await api.get(`/projects/${projectId}/groups/${groupId}/images/`, {
        params: { page, page_size: pageSize },
      })
      const list = r.data.results ?? r.data
      if (Array.isArray(list)) {
        for (const row of list) {
          const o = row as Record<string, unknown>
          const id = Number(o.id)
          const w = Number(o.width_px)
          const h = Number(o.height_px)
          if (!Number.isFinite(id) || !Number.isFinite(w) || !Number.isFinite(h)) continue
          all.push({
            id,
            original_filename: String(o.original_filename ?? ''),
            file_url: String(o.file_url ?? ''),
            width_px: w,
            height_px: h,
          })
        }
      }
      const count = typeof r.data.count === 'number' ? r.data.count : all.length
      const rawLen = Array.isArray(list) ? list.length : 0
      if (all.length >= count || rawLen < pageSize) break
      page++
    }
    return all
  }, [projectId, groupId])

  const startBatch = useCallback(async () => {
    if (!filterName) {
      setErrorMsg('No hay un filtro configurado en este grupo.')
      return
    }
    if (!labelClasses.length || selectedClassId == null) {
      setErrorMsg('El proyecto no tiene clases de etiqueta. Creá al menos una clase antes.')
      return
    }
    abortRef.current = false
    setRunning(true)
    setDone(false)
    setErrorMsg(null)
    setResults([])
    setCurrentIndex(-1)
    setLoadingImages(true)

    let images: ImageSummary[]
    try {
      images = await fetchAllImages()
    } catch {
      setErrorMsg('Error al obtener la lista de imágenes del grupo.')
      setRunning(false)
      setLoadingImages(false)
      return
    }
    setLoadingImages(false)

    if (images.length === 0) {
      setErrorMsg('No hay imágenes en este grupo.')
      setRunning(false)
      return
    }

    setTotalImages(images.length)
    const initial: ImageResult[] = images.map((img) => ({
      image: img,
      status: 'pending',
      detections: [],
    }))
    setResults(initial)

    for (let i = 0; i < images.length; i++) {
      if (abortRef.current) break
      setCurrentIndex(i)
      setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'processing' } : r)))

      try {
        const resp = await api.post(
          `/projects/${projectId}/groups/${groupId}/images/${images[i].id}/apply-filter/`,
          { filter_name: filterName, params: filterParams, label_class_id: selectedClassId },
        )
        const detections: DetectionResult[] = resp.data.detections ?? []
        const payload = buildReplacePayload(
          detections,
          images[i].width_px,
          images[i].height_px,
          selectedClassId,
          classNameMap,
        )
        try {
          await api.put(
            `/projects/${projectId}/groups/${groupId}/images/${images[i].id}/annotations/replace/`,
            payload,
          )
          setResults((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: 'done', detections } : r)),
          )
        } catch (saveErr) {
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    status: 'done',
                    detections,
                    persistError: apiErrorMessage(saveErr, 'Error al guardar anotaciones'),
                  }
                : r,
            ),
          )
        }
      } catch {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: 'error', error: 'Error al aplicar filtro' } : r,
          ),
        )
      }
    }

    setRunning(false)
    setDone(true)
    onFinished?.()
  }, [
    filterName,
    filterParams,
    projectId,
    groupId,
    fetchAllImages,
    onFinished,
    labelClasses.length,
    selectedClassId,
    classNameMap,
  ])

  const handleCancel = () => {
    abortRef.current = true
  }

  const handleClose = () => {
    abortRef.current = true
    onClose()
  }

  const processedCount = results.filter((r) => r.status === 'done' || r.status === 'error').length
  const errorCount = results.filter((r) => r.status === 'error').length
  const persistFailCount = results.filter((r) => r.status === 'done' && r.persistError).length
  const totalDetections = results.reduce((sum, r) => sum + r.detections.length, 0)
  const progressPct = totalImages > 0 ? Math.round((processedCount / totalImages) * 100) : 0

  if (!open) return null

  const canStart = Boolean(labelClasses.length && selectedClassId != null)

  return (
    <dialog
      ref={dialogRef}
      className="robolabel-dialog max-h-[min(90vh,calc(100dvh-2rem))] w-full max-w-3xl rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-black/50"
      onCancel={(e) => {
        e.preventDefault()
        handleClose()
      }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-800">
          Aplicar filtro a todas las imágenes
        </h2>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Cerrar"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-6 py-4">
        {!running && !done && !errorMsg && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Se aplicará el filtro <span className="font-semibold text-slate-800">{filterName}</span> a
              todas las imágenes del grupo. Las detecciones se guardarán como anotaciones (reemplazan las
              existentes en cada imagen). Esto puede tardar varios minutos.
            </p>
            <div>
              <label htmlFor="batch-filter-class" className="block text-xs font-medium text-slate-600">
                Clase por defecto (y para modelos YOLO sin mapeo por nombre)
              </label>
              <select
                id="batch-filter-class"
                value={selectedClassId ?? ''}
                onChange={(e) => setSelectedClassId(Number(e.target.value))}
                disabled={!labelClasses.length}
                className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {labelClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Si el filtro usa nombres de clase (p. ej. YOLO), se intentará mapear al nombre de la clase del
              proyecto; si no hay coincidencia, se usa la clase elegida arriba.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void startBatch()}
                disabled={!canStart}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className="fa-solid fa-play mr-1.5" aria-hidden />
                Iniciar proceso
              </button>
            </div>
          </div>
        )}

        {errorMsg && !running && (
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {errorMsg}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {(running || done) && (
          <div className="space-y-4">
            {loadingImages ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Cargando lista de imágenes…
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-medium text-slate-800">
                    {processedCount} / {totalImages} imágenes
                  </span>
                  <span className="text-teal-700">
                    {totalDetections} detecciones guardadas
                  </span>
                  {errorCount > 0 && (
                    <span className="text-rose-600">{errorCount} errores de filtro</span>
                  )}
                  {persistFailCount > 0 && (
                    <span className="text-amber-700">{persistFailCount} sin guardar</span>
                  )}
                  {running && (
                    <span className="text-xs text-slate-500">
                      {progressPct}% completado
                    </span>
                  )}
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div
                  ref={scrollRef}
                  className="max-h-[50vh] space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  {results.map((r, idx) => {
                    const rowWarn = r.status === 'done' && r.persistError
                    return (
                      <div
                        key={r.image.id}
                        className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          r.status === 'processing'
                            ? 'border-sky-200 bg-sky-50'
                            : r.status === 'done' && !rowWarn
                              ? 'border-slate-200 bg-white'
                              : r.status === 'done' && rowWarn
                                ? 'border-amber-200 bg-amber-50'
                                : r.status === 'error'
                                  ? 'border-rose-200 bg-rose-50'
                                  : 'border-transparent bg-transparent'
                        }`}
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                          {r.status === 'pending' && (
                            <span className="text-slate-400">
                              <i className="fa-regular fa-circle text-xs" />
                            </span>
                          )}
                          {r.status === 'processing' && (
                            <svg className="h-4 w-4 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                          )}
                          {r.status === 'done' && !rowWarn && (
                            <i className="fa-solid fa-circle-check text-teal-500" />
                          )}
                          {r.status === 'done' && rowWarn && (
                            <i className="fa-solid fa-triangle-exclamation text-amber-600" title={r.persistError} />
                          )}
                          {r.status === 'error' && (
                            <i className="fa-solid fa-circle-xmark text-rose-500" />
                          )}
                        </div>

                        <span className="min-w-0 flex-1 truncate text-slate-700">
                          {r.image.original_filename}
                        </span>

                        {r.status === 'done' && (
                          <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-800">
                            {r.detections.length} {r.detections.length === 1 ? 'etiqueta' : 'etiquetas'}
                          </span>
                        )}

                        {r.status === 'error' && (
                          <span className="shrink-0 text-xs text-rose-600">{r.error}</span>
                        )}

                        {rowWarn && (
                          <span className="min-w-0 flex-[1_1_100%] text-xs text-amber-800 sm:flex-[0_1_auto]">
                            {r.persistError}
                          </span>
                        )}

                        {r.status === 'pending' && (
                          <span className="shrink-0 text-xs text-slate-400">#{idx + 1}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {done && (
                  <span className="font-medium text-teal-700">
                    Proceso finalizado
                    {abortRef.current && processedCount < totalImages ? ' (cancelado)' : ''}
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                {running && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-lg border border-rose-200 px-4 py-2 text-sm text-rose-700 hover:bg-rose-50"
                  >
                    Detener
                  </button>
                )}
                {done && (
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Cerrar
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}
