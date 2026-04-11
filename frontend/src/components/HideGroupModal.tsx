import { useEffect, useRef, type SyntheticEvent } from 'react'

type Props = {
  open: boolean
  groupName: string
  variant?: 'list' | 'detail'
  pending?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

const COPY: Record<
  'list' | 'detail',
  (name: string) => string
> = {
  list: (name) =>
    `¿Ocultar el grupo «${name}»? Dejará de mostrarse en la app y sus imágenes no se incluirán en exportaciones ni datasets nuevos. Los datos no se borran del servidor.`,
  detail: (name) =>
    `¿Ocultar el grupo «${name}»? Dejará de mostrarse y no se incluirá en exportaciones ni datasets nuevos.`,
}

export default function HideGroupModal({
  open,
  groupName,
  variant = 'list',
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

  async function handleConfirm() {
    await onConfirm()
  }

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
      onCancel={handleCancel}
    >
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-800">Ocultar grupo</h2>
      </div>
      <div className="px-6 py-4">
        <p className="text-sm leading-relaxed text-slate-600">{COPY[variant](groupName)}</p>
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
          onClick={() => void handleConfirm()}
          disabled={pending}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? 'Ocultando…' : 'Ocultar'}
        </button>
      </div>
    </dialog>
  )
}
