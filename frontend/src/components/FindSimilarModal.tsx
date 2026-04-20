import { useEffect, useRef, useState } from 'react'

export type SimilarityParams = {
  confidence_threshold: number
  max_distance_px: number | null
  scale_min: number
  scale_max: number
  scale_steps: number
  nms_iou_threshold: number
  max_detections_per_object: number
}

export const DEFAULT_PARAMS: SimilarityParams = {
  confidence_threshold: 0.55,
  max_distance_px: null,
  scale_min: 0.7,
  scale_max: 1.35,
  scale_steps: 7,
  nms_iou_threshold: 0.4,
  max_detections_per_object: 5,
}

type Props = {
  open: boolean
  currentParams: SimilarityParams
  onClose: () => void
  onSave: (params: SimilarityParams) => void
}

type SliderRowProps = {
  label: string
  help: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

function SliderRow({ label, help, value, min, max, step, unit, onChange }: SliderRowProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[0.8125rem] font-medium text-slate-700">{label}</label>
        <span className="text-[0.8125rem] font-mono font-semibold text-violet-700">
          {value}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-violet-600"
      />
      <p className="mt-0.5 text-[0.6875rem] text-slate-400">{help}</p>
    </div>
  )
}

export default function FindSimilarModal({ open, currentParams, onClose, onSave }: Props) {
  const [params, setParams] = useState<SimilarityParams>({ ...currentParams })
  const [useDistance, setUseDistance] = useState(currentParams.max_distance_px != null)
  const [distanceValue, setDistanceValue] = useState(currentParams.max_distance_px ?? 200)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) {
      setParams({ ...currentParams })
      setUseDistance(currentParams.max_distance_px != null)
      setDistanceValue(currentParams.max_distance_px ?? 200)
    }
  }, [open, currentParams])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  function set<K extends keyof SimilarityParams>(key: K, val: SimilarityParams[K]) {
    setParams((p) => ({ ...p, [key]: val }))
  }

  function handleSave() {
    onSave({
      ...params,
      max_distance_px: useDistance ? distanceValue : null,
    })
    onClose()
  }

  function resetDefaults() {
    setParams({ ...DEFAULT_PARAMS })
    setUseDistance(false)
    setDistanceValue(200)
  }

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className="robolabel-dialog w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
      onCancel={onClose}
    >
      <div className="border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">
            <i className="fa-solid fa-gear mr-2 text-violet-500" aria-hidden />
            Parámetros de detección
          </h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark text-lg" aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-[0.8125rem] text-slate-500">
          Ajusta los parámetros y luego usa el botón &ldquo;Buscar similares&rdquo; para aplicarlos.
        </p>
      </div>

      <div className="space-y-5 px-6 py-5">
        <SliderRow
          label="Umbral de confianza"
          help="Solo se muestran detecciones con este score mínimo. Más alto = menos detecciones pero más precisas."
          value={params.confidence_threshold}
          min={0.3}
          max={0.95}
          step={0.05}
          onChange={(v) => set('confidence_threshold', v)}
        />

        <div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useDistance"
              checked={useDistance}
              onChange={(e) => setUseDistance(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-violet-600 accent-violet-600"
            />
            <label htmlFor="useDistance" className="text-[0.8125rem] font-medium text-slate-700">
              Limitar distancia desde posición original
            </label>
          </div>
          {useDistance && (
            <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
              <SliderRow
                label="Distancia máxima"
                help="Cada detección debe estar dentro de este radio (en px) respecto a donde estaba el objeto en la imagen anterior."
                value={distanceValue}
                min={10}
                max={1000}
                step={10}
                unit=" px"
                onChange={setDistanceValue}
              />
            </div>
          )}
        </div>

        <SliderRow
          label="Máx. detecciones por objeto"
          help="Limita cuántos candidatos se devuelven por cada objeto de la imagen anterior."
          value={params.max_detections_per_object}
          min={1}
          max={20}
          step={1}
          onChange={(v) => set('max_detections_per_object', v)}
        />

        <details className="group rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-4 py-2.5 text-[0.8125rem] font-medium text-slate-600 hover:bg-slate-50">
            <i className="fa-solid fa-sliders mr-1.5 text-slate-400" aria-hidden />
            Parámetros avanzados
          </summary>
          <div className="space-y-4 border-t border-slate-200 px-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <SliderRow
                label="Escala mín."
                help="Factor de escala mínimo para el template."
                value={params.scale_min}
                min={0.3}
                max={1.0}
                step={0.05}
                unit="x"
                onChange={(v) => set('scale_min', v)}
              />
              <SliderRow
                label="Escala máx."
                help="Factor de escala máximo."
                value={params.scale_max}
                min={1.0}
                max={3.0}
                step={0.05}
                unit="x"
                onChange={(v) => set('scale_max', v)}
              />
            </div>
            <SliderRow
              label="Pasos de escala"
              help="Cuántas escalas intermedias probar. Más pasos = más lento pero más preciso."
              value={params.scale_steps}
              min={1}
              max={15}
              step={1}
              onChange={(v) => set('scale_steps', v)}
            />
            <SliderRow
              label="Umbral NMS (IoU)"
              help="Non-Max Suppression: elimina cajas que se solapan más que este %. Más bajo = menos duplicados."
              value={params.nms_iou_threshold}
              min={0.1}
              max={0.9}
              step={0.05}
              onChange={(v) => set('nms_iou_threshold', v)}
            />
          </div>
        </details>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          className="text-[0.8125rem] text-slate-500 hover:text-slate-700 hover:underline"
          onClick={resetDefaults}
        >
          Restaurar valores
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[0.8125rem] font-medium text-white shadow-sm hover:bg-violet-700"
            onClick={handleSave}
          >
            <i className="fa-solid fa-check" aria-hidden />
            Guardar
          </button>
        </div>
      </div>
    </dialog>
  )
}
