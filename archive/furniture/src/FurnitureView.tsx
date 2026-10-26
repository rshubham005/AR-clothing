import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { type ArStatus, ModelViewer, type ModelViewerHandle } from './ModelViewer'
import { SAMPLE_MODELS } from './models'
import { arBrowserName, inAppBrowserName, isAndroid, isPhone } from './userAgent'

type Selection =
  | { kind: 'sample'; id: string; name: string; src: string; poster: string; placement: 'floor' | 'wall' }
  | { kind: 'file'; id: string; name: string; src: string; placement: 'floor' }

type LoadState = 'loading' | 'loaded' | 'error'

const MAX_FILE_MB = 100

const fromSample = (m: (typeof SAMPLE_MODELS)[number]): Selection => ({ kind: 'sample', id: m.id, name: m.name, src: m.src, poster: m.poster, placement: m.placement })

/** A .glb file starts with the ASCII magic "glTF". */
async function isGlb(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return String.fromCharCode(...head) === 'glTF'
}

export function FurnitureView() {
  const [selection, setSelection] = useState<Selection>(fromSample(SAMPLE_MODELS[0]!))
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [progress, setProgress] = useState(0)
  const [canAR, setCanAR] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const viewerRef = useRef<ModelViewerHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const objectUrl = useRef<string | null>(null)
  const phone = isPhone()
  const inApp = inAppBrowserName()

  // Release the local file's memory when the page closes.
  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
  }, [])

  const select = (next: Selection) => {
    if (next.src === selection.src) return
    if (objectUrl.current && objectUrl.current !== next.src) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
    setSelection(next)
    setLoadState('loading')
    setProgress(0)
    setCanAR(false)
    setNotice(null)
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // picking the same file again still fires
    if (!file) return
    if (!/\.glb$/i.test(file.name) || !(await isGlb(file))) {
      setNotice('That file is not a .glb model. Export your model as binary glTF (.glb) and try again.')
      return
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setNotice(`That file is over ${MAX_FILE_MB} MB. Phones struggle with models this large; please use a smaller one.`)
      return
    }
    const url = URL.createObjectURL(file)
    select({ kind: 'file', id: 'local', name: file.name.replace(/\.glb$/i, ''), src: url, placement: 'floor' })
    objectUrl.current = url
  }

  const startAR = async () => {
    if (launching) return
    if (!viewerRef.current?.canActivateAR()) {
      setCanAR(false)
      setNotice(`AR isn't available here. Open this page in ${arBrowserName()} on a recent phone.`)
      return
    }
    setNotice(null)
    setLaunching(true)
    try {
      await viewerRef.current.activateAR()
    } catch {
      setNotice("AR couldn't start on this phone. You can still view the model in 3D.")
    } finally {
      setLaunching(false)
    }
  }

  const onArStatus = (s: ArStatus) => {
    if (s === 'failed') setNotice("AR couldn't start on this phone. You can still view the model in 3D.")
  }

  // Stays tappable when AR is unavailable: the tap explains why instead of being a dead button.
  const arDisabled = loadState !== 'loaded' || launching

  return (
    <>
      {inApp && (
        <p role="status" className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          You're inside the {inApp} app, which often blocks AR. Open this page in {arBrowserName()} for the camera view.
        </p>
      )}

      {/* 3D stage */}
      <section aria-label={`${selection.name}, 3D view`} className="relative mt-3 aspect-[4/5] w-full overflow-hidden rounded-xl border border-line bg-surface sm:aspect-[4/3]">
        <ModelViewer
          ref={viewerRef}
          src={selection.src}
          poster={selection.kind === 'sample' ? selection.poster : undefined}
          alt={`3D model of ${selection.name}`}
          placement={selection.placement}
          className="absolute inset-0"
          onLoad={(ar) => {
            setLoadState('loaded')
            setCanAR(ar)
          }}
          onError={() => setLoadState('error')}
          onProgress={setProgress}
          onArStatus={onArStatus}
        />

        {loadState === 'loading' && (
          <div className="pointer-events-none absolute inset-x-6 bottom-6" role="progressbar" aria-label="Loading model" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(4, progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-center text-xs text-ink-muted">Loading model… {Math.round(progress * 100)}%</p>
          </div>
        )}

        {loadState === 'error' && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
            <p className="font-display text-2xl">This model couldn't be loaded</p>
            <p className="text-sm text-ink-muted">Check your connection, or pick another model below.</p>
            <button
              type="button"
              className="rounded-full border border-ink px-5 py-2 text-sm hover:bg-subtle"
              onClick={() => {
                const current = selection
                setSelection({ ...current, src: `${current.src.split('#')[0]}#retry-${Date.now()}` })
                setLoadState('loading')
                setProgress(0)
              }}
            >
              Try again
            </button>
          </div>
        )}
      </section>

      {/* Primary action */}
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate font-display text-2xl">{selection.name}</h2>
          {loadState === 'loaded' && <span className="shrink-0 text-xs text-ink-faint">Drag to rotate · pinch to zoom</span>}
        </div>

        {phone ? (
          <button
            type="button"
            onClick={startAR}
            disabled={arDisabled}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-obsidian px-6 text-chalk transition-opacity disabled:opacity-40"
          >
            <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" />
              <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
            </svg>
            {launching ? 'Opening camera…' : loadState === 'loading' ? 'Loading…' : 'View in your room'}
          </button>
        ) : (
          <p className="rounded-md bg-subtle px-4 py-3 text-sm text-ink-muted">
            AR uses your phone's camera. Open this page on an Android phone (Chrome) or an iPhone (Safari) to place the model in your room.
          </p>
        )}

        {phone && loadState === 'loaded' && !canAR && !notice && (
          <p className="text-sm text-ink-muted">This browser can't open AR. Try {arBrowserName()} on a recent phone.</p>
        )}
        {selection.kind === 'file' && isAndroid() && (
          <p className="text-xs text-ink-faint">Your own files open in Chrome's AR view. If your phone falls back to Google's Scene Viewer, it can't read files from your device; use one of the samples instead.</p>
        )}
        {notice && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {notice}
          </p>
        )}
      </div>

      {/* Model picker */}
      <section className="mt-6" aria-label="Choose a model">
        <h3 className="text-xs tracking-[0.2em] text-ink-faint uppercase">Models</h3>
        <ul className="-mx-4 mt-2 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
          {SAMPLE_MODELS.map((m) => {
            const active = selection.kind === 'sample' && selection.id === m.id
            return (
              <li key={m.id} className="w-28 shrink-0 snap-start sm:w-auto">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => select(fromSample(m))}
                  className={`w-full overflow-hidden rounded-lg border text-left transition-colors ${active ? 'border-ink' : 'border-line hover:border-ink-faint'}`}
                >
                  <img src={m.poster} alt="" className="aspect-square w-full bg-surface object-contain" loading="lazy" />
                  <span className="block truncate px-2 py-1.5 text-xs">{m.name}</span>
                </button>
              </li>
            )
          })}
          <li className="w-28 shrink-0 snap-start sm:w-auto">
            <button
              type="button"
              aria-pressed={selection.kind === 'file'}
              onClick={() => fileInput.current?.click()}
              className={`flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center text-xs ${selection.kind === 'file' ? 'border-ink' : 'border-ink-faint'}`}
            >
              <span className="text-2xl leading-none" aria-hidden>
                +
              </span>
              Open your own .glb
            </button>
            <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" className="sr-only" tabIndex={-1} onChange={onFile} />
          </li>
        </ul>
        <p className="mt-1 text-xs text-ink-faint">Your own file stays on your device; nothing is uploaded.</p>
      </section>

      <footer className="mt-auto pt-8 text-[11px] leading-relaxed text-ink-faint">
        <p>
          Sample models from the{' '}
          <a className="underline" href="https://github.com/KhronosGroup/glTF-Sample-Assets" target="_blank" rel="noreferrer">
            Khronos glTF Sample Assets
          </a>
          :{' '}
          {SAMPLE_MODELS.map((m, i) => (
            <span key={m.id}>
              <a className="underline" href={m.sourceUrl} target="_blank" rel="noreferrer">
                {m.name}
              </a>{' '}
              by {m.creator} ({m.license}){i < SAMPLE_MODELS.length - 1 ? '; ' : '.'}
            </span>
          ))}
        </p>
      </footer>
    </>
  )
}
