import { useRef, useState, useEffect } from 'react'
import { colorForLabelClass } from '../../utils/labelColors'

type LabelClass = { id: number; name: string; color_hex: string }
type Ann = {
  label_class: number
  x: string
  y: string
  width: string
  height: string
}
type Suggestion = Ann & { confidence: number }

export interface ObjectSidebarProps {
  classes: LabelClass[]
  annotations: Ann[]
  suggestions: Suggestion[]
  selected: number | null
  setSelected: (i: number | null) => void
  setAnnotations: React.Dispatch<React.SetStateAction<Ann[]>>
  setDirty: (v: boolean) => void
  canModifyAnnotations: boolean
  canCreateLabelClass: boolean
  newClassName: string
  setNewClassName: (v: string) => void
  addQuickClass: () => void
  acceptSuggestion: (i: number) => void
  acceptAllSuggestions: () => void
  dismissSuggestion: (i: number) => void
  dismissAllSuggestions: () => void
}

export default function ObjectSidebar(props: ObjectSidebarProps) {
  const {
    classes, annotations, suggestions, selected, setSelected,
    setAnnotations, setDirty, canModifyAnnotations, canCreateLabelClass,
    newClassName, setNewClassName, addQuickClass,
    acceptSuggestion, acceptAllSuggestions,
    dismissSuggestion, dismissAllSuggestions,
  } = props

  const objectListScrollRef = useRef<HTMLDivElement>(null)
  const objectListItemRefs = useRef<Map<number, HTMLLIElement | null>>(new Map())
  const [quickClassOpen, setQuickClassOpen] = useState(false)

  useEffect(() => {
    if (selected == null) return
    const el = objectListItemRefs.current.get(selected)
    const scroller = objectListScrollRef.current
    if (!el || !scroller) return
    const pad = 8
    const sr = scroller.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    if (er.top < sr.top + pad) {
      scroller.scrollTop += er.top - sr.top - pad
    } else if (er.bottom > sr.bottom - pad) {
      scroller.scrollTop += er.bottom - sr.bottom + pad
    }
  }, [selected])

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-t border-slate-200 bg-slate-50 lg:max-h-full lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-500">
          Objetos ({annotations.length})
        </h2>
        {canCreateLabelClass && canModifyAnnotations && (
          <button
            type="button"
            className="text-[0.75rem] font-medium text-sky-600 hover:text-sky-800 hover:underline"
            onClick={() => setQuickClassOpen((v) => !v)}
          >
            {quickClassOpen ? 'Cerrar' : '+ Nueva clase'}
          </button>
        )}
      </div>

      {quickClassOpen && canCreateLabelClass && canModifyAnnotations && (
        <div className="border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex gap-2">
            <input
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="ej. tornillo, pieza…"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[0.8125rem] focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-200"
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
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded border border-black/10"
              style={{ backgroundColor: colorForLabelClass(annotations[selected].label_class, classes) }}
            />
            <select
              value={annotations[selected].label_class}
              onChange={(e) => {
                const v = Number(e.target.value)
                setAnnotations((prev) =>
                  prev.map((a, i) => (i === selected ? { ...a, label_class: v } : a)),
                )
                setDirty(true)
              }}
              className="flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[0.8125rem]"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className="text-[0.625rem] font-medium uppercase tracking-wide text-sky-600">
              Seleccionada
            </span>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-violet-700">
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
          <ul className="mt-2 space-y-1">
            {suggestions.map((s, i) => {
              const c = classes.find((x) => x.id === s.label_class)
              const swatch = colorForLabelClass(s.label_class, classes)
              return (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-[0.8125rem]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded border border-black/10" style={{ backgroundColor: swatch }} />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-800">{c?.name ?? '?'}</span>
                    <span className="ml-1 text-[0.6875rem] text-violet-500">
                      {Math.round(s.confidence * 100)}%
                    </span>
                  </span>
                  <button type="button" className="text-emerald-600 hover:text-emerald-700" title="Aceptar" onClick={() => acceptSuggestion(i)}>
                    <i className="fa-solid fa-check" aria-hidden />
                  </button>
                  <button type="button" className="text-slate-400 hover:text-red-500" title="Descartar" onClick={() => dismissSuggestion(i)}>
                    <i className="fa-solid fa-xmark" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div
        ref={objectListScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2"
      >
        {annotations.length === 0 && suggestions.length === 0 ? (
          <p className="px-2 py-6 text-center text-[0.8125rem] text-slate-400">
            Dibuja rectángulos sobre la imagen para añadir objetos.
          </p>
        ) : (
          <ul className="space-y-1.5">
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
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[0.8125rem] transition-colors ${
                      isActive
                        ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-400/40'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded border border-black/10"
                      style={{ backgroundColor: swatch }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`font-medium ${isActive ? 'text-sky-900' : 'text-slate-700'}`}>
                        {c?.name ?? '?'}
                      </span>
                      <span className={`ml-1.5 text-[0.6875rem] ${isActive ? 'text-sky-600' : 'text-slate-400'}`}>
                        #{i + 1}
                      </span>
                    </span>
                    {canModifyAnnotations && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="shrink-0 text-slate-300 hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAnnotations((prev) => prev.filter((_, j) => j !== i))
                          setSelected(null)
                          setDirty(true)
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
                      >
                        <i className="fa-solid fa-trash text-xs" aria-hidden />
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
  )
}
