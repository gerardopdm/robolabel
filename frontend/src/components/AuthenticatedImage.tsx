import { forwardRef, useEffect, useState } from 'react'
import api from '../api/client'

export type AuthenticatedImageProps = {
  imageId: number
  alt: string
  /** Contenedor mientras carga */
  className?: string
  /** Clases del elemento <img> (p.ej. pointer-events-none block max-h) */
  imgClassName?: string
  onLoad?: (ev: React.SyntheticEvent<HTMLImageElement>) => void
}

/** Carga la imagen con JWT; el <img> puede recibir ref para medir coordenadas en el lienzo. */
const AuthenticatedImage = forwardRef<HTMLImageElement, AuthenticatedImageProps>(
  function AuthenticatedImage({ imageId, alt, className, imgClassName, onLoad }, ref) {
    const [src, setSrc] = useState<string | null>(null)

    useEffect(() => {
      let revoke: string | null = null
      ;(async () => {
        try {
          const res = await api.get(`/images/${imageId}/file/`, { responseType: 'blob' })
          const url = URL.createObjectURL(res.data)
          revoke = url
          setSrc(url)
        } catch {
          setSrc(null)
        }
      })()
      return () => {
        if (revoke) URL.revokeObjectURL(revoke)
      }
    }, [imageId])

    if (!src) {
      return <div className={(className ?? '') + ' animate-pulse bg-slate-200'} aria-hidden />
    }
    return (
      <img
        ref={ref}
        src={src}
        alt={alt}
        draggable={false}
        className={imgClassName}
        onLoad={onLoad}
      />
    )
  },
)

export default AuthenticatedImage
