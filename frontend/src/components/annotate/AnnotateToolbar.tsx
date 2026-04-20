import { useState, useRef, useEffect } from 'react'

type LabelClass = { id: number; name: string; color_hex: string }
type Img = {
  id: number
  status: string
  width_px: number
  height_px: number
  discarded_for_dataset?: boolean
}
type User = {
  is_administrador?: boolean
  is_validador?: boolean
  is_etiquetador?: boolean
  is_asignador?: boolean
}

export interface AnnotateToolbarProps {
  projectId: string | undefined
  groupId: string | undefined
  imageId: string | undefined
  imgMeta: Img | null
  user: User | null | undefined
  classes: LabelClass[]
  activeClassId: number | null
  setActiveClassId: (id: number | null) => void
  activeDrawColor: string
  dirty: boolean
  annotationsCount: number
  zoom: number
  setZoom: React.Dispatch<React.SetStateAction<number>>
  emphasizeSelectedOnly: boolean
  setEmphasizeSelectedOnly: (v: boolean) => void
  canModifyAnnotations: boolean
  canValidate: boolean
  canUseLabelerShortcuts: boolean
  neighbors: { previous: number | null; next: number | null }
  findingSimilar: boolean
  applyingFilter: boolean
  groupFilterName: string
  similarError: string | null
  filterError: string | null
  completeError: string | null
  discardError: string | null
  discardSaving: boolean
  onSave: () => void
  onGoNeighbor: (id: number | null) => void
  onSaveQuietAndNavigate: (url: string) => void
  onShowHotkeys: () => void
  onShowSimilarModal: () => void
  onFindSimilar: () => void
  onApplyGroupFilter: () => void
  onApproveValidation: () => void
  onReturnToLabeler: () => void
  onRejectValidation: () => void
  onMarkComplete: () => void
  onMarkInProgress: () => void
  onSetDiscarded: (v: boolean) => void
}

function statusLabel(status: string) {
  switch (status) {
    case 'completed': return 'Completada'
    case 'pending_validation': return 'En validación'
    case 'rejected': return 'Rechazada'
    case 'in_progress': return 'En progreso'
    default: return 'Pendiente'
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'completed': return 'text-emerald-700 bg-emerald-50 border-emerald-200'
    case 'pending_validation': return 'text-amber-700 bg-amber-50 border-amber-200'
    case 'rejected': return 'text-red-700 bg-red-50 border-red-200'
    case 'in_progress': return 'text-sky-700 bg-sky-50 border-sky-200'
    default: return 'text-slate-600 bg-slate-50 border-slate-200'
  }
}

