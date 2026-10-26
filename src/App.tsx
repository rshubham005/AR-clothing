import { CATALOG } from './tryon/catalog'
import { TryOn } from './tryon/TryOn'
import { inAppBrowserName, recommendedBrowser } from './userAgent'

export function App() {
  const inApp = inAppBrowserName()

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="flex items-baseline justify-between py-2">
        <h1 className="font-display text-3xl">Fitting Room</h1>
        <p className="text-xs tracking-[0.2em] text-ink-faint uppercase">Virtual try-on</p>
      </header>

      {inApp && (
        <p role="status" className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          You're inside the {inApp} app, which often blocks the camera. Open this page in {recommendedBrowser()} to try clothes on.
        </p>
      )}

      <TryOn />

      <footer className="mt-auto pt-8 text-[11px] leading-relaxed text-ink-faint">
        <p>
          Body tracking by{' '}
          <a className="underline" href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker" target="_blank" rel="noreferrer">
            MediaPipe Pose
          </a>{' '}
          (Apache 2.0), running on your device. Nothing from your camera is uploaded.
        </p>
        {CATALOG.filter((g) => g.credit).map((g) => (
          <p key={g.id}>
            {g.name} 3D model by{' '}
            <a className="underline" href={g.credit!.url} target="_blank" rel="noreferrer">
              {g.credit!.author}
            </a>{' '}
            (CGTrader).
          </p>
        ))}
      </footer>
    </div>
  )
}
