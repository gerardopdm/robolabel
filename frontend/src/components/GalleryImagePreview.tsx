import AuthenticatedImage from './AuthenticatedImage'
import { colorForLabelClass } from '../utils/labelColors'

export type AnnotationPreview = {
  label_class_id: number
  x: string
  y: string
  width: string
  height: string
}

type LabelClassLite = { id: number; color_hex: string }

type Props = {
  imageId: number
  widthPx: number
  heightPx: number
  annotations: AnnotationPreview[]
  classes: LabelClassLite[]
}

/** Miniatura con las mismas coordenadas en píxeles que el lienzo; SVG alineado con object-contain. */
export default function GalleryImagePreview({
  imageId,
  widthPx,
  heightPx,
  annotations,
  classes,
}: Props) {
  const nw = Math.max(1, widthPx)
  const nh = Math.max(1, heightPx)
  const strokePx = Math.max(2, Math.min(nw, nh) * 0.004)

  return (
    <>
      <AuthenticatedImage
        imageId={imageId}
        alt=""
        className="h-full w-full min-h-[6rem]"
        imgClassName="h-full w-full object-contain"
      />
      {annotations.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${nw} ${nh}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {annotations.map((a, i) => {
            const col = colorForLabelClass(a.label_class_id, classes)
            return (
              <g key={`${a.label_class_id}-${i}`}>
                <rect
                  x={a.x}
                  y={a.y}
                  width={a.width}
                  height={a.height}
                  fill="none"
                  stroke="rgba(15,23,42,0.55)"
                  strokeWidth={strokePx + 2.5}
                  vectorEffect="nonScalingStroke"
                />
                <rect
                  x={a.x}
                  y={a.y}
                  width={a.width}
                  height={a.height}
                  fill={col}
                  fillOpacity={0.22}
                  stroke={col}
                  strokeWidth={strokePx}
                  vectorEffect="nonScalingStroke"
                />
              </g>
            )
          })}
        </svg>
      )}
    </>
  )
}
