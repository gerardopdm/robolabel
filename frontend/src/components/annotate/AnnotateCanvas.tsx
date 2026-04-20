import React from 'react'
import AuthenticatedImage from '../AuthenticatedImage'
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

export interface AnnotateCanvasProps {
  imageId: string | undefined
  imgRef: React.RefObject<HTMLImageElement | null>
  nw: number
  nh: number
  zoom: number
  setZoom: React.Dispatch<React.SetStateAction<number>>
  annotations: Ann[]
  suggestions: Suggestion[]
  classes: LabelClass[]
  selected: number | null
  setSelected: (i: number | null) => void
  emphasizeSelectedOnly: boolean
  canModifyAnnotations: boolean
  annotationRenderOrder: number[]
  activeDrawColor: string
  preview: { x: number; y: number; w: number; h: number } | null | false
  strokePx: number
  handleR: number
  onImgLoad: () => void
  handleCanvasPointerDown: (e: React.PointerEvent) => void
  toImageCoords: (cx: number, cy: number) => { x: number; y: number } | null
  setMoveInfo: (v: { annIdx: number; startX: number; startY: number; origX: number; origY: number } | null) => void
  setResizeInfo: (v: { annIdx: number; anchorX: number; anchorY: number } | null) => void
  acceptSuggestion: (i: number) => void
  onAnnotationDoubleClick?: (annIdx: number) => void
}

export default function AnnotateCanvas(props: AnnotateCanvasProps) {
  const {
    imageId, imgRef, nw, nh, zoom, setZoom,
    annotations, suggestions, classes, selected, setSelected,
    emphasizeSelectedOnly, canModifyAnnotations,
    annotationRenderOrder, activeDrawColor, preview,
    strokePx, handleR,
    onImgLoad, handleCanvasPointerDown, toImageCoords,
    setMoveInfo, setResizeInfo, acceptSuggestion, onAnnotationDoubleClick,
  } = props

  return (
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
                    const focusSelection = emphasizeSelectedOnly && selected != null && !isSel
                    const fillOp =
                      emphasizeSelectedOnly && selected != null && isSel
                        ? 0.38
                        : isSel ? 0.28 : 0.18
                    return (
                      <g key={i} opacity={focusSelection ? 0.18 : 1}>
                        <rect
                          x={a.x} y={a.y} width={a.width} height={a.height}
                          fill="none" stroke="rgba(15,23,42,0.55)"
                          strokeWidth={wStroke + 3} vectorEffect="nonScalingStroke"
                          pointerEvents="none"
                        />
                        <rect
                          x={a.x} y={a.y} width={a.width} height={a.height}
                          fill={col} fillOpacity={fillOp}
                          stroke={col} strokeOpacity={1} strokeWidth={wStroke}
                          vectorEffect="nonScalingStroke" pointerEvents="all"
                          style={{ cursor: canModifyAnnotations ? 'move' : 'pointer' }}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            setSelected(i)
                            if (canModifyAnnotations) {
                              const p = toImageCoords(e.clientX, e.clientY)
                              if (p) {
                                setMoveInfo({
                                  annIdx: i, startX: p.x, startY: p.y,
                                  origX: Number(a.x), origY: Number(a.y),
                                })
                              }
                            }
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            if (!canModifyAnnotations || !onAnnotationDoubleClick) return
                            onAnnotationDoubleClick(i)
                          }}
                        />
                      </g>
                    )
                  })}
                  {suggestions.map((s, i) => {
                    const col = colorForLabelClass(s.label_class, classes)
                    const sugOp = emphasizeSelectedOnly && selected != null ? 0.12 : 0.75
                    return (
                      <g key={`sug-${i}`} opacity={sugOp}>
                        <rect
                          x={s.x} y={s.y} width={s.width} height={s.height}
                          fill={col} fillOpacity={0.12}
                          stroke={col} strokeOpacity={1} strokeWidth={strokePx}
                          strokeDasharray="8 4" vectorEffect="nonScalingStroke"
                          pointerEvents="all" style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); acceptSuggestion(i) }}
                        />
                      </g>
                    )
                  })}
                  {preview && preview.w > 0 && preview.h > 0 && (
                    <g>
                      <rect
                        x={preview.x} y={preview.y} width={preview.w} height={preview.h}
                        fill="none" stroke="rgba(15,23,42,0.5)"
                        strokeWidth={strokePx * 1.1 + 3} vectorEffect="nonScalingStroke"
                        pointerEvents="none"
                      />
                      <rect
                        x={preview.x} y={preview.y} width={preview.w} height={preview.h}
                        fill={activeDrawColor} fillOpacity={0.22}
                        stroke={activeDrawColor} strokeOpacity={1}
                        strokeWidth={strokePx * 1.1} vectorEffect="nonScalingStroke"
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
                        key={corner.id} cx={corner.cx} cy={corner.cy} r={handleR}
                        fill="white" stroke={sCol} strokeWidth={strokePx * 1.15}
                        vectorEffect="nonScalingStroke" pointerEvents="all"
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
      </div>
    </section>
  )
}
