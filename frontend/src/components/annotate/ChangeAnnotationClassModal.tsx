import { useEffect, useRef, useState, type SyntheticEvent } from 'react'

type LabelClass = { id: number; name: string; color_hex: string }

type Props = {
  open: boolean
  classes: LabelClass[]
  currentClassId: number | null
  onClose: () => void
  onConfirm: (labelClassId: number) => void
}

export default function ChangeAnnotationClassModal({
  open,
  classes,
  currentClassId,
  onClose,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [picked, setPicked] = useState<number>(currentClassId ?? 0)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    if (!open || currentClassId == null) return
    const valid = classes.some((c) => c.id === currentClassId)
    setPicked(valid ? currentClassId : classes[0]?.id ?? currentClassId)
  }, [open, currentClassId, classes])

  if (!open) return null

  function handleCancel(e: SyntheticEvent) {
    e.preventDefault()
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="robolabel-dialog w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
      onCancel={handleCancel}
    >
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 id="change-class-title" className="text-lg font-semibold text-slate-800">
          Cambiar clase del objeto
        </h2>
      </div>
      <div className="px-6 py-4">
        {classes.length === 0 ? (
          <p className="text-sm text-amber-800">No hay clases en el proyecto.</p>
        ) : (
          <label className="block text-sm font-medium text-slate-700">
            Clase
            <select
              value={picked || ''}
              onChange={(e) => setPicked(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-200"
              aria-labelledby="change-class-title"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={classes.length === 0}
          onClick={() => {
            if (classes.some((c) => c.id === picked)) onConfirm(picked)
          }}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Aplicar
        </button>
      </div>
    </dialog>
  )
}
