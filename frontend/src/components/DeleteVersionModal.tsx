import { useEffect, useRef, type SyntheticEvent } from 'react'

type Props = {
  open: boolean
  versionName: string
  pending?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export default function DeleteVersionModal({
  open,
  versionName,
  pending = false,
  onClose,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  if (!open) return null

  function handleCancel(e: SyntheticEvent) {
    e.preventDefault()
    if (!pending) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="robolabel-dialog w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
      onCancel={handleCancel}
    >
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-800">Eliminar versión</h2>
      </div>
      <div className="px-6 py-4">
        <p className="text-sm leading-relaxed text-slate-600">
          ¿Eliminar la versión <span className="font-semibold text-slate-800">&laquo;{versionName}&raquo;</span>?
          Dejará de aparecer en la lista y su ZIP ya no estará disponible para descarga.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={pending}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
    </dialog>
  )
}