export default function AnnotateToolbar(props: AnnotateToolbarProps) {
  const {
    projectId, groupId, imageId, imgMeta, user, classes,
    activeClassId, setActiveClassId, activeDrawColor, dirty, annotationsCount, zoom, setZoom,
    emphasizeSelectedOnly, setEmphasizeSelectedOnly,
    canModifyAnnotations, canValidate, canUseLabelerShortcuts,
    neighbors, findingSimilar, applyingFilter, groupFilterName,
    similarError, filterError, completeError, discardError, discardSaving,
    onSave, onGoNeighbor, onSaveQuietAndNavigate, onShowHotkeys,
    onShowSimilarModal, onFindSimilar, onApplyGroupFilter,
    onApproveValidation, onReturnToLabeler, onRejectValidation,
    onMarkComplete, onMarkInProgress, onSetDiscarded,
  } = props

  const [moreOpen, setMoreOpen] = useState(false)
  const [valDropdownOpen, setValDropdownOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const valRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
      if (valRef.current && !valRef.current.contains(e.target as Node)) setValDropdownOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const anyError = similarError || filterError || completeError || discardError

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white shadow-sm">
      {/* Fila 1: navegación y contexto */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <a
            href={`/projects/${projectId}/groups/${groupId}`}
            className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-sky-600 hover:text-sky-800 hover:underline"
            onClick={(e) => {
              e.preventDefault()
              onSaveQuietAndNavigate(`/projects/${projectId}/groups/${groupId}`)
            }}
          >
            <i className="fa-solid fa-arrow-left text-[0.6875rem]" aria-hidden />
            Galería
          </a>
          <span className="h-4 w-px bg-slate-200" aria-hidden />
          <span className="text-[0.8125rem] font-semibold text-slate-700">
            Imagen #{imageId}
          </span>
          {imgMeta && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ${statusColor(imgMeta.status)}`}>
              {statusLabel(imgMeta.status)}
            </span>
          )}
          {imgMeta?.discarded_for_dataset && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-700">
              <i className="fa-solid fa-eye-slash mr-1 text-[0.5625rem]" aria-hidden />
              Descartada
            </span>
          )}
          <span className="whitespace-nowrap text-[0.6875rem] text-slate-500 tabular-nums">
            {annotationsCount} objeto(s) · zoom {Math.round(zoom * 100)}%
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[0.8125rem] text-slate-500 shadow-sm hover:bg-slate-50"
            title="Atajos de teclado (?)"
            onClick={onShowHotkeys}
          >
            <i className="fa-solid fa-keyboard" aria-hidden />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            title="Imagen anterior (P)"
            disabled={!neighbors.previous}
            onClick={() => onGoNeighbor(neighbors.previous)}
          >
            <i className="fa-solid fa-chevron-left text-xs" aria-hidden />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            title="Imagen siguiente (N)"
            disabled={!neighbors.next}
            onClick={() => onGoNeighbor(neighbors.next)}
          >
            <i className="fa-solid fa-chevron-right text-xs" aria-hidden />
          </button>
        </div>
      </div>

      {/* Fila 2: herramientas de trabajo */}
      {(canModifyAnnotations || canValidate || canUseLabelerShortcuts) && (
        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-1.5">
          {/* Selector de clase */}
          {canModifyAnnotations && (
            <div className="flex items-center gap-1.5">
              {activeClassId != null && (
                <span
                  className="h-3 w-3 shrink-0 rounded border border-black/15"
                  style={{ backgroundColor: activeDrawColor }}
                  aria-hidden
                />
              )}
              <select
                value={activeClassId ?? ''}
                onChange={(e) => setActiveClassId(Number(e.target.value) || null)}
                className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[0.8125rem] focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-200"
              >
                {classes.length === 0 && <option value="">— Sin clases —</option>}
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Guardar (con indicador dirty) */}
          {canModifyAnnotations && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[0.8125rem] font-medium shadow-sm transition-colors ${
                dirty
                  ? 'border-amber-400 bg-amber-500 text-white hover:bg-amber-600'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              onClick={onSave}
              title={dirty ? 'Hay cambios sin guardar' : 'Guardar anotaciones'}
            >
              <i className="fa-solid fa-floppy-disk" aria-hidden />
              {dirty ? 'Guardar*' : 'Guardar'}
            </button>
          )}

          <span className="h-5 w-px bg-slate-200" aria-hidden />

          {/* Acciones de estado / validación */}
          {imgMeta?.status === 'pending_validation' && canValidate ? (
            <div className="relative" ref={valRef}>
              <span className="inline-flex">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-l-lg border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-emerald-700"
                  onClick={onApproveValidation}
                >
                  <i className="fa-solid fa-check" aria-hidden />
                  Validar
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-r-lg border border-l-0 border-emerald-600 bg-emerald-500 px-1.5 py-1 text-white hover:bg-emerald-700"
                  onClick={() => setValDropdownOpen((v) => !v)}
                  aria-label="Más acciones de validación"
                >
                  <i className="fa-solid fa-chevron-down text-[0.625rem]" aria-hidden />
                </button>
              </span>
              {valDropdownOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-[0.8125rem] text-amber-800 hover:bg-amber-50"
                    onClick={() => { setValDropdownOpen(false); onReturnToLabeler() }}
                  >
                    <i className="fa-solid fa-arrow-rotate-left text-xs" aria-hidden />
                    Devolver a edición
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-[0.8125rem] text-red-700 hover:bg-red-50"
                    onClick={() => { setValDropdownOpen(false); onRejectValidation() }}
                  >
                    <i className="fa-solid fa-xmark text-xs" aria-hidden />
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          ) : imgMeta?.status === 'pending_validation' && user?.is_etiquetador && !canValidate ? (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[0.8125rem] text-amber-900">
              En revisión
            </span>
          ) : imgMeta?.status === 'completed' ? (
            (user?.is_administrador || user?.is_validador) && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-[0.8125rem] font-medium text-amber-900 shadow-sm hover:bg-amber-100"
                onClick={onMarkInProgress}
              >
                <i className="fa-solid fa-rotate-left" aria-hidden />
                {user?.is_validador && !user?.is_administrador ? 'Reabrir' : 'En progreso'}
              </button>
            )
          ) : canModifyAnnotations ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-sky-600 bg-sky-600 px-2.5 py-1 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-sky-700"
              title={
                user?.is_administrador
                  ? 'Completar (C: completar e ir a la siguiente)'
                  : 'Enviar a validación (C: enviar e ir a la siguiente)'
              }
              onClick={onMarkComplete}
            >
              {user?.is_administrador ? 'Completada' : 'Enviar a validación'}
            </button>
          ) : null}

          {/* Zoom compacto */}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              title="Alejar"
              onClick={() => setZoom((z) => Math.max(0.25, z / 1.15))}
            >
              <i className="fa-solid fa-minus text-[0.625rem]" aria-hidden />
            </button>
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
              onClick={() => setZoom(1)}
              title="Resetear zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              title="Acercar"
              onClick={() => setZoom((z) => Math.min(4, z * 1.15))}
            >
              <i className="fa-solid fa-plus text-[0.625rem]" aria-hidden />
            </button>

            <span className="ml-1 h-5 w-px bg-slate-200" aria-hidden />

            {/* Menú overflow con opciones secundarias */}
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                title="Más opciones"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <i className="fa-solid fa-ellipsis-vertical text-xs" aria-hidden />
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {canUseLabelerShortcuts && neighbors.previous != null && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[0.8125rem] text-slate-700 hover:bg-violet-50 disabled:opacity-50"
                      disabled={findingSimilar}
                      onClick={() => { setMoreOpen(false); onFindSimilar() }}
                    >
                      <i className={findingSimilar ? 'fa-solid fa-spinner fa-spin w-4 text-center' : 'fa-solid fa-wand-magic-sparkles w-4 text-center text-violet-500'} aria-hidden />
                      {findingSimilar ? 'Buscando…' : 'Buscar similares (S)'}
                    </button>
                  )}
                  {canUseLabelerShortcuts && neighbors.previous != null && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[0.8125rem] text-slate-700 hover:bg-slate-50"
                      onClick={() => { setMoreOpen(false); onShowSimilarModal() }}
                    >
                      <i className="fa-solid fa-gear w-4 text-center text-slate-400" aria-hidden />
                      Config. similares
                    </button>
                  )}
                  {canUseLabelerShortcuts && groupFilterName && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[0.8125rem] text-slate-700 hover:bg-teal-50 disabled:opacity-50"
                      disabled={applyingFilter || !activeClassId}
                      onClick={() => { setMoreOpen(false); onApplyGroupFilter() }}
                    >
                      <i className={applyingFilter ? 'fa-solid fa-spinner fa-spin w-4 text-center' : 'fa-solid fa-filter w-4 text-center text-teal-500'} aria-hidden />
                      {applyingFilter ? 'Filtrando…' : 'Aplicar filtro (F)'}
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-100" />
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[0.8125rem] text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      checked={emphasizeSelectedOnly}
                      onChange={(e) => setEmphasizeSelectedOnly(e.target.checked)}
                    />
                    Enfocar caja seleccionada
                  </label>
                  {(user?.is_administrador || user?.is_asignador) && (
                    <label
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[0.8125rem] text-slate-700 hover:bg-slate-50"
                      title="Las imágenes descartadas no se incluyen al exportar"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        checked={imgMeta?.discarded_for_dataset ?? false}
                        disabled={discardSaving || !imgMeta}
                        onChange={(e) => onSetDiscarded(e.target.checked)}
                      />
                      Descartar para dataset
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Errores inline */}
      {anyError && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-1.5">
          <span className="text-xs text-red-600">{similarError || filterError || completeError || discardError}</span>
        </div>
      )}
    </header>
  )
}
