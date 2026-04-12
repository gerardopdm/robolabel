import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'
import AuthenticatedImage from '../components/AuthenticatedImage'
import FindSimilarModal, { DEFAULT_PARAMS, type SimilarityParams } from '../components/FindSimilarModal'
import { useAuth } from '../contexts/AuthContext'
import { colorForLabelClass, pickDistinctColor } from '../utils/labelColors'
import { apiErrorMessage } from '../utils/apiErrorMessage'

type LabelClass = { id: number; name: string; color_hex: string }
type Ann = {
  label_class: number
  x: string
  y: string
  width: string
  height: string
}
type Suggestion = Ann & { confidence: number }
type Img = {
  id: number
  status: string
  width_px: number
  height_px: number
  discarded_for_dataset?: boolean
}

function parseLabelClassId(raw: unknown): number {
  if (raw == null) return 0
  if (typeof raw === 'object' && raw !== null && 'id' in raw) return Number((raw as { id: number }).id)
  return Number(raw)
}

export default function AnnotatePage() {
  const { projectId, groupId, imageId } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const canValidate = Boolean(user?.is_administrador || user?.is_validador)
  /** Etiquetador envía a validación; administrador puede cerrar como completada desde el lienzo. */
  const statusWhenLabelingDone = user?.is_administrador ? 'completed' : 'pending_validation'

  const imgRef = useRef<HTMLImageElement>(null)
  const activeClassIdRef = useRef<number | null>(null)
  const dragRef = useRef<{ ax: number; ay: number; bx: number; by: number } | null>(null)

  const [imgMeta, setImgMeta] = useState<Img | null>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [classes, setClasses] = useState<LabelClass[]>([])
  const [annotations, setAnnotations] = useState<Ann[]>([])
  const [activeClassId, setActiveClassId] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const objectListItemRefs = useRef<Map<number, HTMLLIElement | null>>(new Map())
  const [neighbors, setNeighbors] = useState<{ previous: number | null; next: number | null }>({
    previous: null,
    next: null,
  })
  const [dirty, setDirty] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(null)
  const [moveInfo, setMoveInfo] = useState<{
    annIdx: number; startX: number; startY: number; origX: number; origY: number
  } | null>(null)
  const [resizeInfo, setResizeInfo] = useState<{
    annIdx: number; anchorX: number; anchorY: number
  } | null>(null)
  const [newClassName, setNewClassName] = useState('')
  const [warnNoClass, setWarnNoClass] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [discardError, setDiscardError] = useState<string | null>(null)
  const [discardSaving, setDiscardSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [findingSimilar, setFindingSimilar] = useState(false)
  const [similarError, setSimilarError] = useState<string | null>(null)
  const [showSimilarModal, setShowSimilarModal] = useState(false)
  const [showHotkeysHelp, setShowHotkeysHelp] = useState(false)
  const similarParamsRef = useRef<SimilarityParams>({ ...DEFAULT_PARAMS })

  /** Herramientas de etiquetado (rectángulos, guardar, clases) según rol y estado de la imagen. */
  const canModifyAnnotations = useMemo(() => {
    if (!imgMeta) return false
    const s = imgMeta.status
    if (user?.is_administrador) return true
    if (user?.is_validador && s === 'pending_validation') return true
    if (user?.is_etiquetador && (s === 'pending' || s === 'in_progress' || s === 'rejected')) return true
    return false
  }, [imgMeta, user])
  /** Crear nuevas clases en el proyecto (solo admin/asignador/etiquetador). */
  const canCreateLabelClass = Boolean(
    user?.is_administrador || user?.is_asignador || user?.is_etiquetador,
  )
  /** Atajos de completar, similares y sugerencias (flujo etiquetador). */
  const canUseLabelerShortcuts = Boolean(user?.is_administrador || user?.is_etiquetador)
  const canSendToValidationOrComplete = Boolean(
    imgMeta &&
      (user?.is_administrador ||
        (user?.is_etiquetador &&
          ['pending', 'in_progress', 'rejected'].includes(imgMeta.status))),
  )

  const nw = natural.w || imgMeta?.width_px || 1
  const nh = natural.h || imgMeta?.height_px || 1

  useEffect(() => {
    activeClassIdRef.current = activeClassId
  }, [activeClassId])

  const loadAll = useCallback(() => {
    if (!projectId || !groupId || !imageId) return
    const pid = Number(projectId)
    const gid = Number(groupId)
    const iid = Number(imageId)
    api.get<Img>(`/projects/${pid}/groups/${gid}/images/${iid}/`).then((r) => setImgMeta(r.data))
    api.get(`/projects/${pid}/classes/`).then((r) => {
      const list: LabelClass[] = r.data.results ?? r.data
      setClasses(list)
      setActiveClassId((prev) => prev ?? list[0]?.id ?? null)
    })
    api.get(`/projects/${pid}/groups/${gid}/images/${iid}/annotations/`).then((r) => {
      const raw = (r.data.results ?? r.data) as Record<string, unknown>[]
      setAnnotations(
        raw.map((a) => ({
          label_class: parseLabelClassId(a.label_class),
          x: String(a.x),
          y: String(a.y),
          width: String(a.width),
          height: String(a.height),
        })),
      )
    })
    api.get(`/images/${iid}/neighbors/`).then((r) => setNeighbors(r.data))
  }, [projectId, groupId, imageId])

  useEffect(() => {
    loadAll()
    setSuggestions([])
    setSimilarError(null)
  }, [loadAll])

  useEffect(() => {
    if (selected == null) return
    const el = objectListItemRefs.current.get(selected)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selected])

  const toImageCoords = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current
    if (!img || img.naturalWidth <= 0) return null
    const r = img.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    let x = ((clientX - r.left) / r.width) * img.naturalWidth
    let y = ((clientY - r.top) / r.height) * img.naturalHeight
    x = Math.max(0, Math.min(img.naturalWidth, x))
    y = Math.max(0, Math.min(img.naturalHeight, y))
    return { x, y }
  }, [])

  /** Inicio de trazo en el lienzo (solo botón principal) */
  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (!canModifyAnnotations || e.button !== 0 || moveInfo || resizeInfo) return
    if (!activeClassIdRef.current) {
      setWarnNoClass(true)
      setTimeout(() => setWarnNoClass(false), 3000)
      return
    }
    const p = toImageCoords(e.clientX, e.clientY)
    if (!p) return
    e.preventDefault()
    e.stopPropagation()
    setSelected(null)
    const d = { ax: p.x, ay: p.y, bx: p.x, by: p.y }
    dragRef.current = d
    setDrag(d)
  }

  /** Mover / soltar en toda la ventana mientras hay trazo activo */
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const p = toImageCoords(e.clientX, e.clientY)
      if (!p) return
      const cur = dragRef.current
      if (!cur) return
      const updated = { ...cur, bx: p.x, by: p.y }
      dragRef.current = updated
      setDrag(updated)
    }
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      const cid = activeClassIdRef.current
      const x = Math.min(d.ax, d.bx)
      const y = Math.min(d.ay, d.by)
      const w = Math.abs(d.bx - d.ax)
      const h = Math.abs(d.by - d.ay)
      if (cid && w >= 2 && h >= 2) {
        setAnnotations((prev) => [
          ...prev,
          {
            label_class: cid,
            x: String(x),
            y: String(y),
            width: String(w),
            height: String(h),
          },
        ])
        setDirty(true)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, toImageCoords])

  useEffect(() => {
    if (!moveInfo) return
    const { annIdx, startX, startY, origX, origY } = moveInfo
    const move = (e: PointerEvent) => {
      const p = toImageCoords(e.clientX, e.clientY)
      if (!p) return
      const nx = Math.max(0, origX + (p.x - startX))
      const ny = Math.max(0, origY + (p.y - startY))
      setAnnotations((prev) =>
        prev.map((a, i) => (i === annIdx ? { ...a, x: String(nx), y: String(ny) } : a)),
      )
    }
    const up = () => {
      setMoveInfo(null)
      setDirty(true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [moveInfo, toImageCoords])

  useEffect(() => {
    if (!resizeInfo) return
    const { annIdx, anchorX, anchorY } = resizeInfo
    const move = (e: PointerEvent) => {
      const p = toImageCoords(e.clientX, e.clientY)
      if (!p) return
      const x = Math.min(anchorX, p.x)
      const y = Math.min(anchorY, p.y)
      const w = Math.max(1, Math.abs(p.x - anchorX))
      const h = Math.max(1, Math.abs(p.y - anchorY))
      setAnnotations((prev) =>
        prev.map((a, i) =>
          i === annIdx ? { ...a, x: String(x), y: String(y), width: String(w), height: String(h) } : a,
        ),
      )
    }
    const up = () => {
      setResizeInfo(null)
      setDirty(true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [resizeInfo, toImageCoords])

  function buildPayload() {
    return annotations.map((a) => ({
      label_class_id: a.label_class,
      x: Number(a.x).toFixed(4),
      y: Number(a.y).toFixed(4),
      width: Number(a.width).toFixed(4),
      height: Number(a.height).toFixed(4),
    }))
  }

  async function save() {
    if (!projectId || !groupId || !imageId) return
    const pid = Number(projectId)
    const gid = Number(groupId)
    const iid = Number(imageId)
    await api.put(`/projects/${pid}/groups/${gid}/images/${iid}/annotations/replace/`, buildPayload())
    setDirty(false)
    loadAll()
  }

  async function saveQuiet() {
    if (!projectId || !groupId || !imageId || !dirty) return
    try {
      const pid = Number(projectId)
      const gid = Number(groupId)
      const iid = Number(imageId)
      await api.put(`/projects/${pid}/groups/${gid}/images/${iid}/annotations/replace/`, buildPayload())
      setDirty(false)
    } catch { /* no bloquear la navegación */ }
  }

  async function markComplete() {
    if (!projectId || !groupId || !imageId) return
    setCompleteError(null)
    try {
      await saveQuiet()
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, {
        status: statusWhenLabelingDone,
      })
      loadAll()
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'No se pudo actualizar el estado de la imagen.'))
    }
  }

  async function markInProgress() {
    if (!projectId || !groupId || !imageId) return
    setCompleteError(null)
    try {
      await saveQuiet()
      const reopen =
        imgMeta?.status === 'completed' &&
        user?.is_validador &&
        !user?.is_administrador
          ? 'pending_validation'
          : 'in_progress'
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, { status: reopen })
      loadAll()
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'No se pudo volver a marcar como en progreso.'))
    }
  }

  async function approveValidation() {
    if (!projectId || !groupId || !imageId) return
    setCompleteError(null)
    try {
      await saveQuiet()
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, { status: 'completed' })
      loadAll()
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'No se pudo aprobar la imagen.'))
    }
  }

  async function rejectValidation() {
    if (!projectId || !groupId || !imageId) return
    const comment = window.prompt('Comentario del rechazo (opcional):') ?? ''
    setCompleteError(null)
    try {
      await saveQuiet()
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, {
        status: 'rejected',
        validation_comment: comment,
      })
      loadAll()
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'No se pudo rechazar la imagen.'))
    }
  }

  /** Devuelve la imagen a edición del etiquetador (en progreso), sin marcarla como rechazada formalmente. */
  async function returnToLabelerForCorrection() {
    if (!projectId || !groupId || !imageId) return
    setCompleteError(null)
    try {
      await saveQuiet()
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, {
        status: 'in_progress',
      })
      loadAll()
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'No se pudo devolver la imagen al etiquetador.'))
    }
  }

  async function setDiscardedForDataset(value: boolean) {
    if (!projectId || !groupId || !imageId) return
    setDiscardError(null)
    setDiscardSaving(true)
    try {
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, {
        discarded_for_dataset: value,
      })
      setImgMeta((m) => (m ? { ...m, discarded_for_dataset: value } : null))
    } catch (err) {
      setDiscardError(apiErrorMessage(err, 'No se pudo actualizar el estado de descarte.'))
    } finally {
      setDiscardSaving(false)
    }
  }

  const markCompleteAndNext = useCallback(async () => {
    if (!projectId || !groupId || !imageId) return
    setCompleteError(null)
    try {
      if (dirty) {
        const pid = Number(projectId)
        const gid = Number(groupId)
        const iid = Number(imageId)
        await api.put(`/projects/${pid}/groups/${gid}/images/${iid}/annotations/replace/`, buildPayload())
        setDirty(false)
      }
      await api.patch(`/projects/${projectId}/groups/${groupId}/images/${imageId}/`, {
        status: statusWhenLabelingDone,
      })
      if (neighbors.next) {
        nav(`/projects/${projectId}/groups/${groupId}/annotate/${neighbors.next}`)
      } else {
        loadAll()
      }
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'No se pudo actualizar el estado de la imagen.'))
    }
  }, [
    projectId,
    groupId,
    imageId,
    neighbors.next,
    nav,
    loadAll,
    dirty,
    annotations,
    statusWhenLabelingDone,
  ])

  async function addQuickClass() {
    if (!projectId || !newClassName.trim()) return
    const { data } = await api.post<LabelClass>(`/projects/${projectId}/classes/`, {
      name: newClassName.trim(),
      color_hex: pickDistinctColor(classes.map((c) => c.color_hex)),
      sort_index: classes.length,
    })
    setClasses((c) => [...c, data])
    setActiveClassId(data.id)
    setNewClassName('')
  }

  async function findSimilar() {
    if (!projectId || !groupId || !imageId || !neighbors.previous) return
    setFindingSimilar(true)
    setSimilarError(null)
    setSuggestions([])
    try {
      const pid = Number(projectId)
      const gid = Number(groupId)
      const iid = Number(imageId)
      const { data } = await api.post(
        `/projects/${pid}/groups/${gid}/images/${iid}/find-similar/`,
        { source_image_id: neighbors.previous, ...similarParamsRef.current },
      )
      const detections = (data.detections ?? []) as {
        label_class_id: number; x: number; y: number; width: number; height: number; confidence: number
      }[]
      setSuggestions(
        detections.map((d) => ({
          label_class: d.label_class_id,
          x: String(d.x),
          y: String(d.y),
          width: String(d.width),
          height: String(d.height),
          confidence: d.confidence,
        })),
      )
    } catch (err) {
      setSimilarError(apiErrorMessage(err, 'Error al buscar objetos similares.'))
    } finally {
      setFindingSimilar(false)
    }
  }

  function acceptSuggestion(idx: number) {
    const s = suggestions[idx]
    if (!s) return
    setAnnotations((prev) => [
      ...prev,
      { label_class: s.label_class, x: s.x, y: s.y, width: s.width, height: s.height },
    ])
    setSuggestions((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  function acceptAllSuggestions() {
    setAnnotations((prev) => [
      ...prev,
      ...suggestions.map((s) => ({
        label_class: s.label_class,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
      })),
    ])
    setSuggestions([])
    setDirty(true)
  }

  function dismissSuggestion(idx: number) {
    setSuggestions((prev) => prev.filter((_, i) => i !== idx))
  }

  function dismissAllSuggestions() {
    setSuggestions([])
  }

  function onImgLoad() {
    const el = imgRef.current
    if (el?.naturalWidth) {
      setNatural({ w: el.naturalWidth, h: el.naturalHeight })
    }
  }

  async function goNeighbor(id: number | null) {
    if (!id || !projectId || !groupId) return
    await saveQuiet()
    nav(`/projects/${projectId}/groups/${groupId}/annotate/${id}`)
  }

  useEffect(() => {
    if (!showHotkeysHelp) return
    function onEsc(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        setShowHotkeysHelp(false)
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showHotkeysHelp])

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const tag = document.activeElement?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (!inField && ev.key === '?' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault()
        setShowHotkeysHelp((v) => !v)
        return
      }
      if (showHotkeysHelp) return
      if (!inField && (ev.key === 'p' || ev.key === 'P')) {
        ev.preventDefault()
        void goNeighbor(neighbors.previous)
        return
      }
      if (!inField && (ev.key === 'n' || ev.key === 'N')) {
        ev.preventDefault()
        void goNeighbor(neighbors.next)
        return
      }
      if (
        canSendToValidationOrComplete &&
        !inField &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        (ev.key === 'c' || ev.key === 'C')
      ) {
        ev.preventDefault()
        void markCompleteAndNext()
        return
      }
      if (
        canUseLabelerShortcuts &&
        !inField &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        (ev.key === 's' || ev.key === 'S') &&
        neighbors.previous != null &&
        !findingSimilar
      ) {
        ev.preventDefault()
        void findSimilar()
        return
      }
      if (
        canUseLabelerShortcuts &&
        !inField &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        (ev.key === 'a' || ev.key === 'A') &&
        suggestions.length > 0
      ) {
        ev.preventDefault()
        acceptAllSuggestions()
        return
      }
      if (!canModifyAnnotations) return
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (selected != null && document.activeElement?.tagName !== 'INPUT') {
          ev.preventDefault()
          setAnnotations((prev) => prev.filter((_, i) => i !== selected))
          setSelected(null)
          setDirty(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    canModifyAnnotations,
    canSendToValidationOrComplete,
    canUseLabelerShortcuts,
    selected,
    neighbors,
    markCompleteAndNext,
    findingSimilar,
    suggestions,
    showHotkeysHelp,
  ])

  const preview =
    drag &&
    (() => {
      const x = Math.min(drag.ax, drag.bx)
      const y = Math.min(drag.ay, drag.by)
      const w = Math.abs(drag.bx - drag.ax)
      const h = Math.abs(drag.by - drag.ay)
      return { x, y, w, h }
    })()

  const activeDrawColor =
    activeClassId != null ? colorForLabelClass(activeClassId, classes) : '#64748b'

  /** Grosor de trazo en px de pantalla (con vectorEffect nonScalingStroke) */
  const strokePx = 3
  const handleR = Math.max(7, Math.min(nw, nh) * 0.009)

  /** La última capa en el SVG recibe primero los eventos; la seleccionada va al final. */
  const annotationRenderOrder = useMemo(() => {
    const indices = annotations.map((_, i) => i)
    if (selected == null || selected < 0 || selected >= indices.length) return indices
    return [...indices.filter((i) => i !== selected), selected]
  }, [annotations, selected])

  return (
    <div className="-m-6 flex min-h-[calc(100vh-5rem)] flex-col bg-slate-50 font-sans text-sm text-slate-700">
      {/* Barra superior (alineada al prototipo) */}
      <header className="flex flex-wrap items-start gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="min-w-[12rem]">
          <h1 className="text-lg font-bold tracking-tight text-slate-800">Etiquetado</h1>
          <p className="mt-0.5 text-[0.8125rem] text-slate-500">
            <a
              href={`/projects/${projectId}/groups/${groupId}`}
              className="text-sky-600 hover:underline"
              onClick={(e) => {
                e.preventDefault()
                void saveQuiet().then(() => nav(`/projects/${projectId}/groups/${groupId}`))
              }}
            >
              ← Galería del grupo
            </a>
            {' · '}
            Imagen #{imageId}
            {imgMeta && (
              <span className="text-slate-400">
                {' '}
                · estado:{' '}
                <span className="font-medium text-slate-600">
                  {imgMeta.status === 'completed'
                    ? 'Completada'
                    : imgMeta.status === 'pending_validation'
                      ? 'En validación'
                      : imgMeta.status === 'rejected'
                        ? 'Rechazada'
                        : imgMeta.status === 'in_progress'
                          ? 'En progreso'
                          : 'Pendiente'}
                </span>
                {imgMeta.discarded_for_dataset ? (
                  <span className="text-slate-500">
                    {' '}
                    · <span className="font-medium text-amber-700">descartada para dataset</span>
                  </span>
                ) : null}
              </span>
            )}
          </p>
        </div>
        {(canModifyAnnotations || canValidate || canUseLabelerShortcuts) && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-y-2 gap-x-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {canModifyAnnotations && (
                <>
                  <div className="flex items-center gap-1">
                    <label htmlFor="classSelect" className="text-xs font-medium text-slate-500">
                      Clase (nueva caja)
                    </label>
                    {activeClassId != null && (
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded border border-black/15 shadow-inner"
                        style={{ backgroundColor: activeDrawColor }}
                        title="Color de esta clase en el lienzo"
                        aria-hidden
                      />
                    )}
                    <select
                      id="classSelect"
                      value={activeClassId ?? ''}
                      onChange={(e) => setActiveClassId(Number(e.target.value) || null)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[0.8125rem] focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    >
                      {classes.length === 0 && <option value="">— Sin clases —</option>}
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="hidden h-5 w-px bg-slate-200 sm:inline" aria-hidden />
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[0.8125rem] font-medium text-slate-600 shadow-sm hover:bg-slate-50"
                    onClick={() => void save()}
                  >
                    <i className="fa-solid fa-floppy-disk" aria-hidden />
                    Guardar
                  </button>
                </>
              )}
              {imgMeta?.status === 'pending_validation' && canValidate ? (
                <>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-600 px-2 py-1.5 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-emerald-700"
                    title="Marcar como validada y lista para exportar"
                    onClick={() => void approveValidation()}
                  >
                    <i className="fa-solid fa-check" aria-hidden />
                    Marcar como validada
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500 bg-amber-50 px-2 py-1.5 text-[0.8125rem] font-medium text-amber-900 shadow-sm hover:bg-amber-100"
                    title="Vuelve la imagen a edición para que el etiquetador corrija (sin rechazo formal)"
                    onClick={() => void returnToLabelerForCorrection()}
                  >
                    <i className="fa-solid fa-arrow-rotate-left" aria-hidden />
                    Devolver a edición
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500 bg-red-50 px-2 py-1.5 text-[0.8125rem] font-medium text-red-800 shadow-sm hover:bg-red-100"
                    title="Rechazo formal con comentario; el etiquetador verá la imagen como rechazada"
                    onClick={() => void rejectValidation()}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden />
                    Rechazar
                  </button>
                </>
              ) : imgMeta?.status === 'pending_validation' && user?.is_etiquetador && !canValidate ? (
                <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[0.8125rem] text-amber-900">
                  En revisión por validador
                </span>
              ) : imgMeta?.status === 'completed' ? (
                (user?.is_administrador || user?.is_validador) && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500 bg-amber-50 px-2 py-1.5 text-[0.8125rem] font-medium text-amber-900 shadow-sm hover:bg-amber-100"
                    title={
                      user?.is_validador && !user?.is_administrador
                        ? 'Reabrir para revisión'
                        : 'Volver a dejar la imagen en progreso'
                    }
                    onClick={() => void markInProgress()}
                  >
                    <i className="fa-solid fa-rotate-left" aria-hidden />
                    {user?.is_validador && !user?.is_administrador ? 'Reabrir' : 'En progreso'}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-sky-600 bg-sky-600 px-2 py-1.5 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-sky-700"
                  title={
                    user?.is_administrador
                      ? 'Marcar como completada (tecla C: completar e ir a la siguiente)'
                      : 'Enviar a validación (tecla C: enviar e ir a la siguiente)'
                  }
                  onClick={() => void markComplete()}
                >
                  {user?.is_administrador ? 'Completada' : 'Enviar a validación'}
                </button>
              )}
              {canUseLabelerShortcuts && neighbors.previous != null && (
                <span className="inline-flex">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-l-lg border border-violet-600 bg-violet-600 px-2 py-1.5 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
                    title="Buscar en esta imagen objetos similares a los de la imagen anterior"
                    disabled={findingSimilar}
                    onClick={() => void findSimilar()}
                  >
                    <i className={findingSimilar ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles'} aria-hidden />
                    {findingSimilar ? 'Buscando…' : 'Buscar similares'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-r-lg border border-l-0 border-violet-600 bg-violet-500 px-1.5 py-1.5 text-white hover:bg-violet-700"
                    title="Ajustar parámetros de detección"
                    onClick={() => setShowSimilarModal(true)}
                  >
                    <i className="fa-solid fa-gear text-[0.75rem]" aria-hidden />
                  </button>
                </span>
              )}
              {similarError && (
                <span className="max-w-[14rem] text-xs text-red-600" title={similarError}>
                  {similarError}
                </span>
              )}
              {completeError && (
                <span className="max-w-[14rem] text-xs text-red-600" title={completeError}>
                  {completeError}
                </span>
              )}
              {(user?.is_administrador || user?.is_asignador) && (
                <label
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[0.8125rem] text-slate-700 shadow-sm hover:bg-slate-50"
                  title="Las imágenes descartadas no se incluyen al exportar o generar el ZIP de entrenamiento (YOLO)."
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    checked={imgMeta?.discarded_for_dataset ?? false}
                    disabled={discardSaving || !imgMeta}
                    onChange={(e) => void setDiscardedForDataset(e.target.checked)}
                  />
                  <span className="font-medium">Descartar para el dataset</span>
                </label>
              )}
              {discardError && (
                <span className="max-w-[14rem] text-xs text-red-600" title={discardError}>
                  {discardError}
                </span>
              )}
              {dirty && <span className="text-xs text-amber-600">Sin guardar</span>}
              <span className="hidden h-5 w-px bg-slate-200 sm:inline" aria-hidden />
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                title="Alejar"
                onClick={() => setZoom((z) => Math.max(0.25, z / 1.15))}
              >
                <i className="fa-solid fa-minus" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                title="Acercar"
                onClick={() => setZoom((z) => Math.min(4, z * 1.15))}
              >
                <i className="fa-solid fa-plus" aria-hidden />
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[0.8125rem] shadow-sm hover:bg-slate-50"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[0.8125rem] text-slate-600 shadow-sm hover:bg-slate-50"
                title="Atajos de teclado (tecla ?)"
                onClick={() => setShowHotkeysHelp(true)}
              >
                <i className="fa-solid fa-keyboard" aria-hidden />
                <span className="hidden sm:inline">Atajos</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[0.8125rem] shadow-sm hover:bg-slate-50"
                title="Imagen anterior (tecla P)"
                onClick={() => void goNeighbor(neighbors.previous)}
              >
                <i className="fa-solid fa-arrow-left" aria-hidden />
                Anterior
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[0.8125rem] shadow-sm hover:bg-slate-50"
                title="Imagen siguiente (tecla N)"
                onClick={() => void goNeighbor(neighbors.next)}
              >
                Siguiente
                <i className="fa-solid fa-arrow-right" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </header>

      {imgMeta?.discarded_for_dataset && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Esta imagen está marcada como no relevante para el entrenamiento: no se incluirá al generar el dataset
          (exportación YOLO / versiones).
        </div>
      )}

      {warnNoClass && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          Crea o elige una clase en la barra superior antes de dibujar una caja.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_minmax(280px,320px)]">
        <section className="flex min-h-0 flex-col p-3" aria-label="Lienzo">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div
              className="relative min-h-[240px] flex-1 overflow-auto bg-slate-100"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey) return
                e.preventDefault()
                setZoom((z) => (e.deltaY > 0 ? Math.max(0.25, z / 1.08) : Math.min(4, z * 1.08)))
              }}
            >
              <div
                className="inline-block origin-top-left p-3"
                style={{ transform: `scale(${zoom})` }}
              >
                <div className="relative inline-block">
                  {imageId && (
                    <AuthenticatedImage
                      ref={imgRef}
                      imageId={Number(imageId)}
                      alt="Imagen a etiquetar"
                      className="min-h-[200px] min-w-[200px]"
                      imgClassName="pointer-events-none block max-h-[75vh] max-w-[min(100vw,1200px)] select-none"
                      onLoad={onImgLoad}
                    />
                  )}
                  {nw > 0 && nh > 0 && (
                    <svg
                      className="absolute left-0 top-0 h-full w-full touch-none"
                      viewBox={`0 0 ${nw} ${nh}`}
                      preserveAspectRatio="none"
                      onPointerDown={handleCanvasPointerDown}
                    >
                      {annotationRenderOrder.map((i) => {
                        const a = annotations[i]
                        const col = colorForLabelClass(a.label_class, classes)
                        const isSel = selected === i
                        const wStroke = isSel ? strokePx * 1.6 : strokePx
                        return (
                          <g key={i}>
                            {/* Contorno oscuro para contraste sobre cualquier fondo */}
                            <rect
                              x={a.x}
                              y={a.y}
                              width={a.width}
                              height={a.height}
                              fill="none"
                              stroke="rgba(15,23,42,0.55)"
                              strokeWidth={wStroke + 3}
                              vectorEffect="nonScalingStroke"
                              pointerEvents="none"
                            />
                            <rect
                              x={a.x}
                              y={a.y}
                              width={a.width}
                              height={a.height}
                              fill={col}
                              fillOpacity={isSel ? 0.28 : 0.18}
                              stroke={col}
                              strokeOpacity={1}
                              strokeWidth={wStroke}
                              vectorEffect="nonScalingStroke"
                              pointerEvents="all"
                              style={{ cursor: canModifyAnnotations ? 'move' : 'pointer' }}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                setSelected(i)
                                if (canModifyAnnotations) {
                                  const p = toImageCoords(e.clientX, e.clientY)
                                  if (p) {
                                    setMoveInfo({
                                      annIdx: i,
                                      startX: p.x,
                                      startY: p.y,
                                      origX: Number(a.x),
                                      origY: Number(a.y),
                                    })
                                  }
                                }
                              }}
                            />
                          </g>
                        )
                      })}
                      {suggestions.map((s, i) => {
                        const col = colorForLabelClass(s.label_class, classes)
                        return (
                          <g key={`sug-${i}`} opacity={0.75}>
                            <rect
                              x={s.x}
                              y={s.y}
                              width={s.width}
                              height={s.height}
                              fill={col}
                              fillOpacity={0.12}
                              stroke={col}
                              strokeOpacity={1}
                              strokeWidth={strokePx}
                              strokeDasharray="8 4"
                              vectorEffect="nonScalingStroke"
                              pointerEvents="all"
                              style={{ cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation()
                                acceptSuggestion(i)
                              }}
                            />
                          </g>
                        )
                      })}
                      {preview && preview.w > 0 && preview.h > 0 && (
                        <g>
                          <rect
                            x={preview.x}
                            y={preview.y}
                            width={preview.w}
                            height={preview.h}
                            fill="none"
                            stroke="rgba(15,23,42,0.5)"
                            strokeWidth={strokePx * 1.1 + 3}
                            vectorEffect="nonScalingStroke"
                            pointerEvents="none"
                          />
                          <rect
                            x={preview.x}
                            y={preview.y}
                            width={preview.w}
                            height={preview.h}
                            fill={activeDrawColor}
                            fillOpacity={0.22}
                            stroke={activeDrawColor}
                            strokeOpacity={1}
                            strokeWidth={strokePx * 1.1}
                            vectorEffect="nonScalingStroke"
                            pointerEvents="none"
                          />
                        </g>
                      )}
                      {selected != null && annotations[selected] && canModifyAnnotations && (() => {
                        const sa = annotations[selected]
                        const sx = Number(sa.x), sy = Number(sa.y)
                        const sw = Number(sa.width), sh = Number(sa.height)
                        const sCol = colorForLabelClass(sa.label_class, classes)
                        const corners: { id: string; cx: number; cy: number; aX: number; aY: number; cur: string }[] = [
                          { id: 'tl', cx: sx, cy: sy, aX: sx + sw, aY: sy + sh, cur: 'nwse-resize' },
                          { id: 'tr', cx: sx + sw, cy: sy, aX: sx, aY: sy + sh, cur: 'nesw-resize' },
                          { id: 'bl', cx: sx, cy: sy + sh, aX: sx + sw, aY: sy, cur: 'nesw-resize' },
                          { id: 'br', cx: sx + sw, cy: sy + sh, aX: sx, aY: sy, cur: 'nwse-resize' },
                        ]
                        return corners.map((corner) => (
                          <circle
                            key={corner.id}
                            cx={corner.cx}
                            cy={corner.cy}
                            r={handleR}
                            fill="white"
                            stroke={sCol}
                            strokeWidth={strokePx * 1.15}
                            vectorEffect="nonScalingStroke"
                            pointerEvents="all"
                            style={{ cursor: corner.cur }}
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              setResizeInfo({ annIdx: selected, anchorX: corner.aX, anchorY: corner.aY })
                            }}
                          />
                        ))
                      })()}
                    </svg>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-200 px-3 py-2 text-[0.6875rem] text-slate-500">
              <span>
                {annotations.length} objeto(s) · zoom {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="text-sky-600 hover:text-sky-800 hover:underline"
                onClick={() => setShowHotkeysHelp(true)}
              >
                Ver atajos de teclado (?)
              </button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-sky-100 lg:border-l lg:border-t-0">
          <h2 className="border-b border-sky-200 px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-sky-800">
            Objetos en esta imagen
          </h2>
          {canCreateLabelClass && canModifyAnnotations && (
            <div className="border-b border-sky-200 px-4 py-3">
              <label className="text-xs font-medium text-slate-600" htmlFor="quickClass">
                Nueva clase rápida
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="quickClass"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="ej. tornillo, pieza…"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[0.8125rem] focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  onKeyDown={(e) => e.key === 'Enter' && void addQuickClass()}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                  onClick={() => void addQuickClass()}
                >
                  Añadir
                </button>
              </div>
            </div>
          )}
          {selected != null && annotations[selected] && canModifyAnnotations && (
            <div className="border-b border-sky-200 px-4 py-3">
              <label className="text-xs font-medium text-slate-600">Clase de la caja seleccionada</label>
              <select
                value={annotations[selected].label_class}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setAnnotations((prev) =>
                    prev.map((a, i) => (i === selected ? { ...a, label_class: v } : a)),
                  )
                  setDirty(true)
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[0.8125rem]"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="border-b border-violet-300 bg-violet-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-violet-800">
                  Sugerencias ({suggestions.length})
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded bg-violet-600 px-2 py-0.5 text-[0.6875rem] font-medium text-white hover:bg-violet-700"
                    onClick={acceptAllSuggestions}
                  >
                    Aceptar todas
                  </button>
                  <button
                    type="button"
                    className="rounded bg-slate-200 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600 hover:bg-slate-300"
                    onClick={dismissAllSuggestions}
                  >
                    Descartar
                  </button>
                </div>
              </div>
              <ul className="mt-2 space-y-1.5">
                {suggestions.map((s, i) => {
                  const c = classes.find((x) => x.id === s.label_class)
                  const swatch = colorForLabelClass(s.label_class, classes)
                  return (
                    <li key={i} className="flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-[0.8125rem]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded border border-black/10"
                        style={{ backgroundColor: swatch }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-slate-800">{c?.name ?? '?'}</span>
                        <span className="ml-1 text-[0.6875rem] text-violet-500">
                          {Math.round(s.confidence * 100)}%
                        </span>
                      </span>
                      <button
                        type="button"
                        className="text-emerald-600 hover:text-emerald-700"
                        title="Aceptar"
                        onClick={() => acceptSuggestion(i)}
                      >
                        <i className="fa-solid fa-check" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-red-500"
                        title="Descartar"
                        onClick={() => dismissSuggestion(i)}
                      >
                        <i className="fa-solid fa-xmark" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {annotations.length === 0 && suggestions.length === 0 ? (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-slate-400">
                Dibuja rectángulos sobre la imagen. Elige una clase arriba antes de dibujar.
              </p>
            ) : (
              <ul className="space-y-2">
                {annotations.map((a, i) => {
                  const c = classes.find((x) => x.id === a.label_class)
                  const swatch = colorForLabelClass(a.label_class, classes)
                  const isActive = selected === i
                  return (
                    <li
                      key={i}
                      ref={(el) => {
                        if (el) objectListItemRefs.current.set(i, el)
                        else objectListItemRefs.current.delete(i)
                      }}
                    >
                      <button
                        type="button"
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => setSelected(i)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left text-[0.8125rem] shadow-sm transition-all hover:-translate-y-px hover:shadow-md ${
                          isActive
                            ? 'border-2 border-sky-600 bg-sky-50 shadow-lg ring-2 ring-sky-400/45 ring-offset-2 ring-offset-sky-100'
                            : 'border border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded border ${
                            isActive ? 'border-sky-600 ring-1 ring-sky-400' : 'border-black/10'
                          }`}
                          style={{ backgroundColor: swatch }}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`font-semibold ${isActive ? 'text-sky-900' : 'text-slate-800'}`}
                          >
                            {c?.name ?? '?'}
                          </span>
                          <span
                            className={`mt-0.5 block font-mono text-[0.6875rem] ${
                              isActive ? 'text-sky-800/90' : 'text-slate-500'
                            }`}
                          >
                            {Number(a.x).toFixed(0)},{Number(a.y).toFixed(0)} · {Number(a.width).toFixed(0)}×
                            {Number(a.height).toFixed(0)}
                          </span>
                        </span>
                        {isActive && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-white">
                            <i className="fa-solid fa-crosshairs text-[0.5625rem]" aria-hidden />
                            Activa
                          </span>
                        )}
                        {canModifyAnnotations && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="shrink-0 text-slate-400 hover:text-red-500"
                            onClick={(e) => {
                              e.stopPropagation()
                              setAnnotations((prev) => prev.filter((_, j) => j !== i))
                              setSelected(null)
                              setDirty(true)
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
                          >
                            <i className="fa-solid fa-trash" aria-hidden />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <FindSimilarModal
        open={showSimilarModal}
        currentParams={similarParamsRef.current}
        onClose={() => setShowSimilarModal(false)}
        onSave={(p) => { similarParamsRef.current = p }}
      />

      {showHotkeysHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="presentation"
          onClick={() => setShowHotkeysHelp(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hotkeys-title"
            className="max-h-[min(90vh,32rem)] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="hotkeys-title" className="text-base font-semibold text-slate-800">
                Atajos de teclado
              </h2>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar"
                onClick={() => setShowHotkeysHelp(false)}
              >
                <i className="fa-solid fa-xmark" aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Solo aplican cuando el foco no está en un campo de texto (excepto donde se indica).
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
                  Navegación
                </dt>
                <dd className="mt-1.5 space-y-1.5">
                  <HotkeyRow keys="P" desc="Imagen anterior" />
                  <HotkeyRow keys="N" desc="Imagen siguiente" />
                </dd>
              </div>
              {(canUseLabelerShortcuts || canModifyAnnotations) && (
                <div>
                  <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
                    Cajas y flujo
                  </dt>
                  <dd className="mt-1.5 space-y-1.5">
                    <HotkeyRow keys="Supr / Retroceso" desc="Eliminar la caja seleccionada" />
                    <HotkeyRow
                      keys="C"
                      desc="Completar (o enviar a validación) e ir a la siguiente imagen"
                    />
                    <HotkeyRow
                      keys="S"
                      desc="Buscar objetos similares a la imagen anterior (requiere imagen anterior)"
                    />
                    <HotkeyRow
                      keys="A"
                      desc="Aceptar todas las sugerencias de detección (si hay sugerencias)"
                    />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
                  Vista
                </dt>
                <dd className="mt-1.5 space-y-1.5">
                  <HotkeyRow
                    keys="Ctrl + rueda"
                    desc="Zoom en el lienzo (también ⌘ + rueda en macOS)"
                  />
                </dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
                  Ayuda
                </dt>
                <dd className="mt-1.5">
                  <HotkeyRow keys="?" desc="Abrir o cerrar esta ventana" />
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-center text-xs text-slate-400">Esc para cerrar</p>
          </div>
        </div>
      )}
    </div>
  )
}

function HotkeyRow({ keys, desc }: { keys: string; desc: string }) {
  const combo =
    keys.includes(' / ') ? (
      keys.split(' / ').map((part, i) => (
        <span key={`${part}-${i}`}>
          {i > 0 && <span className="mx-0.5 text-slate-400">/</span>}
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[0.8125rem] shadow-sm">
            {part}
          </kbd>
        </span>
      ))
    ) : (
      <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[0.8125rem] shadow-sm">
        {keys}
      </kbd>
    )
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="shrink-0 font-mono text-xs font-medium text-slate-700">{combo}</span>
      <span className="min-w-0 text-slate-600">{desc}</span>
    </div>
  )
}
