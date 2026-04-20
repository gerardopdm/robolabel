import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'
import FindSimilarModal, { DEFAULT_PARAMS, type SimilarityParams } from '../components/FindSimilarModal'
import { useAuth } from '../contexts/AuthContext'
import { colorForLabelClass, pickDistinctColor } from '../utils/labelColors'
import { apiErrorMessage } from '../utils/apiErrorMessage'
import AnnotateToolbar from '../components/annotate/AnnotateToolbar'
import AnnotateCanvas from '../components/annotate/AnnotateCanvas'
import ChangeAnnotationClassModal from '../components/annotate/ChangeAnnotationClassModal'
import ObjectSidebar from '../components/annotate/ObjectSidebar'

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
  const [changeClassAnnIdx, setChangeClassAnnIdx] = useState<number | null>(null)
  const [emphasizeSelectedOnly, setEmphasizeSelectedOnly] = useState(false)
  const similarParamsRef = useRef<SimilarityParams>({ ...DEFAULT_PARAMS })
  const [groupFilter, setGroupFilter] = useState<{ name: string; params: Record<string, number | string> }>({ name: '', params: {} })
  const [applyingFilter, setApplyingFilter] = useState(false)
  const [filterError, setFilterError] = useState<string | null>(null)

  const canModifyAnnotations = useMemo(() => {
    if (!imgMeta) return false
    const s = imgMeta.status
    if (user?.is_administrador) return true
    if (user?.is_validador && s === 'pending_validation') return true
    if (user?.is_etiquetador && (s === 'pending' || s === 'in_progress' || s === 'rejected')) return true
    return false
  }, [imgMeta, user])
  const canCreateLabelClass = Boolean(
    user?.is_administrador || user?.is_asignador || user?.is_etiquetador,
  )
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

  // ─── Data loading ───
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
    api
      .get<{ detection_filter?: string; detection_filter_params?: Record<string, number | string> }>(
        `/projects/${pid}/groups/${gid}/`,
      )
      .then((r) => {
        setGroupFilter({
          name: r.data.detection_filter ?? '',
          params: r.data.detection_filter_params ?? {},
        })
      })
  }, [projectId, groupId, imageId])

  useEffect(() => {
    loadAll()
    setSuggestions([])
    setSimilarError(null)
  }, [loadAll])

  // ─── Coordinate helpers ───
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

  // ─── Drawing ───
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
          { label_class: cid, x: String(x), y: String(y), width: String(w), height: String(h) },
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

  // ─── Move ───
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
    const up = () => { setMoveInfo(null); setDirty(true) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [moveInfo, toImageCoords])

  // ─── Resize ───
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
    const up = () => { setResizeInfo(null); setDirty(true) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [resizeInfo, toImageCoords])

  // ─── API actions ───
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
    projectId, groupId, imageId, neighbors.next,
    nav, loadAll, dirty, annotations, statusWhenLabelingDone,
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
          x: String(d.x), y: String(d.y),
          width: String(d.width), height: String(d.height),
          confidence: d.confidence,
        })),
      )
    } catch (err) {
      setSimilarError(apiErrorMessage(err, 'Error al buscar objetos similares.'))
    } finally {
      setFindingSimilar(false)
    }
  }

  async function applyGroupFilter() {
    if (!projectId || !groupId || !imageId || !groupFilter.name || !activeClassId) return
    setApplyingFilter(true)
    setFilterError(null)
    setSuggestions([])
    try {
      const pid = Number(projectId)
      const gid = Number(groupId)
      const iid = Number(imageId)
      const { data } = await api.post(
        `/projects/${pid}/groups/${gid}/images/${iid}/apply-filter/`,
        { filter_name: groupFilter.name, params: groupFilter.params, label_class_id: activeClassId },
      )
      const detections = (data.detections ?? []) as {
        label_class_id: number; x: number; y: number; width: number; height: number; confidence: number; class_name?: string
      }[]
      const classNameMap = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]))
      setSuggestions(
        detections.map((d) => {
          let labelId = d.label_class_id
          if (d.class_name) {
            const resolved = classNameMap.get(d.class_name.toLowerCase())
            if (resolved) labelId = resolved
          }
          if (!labelId || labelId === 0) labelId = activeClassId!
          return {
            label_class: labelId,
            x: String(Math.round(d.x * nw * 10000) / 10000),
            y: String(Math.round(d.y * nh * 10000) / 10000),
            width: String(Math.round(d.width * nw * 10000) / 10000),
            height: String(Math.round(d.height * nh * 10000) / 10000),
            confidence: d.confidence,
          }
        }),
      )
    } catch (err) {
      setFilterError(apiErrorMessage(err, 'Error al aplicar el filtro.'))
    } finally {
      setApplyingFilter(false)
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
        label_class: s.label_class, x: s.x, y: s.y, width: s.width, height: s.height,
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
    if (el?.naturalWidth) setNatural({ w: el.naturalWidth, h: el.naturalHeight })
  }

  async function goNeighbor(id: number | null) {
    if (!id || !projectId || !groupId) return
    await saveQuiet()
    nav(`/projects/${projectId}/groups/${groupId}/annotate/${id}`)
  }

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    if (!showHotkeysHelp) return
    function onEsc(ev: KeyboardEvent) {
      if (ev.key === 'Escape') { ev.preventDefault(); setShowHotkeysHelp(false) }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showHotkeysHelp])

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const tag = document.activeElement?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (!inField && ev.key === '?' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault(); setShowHotkeysHelp((v) => !v); return
      }
      if (showHotkeysHelp) return
      if (!inField && (ev.key === 'p' || ev.key === 'P')) { ev.preventDefault(); void goNeighbor(neighbors.previous); return }
      if (!inField && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); void goNeighbor(neighbors.next); return }
      if (canSendToValidationOrComplete && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === 'c' || ev.key === 'C')) {
        ev.preventDefault(); void markCompleteAndNext(); return
      }
      if (canUseLabelerShortcuts && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === 's' || ev.key === 'S') && neighbors.previous != null && !findingSimilar) {
        ev.preventDefault(); void findSimilar(); return
      }
      if (canUseLabelerShortcuts && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === 'a' || ev.key === 'A') && suggestions.length > 0) {
        ev.preventDefault(); acceptAllSuggestions(); return
      }
      if (canUseLabelerShortcuts && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === 'f' || ev.key === 'F') && groupFilter.name && activeClassId && !applyingFilter) {
        ev.preventDefault(); void applyGroupFilter(); return
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
    canModifyAnnotations, canSendToValidationOrComplete, canUseLabelerShortcuts,
    selected, neighbors, markCompleteAndNext, findingSimilar, suggestions, showHotkeysHelp,
    groupFilter.name, activeClassId, applyingFilter,
  ])

  // ─── Derived values ───
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

  const strokePx = 3
  const handleR = Math.max(7, Math.min(nw, nh) * 0.009)

  const annotationRenderOrder = useMemo(() => {
    const indices = annotations.map((_, i) => i)
    if (selected == null || selected < 0 || selected >= indices.length) return indices
    return [...indices.filter((i) => i !== selected), selected]
  }, [annotations, selected])

  // ─── Render ───
  return (
    <div className="-m-6 flex min-h-0 flex-1 flex-col bg-slate-50 font-sans text-sm text-slate-700">
      <AnnotateToolbar
        projectId={projectId}
        groupId={groupId}
        imageId={imageId}
        imgMeta={imgMeta}
        user={user}
        classes={classes}
        activeClassId={activeClassId}
        setActiveClassId={setActiveClassId}
        activeDrawColor={activeDrawColor}
        dirty={dirty}
        annotationsCount={annotations.length}
        zoom={zoom}
        setZoom={setZoom}
        emphasizeSelectedOnly={emphasizeSelectedOnly}
        setEmphasizeSelectedOnly={setEmphasizeSelectedOnly}
        canModifyAnnotations={canModifyAnnotations}
        canValidate={canValidate}
        canUseLabelerShortcuts={canUseLabelerShortcuts}
        neighbors={neighbors}
        findingSimilar={findingSimilar}
        applyingFilter={applyingFilter}
        groupFilterName={groupFilter.name}
        similarError={similarError}
        filterError={filterError}
        completeError={completeError}
        discardError={discardError}
        discardSaving={discardSaving}
        onSave={() => void save()}
        onGoNeighbor={(id) => void goNeighbor(id)}
        onSaveQuietAndNavigate={(url) => void saveQuiet().then(() => nav(url))}
        onShowHotkeys={() => setShowHotkeysHelp(true)}
        onShowSimilarModal={() => setShowSimilarModal(true)}
        onFindSimilar={() => void findSimilar()}
        onApplyGroupFilter={() => void applyGroupFilter()}
        onApproveValidation={() => void approveValidation()}
        onReturnToLabeler={() => void returnToLabelerForCorrection()}
        onRejectValidation={() => void rejectValidation()}
        onMarkComplete={() => void markComplete()}
        onMarkInProgress={() => void markInProgress()}
        onSetDiscarded={(v) => void setDiscardedForDataset(v)}
      />

      {imgMeta?.discarded_for_dataset && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Esta imagen está marcada como no relevante para el entrenamiento: no se incluirá al generar el dataset
          (exportación YOLO / versiones).
        </div>
      )}

      {warnNoClass && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          Crea o elige una clase en la barra superior antes de dibujar una caja.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-0 lg:grid-cols-[1fr_minmax(280px,320px)]">
        <AnnotateCanvas
          imageId={imageId}
          imgRef={imgRef}
          nw={nw}
          nh={nh}
          zoom={zoom}
          setZoom={setZoom}
          annotations={annotations}
          suggestions={suggestions}
          classes={classes}
          selected={selected}
          setSelected={setSelected}
          emphasizeSelectedOnly={emphasizeSelectedOnly}
          canModifyAnnotations={canModifyAnnotations}
          annotationRenderOrder={annotationRenderOrder}
          activeDrawColor={activeDrawColor}
          preview={preview}
          strokePx={strokePx}
          handleR={handleR}
          onImgLoad={onImgLoad}
          handleCanvasPointerDown={handleCanvasPointerDown}
          toImageCoords={toImageCoords}
          setMoveInfo={setMoveInfo}
          setResizeInfo={setResizeInfo}
          acceptSuggestion={acceptSuggestion}
          onAnnotationDoubleClick={
            canModifyAnnotations
              ? (i) => {
                  setSelected(i)
                  setChangeClassAnnIdx(i)
                }
              : undefined
          }
        />

        <ObjectSidebar
          classes={classes}
          annotations={annotations}
          suggestions={suggestions}
          selected={selected}
          setSelected={setSelected}
          setAnnotations={setAnnotations}
          setDirty={setDirty}
          canModifyAnnotations={canModifyAnnotations}
          canCreateLabelClass={canCreateLabelClass}
          newClassName={newClassName}
          setNewClassName={setNewClassName}
          addQuickClass={() => void addQuickClass()}
          acceptSuggestion={acceptSuggestion}
          acceptAllSuggestions={acceptAllSuggestions}
          dismissSuggestion={dismissSuggestion}
          dismissAllSuggestions={dismissAllSuggestions}
        />
      </div>

      <FindSimilarModal
        open={showSimilarModal}
        currentParams={similarParamsRef.current}
        onClose={() => setShowSimilarModal(false)}
        onSave={(p) => { similarParamsRef.current = p }}
      />

      <ChangeAnnotationClassModal
        open={changeClassAnnIdx !== null}
        classes={classes}
        currentClassId={
          changeClassAnnIdx != null && annotations[changeClassAnnIdx]
            ? annotations[changeClassAnnIdx].label_class
            : null
        }
        onClose={() => setChangeClassAnnIdx(null)}
        onConfirm={(labelClassId) => {
          if (changeClassAnnIdx == null) return
          const idx = changeClassAnnIdx
          setAnnotations((prev) =>
            prev.map((a, j) => (j === idx ? { ...a, label_class: labelClassId } : a)),
          )
          setDirty(true)
          setChangeClassAnnIdx(null)
        }}
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
              Solo aplican cuando el foco no está en un campo de texto.
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Navegación</dt>
                <dd className="mt-1.5 space-y-1.5">
                  <HotkeyRow keys="P" desc="Imagen anterior" />
                  <HotkeyRow keys="N" desc="Imagen siguiente" />
                </dd>
              </div>
              {(canUseLabelerShortcuts || canModifyAnnotations) && (
                <div>
                  <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Cajas y flujo</dt>
                  <dd className="mt-1.5 space-y-1.5">
                    {canModifyAnnotations && (
                      <HotkeyRow keys="Doble clic" desc="Cambiar la clase de un objeto (sobre su caja)" />
                    )}
                    <HotkeyRow keys="Supr / Retroceso" desc="Eliminar la caja seleccionada" />
                    <HotkeyRow keys="C" desc="Completar (o enviar a validación) e ir a la siguiente imagen" />
                    <HotkeyRow keys="S" desc="Buscar objetos similares a la imagen anterior" />
                    <HotkeyRow keys="F" desc="Aplicar filtro de detección del grupo" />
                    <HotkeyRow keys="A" desc="Aceptar todas las sugerencias de detección" />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Vista</dt>
                <dd className="mt-1.5 space-y-1.5">
                  <HotkeyRow keys="Ctrl + rueda" desc="Zoom en el lienzo" />
                </dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Ayuda</dt>
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
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[0.8125rem] shadow-sm">{part}</kbd>
        </span>
      ))
    ) : (
      <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[0.8125rem] shadow-sm">{keys}</kbd>
    )
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="shrink-0 font-mono text-xs font-medium text-slate-700">{combo}</span>
      <span className="min-w-0 text-slate-600">{desc}</span>
    </div>
  )
}
