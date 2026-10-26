// The fitting room: pick a garment and colour, preview it in 3D, then try it on with the camera
// (on-device body tracking + the garment drawn over the live video).
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { useEffect, useRef, useState } from 'react'
import { isPhone } from '../userAgent'
import { CATALOG, type CatalogItem } from './catalog'
import { type TrackingStatus, TryOnEngine } from './engine'
import { createGarment, type Garment } from './garment'
import { loadModelGarment } from './modelGarment'
import { GarmentPreview } from './preview'

type Phase = 'idle' | 'starting' | 'running' | 'error'
type Facing = 'user' | 'environment'

// The tracker library loads on first use and takes a few seconds to start; keep it for the rest of the visit.
let trackerPromise: Promise<PoseLandmarker> | null = null
const getTracker = () =>
  (trackerPromise ??= import('./poseTracker').then((m) => m.createPoseTracker()).catch((e: unknown) => {
    trackerPromise = null
    throw e
  }))

const makeGarment = (item: CatalogItem, color: string): Promise<Garment> =>
  item.model ? loadModelGarment(item.model, color) : Promise.resolve(createGarment(item.shape!, color))

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.'
  return "Try-on couldn't start on this device. Check your connection and try again."
}

export function TryOn() {
  const [item, setItem] = useState<CatalogItem>(CATALOG[0]!)
  const [color, setColor] = useState(CATALOG[0]!.colors[0]!.value)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<TrackingStatus>('searching')
  const [facing, setFacing] = useState<Facing>('user')
  const [garmentState, setGarmentState] = useState<'loading' | 'ready' | 'error'>('loading')
  const garmentRequest = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<TryOnEngine | null>(null)
  const previewRef = useRef<GarmentPreview | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const selection = useRef({ item, color })
  selection.current = { item, color }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  // 3D preview while the camera is off. Turn everything off and free the GPU when leaving the page.
  useEffect(() => {
    const preview = new GarmentPreview(previewCanvasRef.current!)
    preview.start()
    previewRef.current = preview
    void showGarment(selection.current.item)
    return () => {
      stopStream()
      preview.dispose()
      previewRef.current = null
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  // Keep both canvases the same size as the stage.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      engineRef.current?.resize(width, height)
      previewRef.current?.resize(width, height)
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  /** Loads the garment for the preview and (if the camera is on) the live view; ignores answers to old requests. */
  const showGarment = async (next: CatalogItem) => {
    const request = ++garmentRequest.current
    setGarmentState('loading')
    try {
      const color = selection.current.color
      const engine = engineRef.current
      const [forPreview, forLive] = await Promise.all([makeGarment(next, color), engine ? makeGarment(next, color) : null])
      if (request !== garmentRequest.current || !previewRef.current) {
        forPreview.dispose()
        forLive?.dispose()
        return
      }
      // The colour may have changed while it loaded.
      forPreview.setColor(selection.current.color)
      forLive?.setColor(selection.current.color)
      previewRef.current.setGarment(forPreview)
      if (forLive) engine?.setGarment(forLive)
      setGarmentState('ready')
    } catch {
      if (request === garmentRequest.current) setGarmentState('error')
    }
  }

  const pickItem = (next: CatalogItem) => {
    if (next.id === item.id) return
    const nextColor = next.colors[0]!.value
    setItem(next)
    setColor(nextColor)
    selection.current = { item: next, color: nextColor }
    void showGarment(next)
  }

  const pickColor = (c: string) => {
    setColor(c)
    previewRef.current?.setColor(c)
    engineRef.current?.setColor(c)
  }

  const start = async (nextFacing: Facing) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser has no camera access here. Open the page over HTTPS in Chrome or Safari.')
      setPhase('error')
      return
    }
    setPhase('starting')
    setError(null)
    engineRef.current?.stop()
    stopStream()
    try {
      const [stream, tracker] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: nextFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        }),
        getTracker(),
      ])
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()

      if (!engineRef.current) {
        const engine = new TryOnEngine(liveCanvasRef.current!, video, tracker, setStatus)
        const { item: i, color: c } = selection.current
        engine.setGarment(await makeGarment(i, c))
        engine.setColor(selection.current.color)
        engineRef.current = engine
      }
      const rect = stageRef.current!.getBoundingClientRect()
      engineRef.current.resize(rect.width, rect.height)
      engineRef.current.start()
      previewRef.current?.stop()
      setFacing(nextFacing)
      setPhase('running')
    } catch (e) {
      stopStream()
      setError(cameraErrorMessage(e))
      setPhase('error')
    }
  }

  const stop = () => {
    engineRef.current?.stop()
    stopStream()
    previewRef.current?.start()
    setPhase('idle')
  }

  const running = phase === 'running'
  const mirrored = facing === 'user'

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label={running ? `Trying on the ${item.name}` : `${item.name}, 3D preview`}
        ref={stageRef}
        className={`relative mt-3 aspect-[3/4] w-full overflow-hidden rounded-xl border border-line sm:aspect-[4/3] ${running ? 'bg-obsidian' : 'bg-surface'}`}
      >
        {/* Live view: video and garment flip together for the selfie camera, so they stay aligned. */}
        <div className={`absolute inset-0 ${running ? '' : 'invisible'}`} style={mirrored ? { transform: 'scaleX(-1)' } : undefined}>
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
          <canvas ref={liveCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>

        <canvas ref={previewCanvasRef} className={`absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing ${running ? 'hidden' : ''}`} />

        {!running && garmentState !== 'ready' && (
          <p role="status" className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-ink-muted">
            {garmentState === 'loading' ? 'Loading garment…' : "This garment couldn't be loaded. Check your connection and pick it again."}
          </p>
        )}

        {!running && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5 text-center">
            {phase === 'error' && (
              <p role="alert" className="max-w-sm rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => start(facing)}
              disabled={phase === 'starting'}
              className="pointer-events-auto flex h-12 items-center justify-center gap-2 rounded-full bg-obsidian px-6 text-chalk transition-opacity disabled:opacity-50"
            >
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              {phase === 'starting' ? 'Starting camera…' : phase === 'error' ? 'Try again' : 'Try it on'}
            </button>
            <p className="text-xs text-ink-faint">Drag to turn · the camera video stays on this device</p>
          </div>
        )}

        {running && status === 'searching' && (
          <p role="status" className="absolute inset-x-4 bottom-4 rounded-md bg-obsidian/70 px-3 py-2 text-center text-sm text-chalk">
            Step back so your shoulders are in view
          </p>
        )}

        {running && (
          <div className="absolute inset-x-3 top-3 flex justify-between">
            <button type="button" onClick={stop} className="rounded-full bg-obsidian/70 px-3 py-1.5 text-xs text-chalk">
              Close camera
            </button>
            {isPhone() && (
              <button
                type="button"
                onClick={() => start(facing === 'user' ? 'environment' : 'user')}
                className="rounded-full bg-obsidian/70 px-3 py-1.5 text-xs text-chalk"
              >
                Switch camera
              </button>
            )}
          </div>
        )}
      </section>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl">{item.name}</h2>
          <span className="shrink-0 text-xs text-ink-faint">{item.colors.find((c) => c.value === color)?.name}</span>
        </div>
        <p className="text-sm text-ink-muted">{item.description}</p>
      </div>

      <fieldset>
        <legend className="text-xs tracking-[0.2em] text-ink-faint uppercase">Colour</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {item.colors.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={c.name}
              aria-pressed={color === c.value}
              onClick={() => pickColor(c.value)}
              className={`size-10 rounded-full border-2 ${color === c.value ? 'border-ink' : 'border-line'}`}
              style={{ background: c.value }}
            />
          ))}
        </div>
      </fieldset>

      <section aria-label="Choose a garment">
        <h3 className="text-xs tracking-[0.2em] text-ink-faint uppercase">Collection</h3>
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATALOG.map((g) => {
            const active = g.id === item.id
            return (
              <li key={g.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickItem(g)}
                  className={`flex w-full flex-col gap-2 rounded-lg border bg-surface p-3 text-left transition-colors ${active ? 'border-ink' : 'border-line hover:border-ink-faint'}`}
                >
                  <span className="flex gap-1" aria-hidden>
                    {g.colors.map((c) => (
                      <span key={c.value} className="size-3 rounded-full border border-line" style={{ background: c.value }} />
                    ))}
                  </span>
                  <span className="text-sm">{g.name}</span>
                  <span className="text-xs text-ink-faint">{g.description}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <p className="text-xs text-ink-faint">
        A preview of how the style looks on you, not a size guide. Works best in good light with your shoulders and hips in view.
      </p>
    </div>
  )
}
