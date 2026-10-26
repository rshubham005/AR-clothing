// Thin React wrapper around Google's <model-viewer>, loaded on demand.
// AR launch (ADR-0035 in the original project): Android opens WebXR inside Chrome first and falls back to Scene
// Viewer; iPhone opens AR Quick Look with a USDZ that model-viewer builds on the phone.
import type { ModelViewerElement } from '@google/model-viewer'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

let loader: Promise<unknown> | null = null
const loadModelViewer = () => (loader ??= import('@google/model-viewer'))

export type ArStatus = 'not-presenting' | 'session-started' | 'object-placed' | 'failed'

export interface ModelViewerHandle {
  activateAR: () => Promise<void>
  canActivateAR: () => boolean
}

interface Props {
  src: string
  poster?: string
  alt: string
  placement: 'floor' | 'wall'
  className?: string
  onLoad?: (canActivateAR: boolean) => void
  onError?: () => void
  onProgress?: (p: number) => void
  onArStatus?: (s: ArStatus) => void
}

export const ModelViewer = forwardRef<ModelViewerHandle, Props>(function ModelViewer(
  { src, poster, alt, placement, className, onLoad, onError, onProgress, onArStatus },
  ref,
) {
  const elRef = useRef<ModelViewerElement | null>(null)
  const [ready, setReady] = useState(false)
  const cbs = useRef({ onLoad, onError, onProgress, onArStatus })
  useEffect(() => {
    cbs.current = { onLoad, onError, onProgress, onArStatus }
  })

  useEffect(() => {
    let alive = true
    loadModelViewer()
      .then(() => alive && setReady(true))
      .catch(() => alive && cbs.current.onError?.())
    return () => {
      alive = false
    }
  }, [])

  useImperativeHandle(ref, () => ({
    activateAR: async () => {
      await elRef.current?.activateAR()
    },
    canActivateAR: () => !!elRef.current?.canActivateAR,
  }))

  // `src` is a dependency because the element is keyed by src: a new model is a new element.
  useEffect(() => {
    const el = elRef.current
    if (!ready || !el) return
    const handleLoad = () => cbs.current.onLoad?.(!!el.canActivateAR)
    const handleError = () => cbs.current.onError?.()
    const handleProgress = (e: Event) => {
      const p = (e as CustomEvent<{ totalProgress?: number }>).detail?.totalProgress
      if (typeof p === 'number') cbs.current.onProgress?.(p)
    }
    const handleAr = (e: Event) => {
      const s = (e as CustomEvent<{ status?: ArStatus }>).detail?.status
      if (s) cbs.current.onArStatus?.(s)
    }
    el.addEventListener('load', handleLoad)
    el.addEventListener('error', handleError)
    el.addEventListener('progress', handleProgress)
    el.addEventListener('ar-status', handleAr)
    return () => {
      el.removeEventListener('load', handleLoad)
      el.removeEventListener('error', handleError)
      el.removeEventListener('progress', handleProgress)
      el.removeEventListener('ar-status', handleAr)
    }
  }, [ready, src])

  if (!ready) return <div className={className} aria-hidden />

  return (
    <model-viewer
      ref={(node: HTMLElement | null) => {
        elRef.current = node as ModelViewerElement | null
      }}
      key={src}
      src={src}
      poster={poster}
      alt={alt}
      camera-controls
      touch-action="pan-y"
      interaction-prompt="none"
      shadow-intensity="1"
      shadow-softness="0.9"
      exposure="1"
      ar
      ar-modes="webxr scene-viewer quick-look"
      ar-scale="fixed"
      ar-placement={placement}
      loading="eager"
      reveal="auto"
      className={className}
    >
      {/* AR is launched by our own button; hide the built-in button and progress bar. */}
      <span slot="ar-button" hidden />
      <span slot="progress-bar" hidden />
    </model-viewer>
  )
})
