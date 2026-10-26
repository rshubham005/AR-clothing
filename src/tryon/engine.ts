// Draws a garment over the live camera feed and keeps it on the tracked body.
//
// The 3D scene uses the video's own pixel grid (x right, y up, origin bottom-left) with an orthographic camera,
// so a landmark at video pixel (x, y) is exactly where the garment bone goes. The camera's view is cropped the
// same way the <video> is (object-fit: cover), so the canvas lines up with what the user sees.
import type { Landmark, NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import * as THREE from 'three'
import { type Garment, TORSO } from './garment'
import { OneEuro } from './oneEuro'

/** 'close' = tracking, but the hips are out of view, so the garment's length and lean are guessed. */
export type TrackingStatus = 'searching' | 'tracking' | 'close'

/** MediaPipe pose landmark indices used by the garment fitter. */
const LM = {
  earL: 7,
  earR: 8,
  shoulderL: 11,
  shoulderR: 12,
  elbowL: 13,
  elbowR: 14,
  wristL: 15,
  wristR: 16,
  hipL: 23,
  hipR: 24,
} as const

const MIN_VIS = 0.5
const HIP_VIS = 0.3
const CLOSE_AFTER_FRAMES = 60 // ~2 s without hips before suggesting to step back
// The tracker gives shoulder JOINTS; a body is wider than that, most of all close to the camera. Draw the body of
// the garment this much wider so it covers the body rather than sitting inside its outline.
const EASE = 1.06
const MAX_YAW = 1.1 // ~63°, past this the shoulder width estimate is too unreliable

interface Point {
  x: number
  y: number
  vis: number
}

export class TryOnEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1e5, 1e5)
  private garment: Garment | null = null
  private raf = 0
  private lastVideoTime = -1
  private lastTs = 0
  private view = { cw: 0, ch: 0, vw: 0, vh: 0 }
  private filters = new Map<string, OneEuro>()
  private status: TrackingStatus | null = null
  private framesWithoutHips = 0
  /**
   * An invisible neck and head: it hides the parts of the garment behind them (the inside of the back collar)
   * while letting the camera image show through. Rig units, centred between the shoulders.
   */
  private neck = (() => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 24, 1, false),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    )
    // From inside the collar opening (y -0.15, where the inside of the back panel would show through) up to the chin.
    // Its front (z 0.12) stays behind the garment front, its back hides the inside of the back panel.
    mesh.scale.set(0.14, 0.7, 0.12)
    mesh.position.set(0, 0.35 - 0.15, 0)
    mesh.renderOrder = -1 // fill the depth buffer before the garment draws
    return mesh
  })()
  /** An invisible head that follows the tracked ears, so hoods and high collars behind it stay hidden. */
  private head = (() => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ colorWrite: false }))
    mesh.renderOrder = -1
    mesh.visible = false
    return mesh
  })()

  private video: HTMLVideoElement
  private tracker: PoseLandmarker
  private onStatus: (s: TrackingStatus) => void

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement, tracker: PoseLandmarker, onStatus: (s: TrackingStatus) => void) {
    this.video = video
    this.tracker = tracker
    this.onStatus = onStatus
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a342d, 1.1))
    // Light from above and to one side so folds and the body's curve read as 3D.
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(0.6, 0.9, 1)
    this.scene.add(key)
    this.scene.add(this.head)
  }

  setGarment(g: Garment) {
    if (this.garment) {
      this.scene.remove(this.garment.object)
      this.garment.dispose()
    }
    this.garment = g
    g.object.visible = false
    this.scene.add(g.object)
    // Ride on the chest bone so the neck follows the body (including turning).
    g.bones.chest.add(this.neck)
  }

  setColor(color: string) {
    this.garment?.setColor(color)
  }

  resize(cw: number, ch: number) {
    this.view.cw = cw
    this.view.ch = ch
    this.renderer.setSize(cw, ch, false)
    this.view.vw = 0 // force the camera to recompute
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  dispose() {
    this.stop()
    this.garment?.dispose()
    this.neck.geometry.dispose()
    this.neck.material.dispose()
    this.head.geometry.dispose()
    this.head.material.dispose()
    this.renderer.dispose()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const v = this.video
    // Only work when the camera has delivered a new frame.
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime || !this.garment) return
    this.lastVideoTime = v.currentTime
    this.syncCamera()

    const ts = Math.max(performance.now(), this.lastTs + 1) // MediaPipe needs strictly increasing timestamps
    this.lastTs = ts
    let fit: 'full' | 'partial' | false = false
    try {
      const res = this.tracker.detectForVideo(v, ts)
      const lm = res.landmarks[0]
      fit = lm ? this.fit(lm, res.worldLandmarks[0], ts / 1000) : false
    } catch {
      fit = false
    }
    if (!fit) {
      this.filters.forEach((f) => f.reset())
      this.head.visible = false
    }
    this.garment.object.visible = !!fit
    this.framesWithoutHips = fit === 'partial' ? this.framesWithoutHips + 1 : 0
    const close = this.framesWithoutHips > CLOSE_AFTER_FRAMES
    this.setStatus(!fit ? 'searching' : close ? 'close' : 'tracking')
    this.renderer.render(this.scene, this.camera)
  }

  private setStatus(s: TrackingStatus) {
    if (s === this.status) return
    this.status = s
    this.onStatus(s)
  }

  private syncCamera() {
    const { cw, ch } = this.view
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    if (!cw || !ch || !vw || !vh || (vw === this.view.vw && vh === this.view.vh)) return
    this.view.vw = vw
    this.view.vh = vh
    const s = Math.max(cw / vw, ch / vh) // object-fit: cover
    const hw = cw / (2 * s)
    const hh = ch / (2 * s)
    Object.assign(this.camera, { left: vw / 2 - hw, right: vw / 2 + hw, top: vh / 2 + hh, bottom: vh / 2 - hh })
    this.camera.updateProjectionMatrix()
  }

  private smooth(key: string, value: number, t: number, beta = 0.01) {
    let f = this.filters.get(key)
    if (!f) this.filters.set(key, (f = new OneEuro(1.0, beta)))
    return f.filter(value, t)
  }

  /** Poses the garment's bones from the landmarks. Returns false when the upper body isn't usable. */
  private fit(lm: NormalizedLandmark[], world: Landmark[] | undefined, t: number): 'full' | 'partial' | false {
    const g = this.garment!
    const { vw, vh } = this.view
    const get = (i: number): Point | null => {
      const l = lm[i]
      if (!l) return null
      return { x: this.smooth(`${i}x`, l.x * vw, t), y: this.smooth(`${i}y`, (1 - l.y) * vh, t), vis: l.visibility ?? 1 }
    }

    const sL = get(LM.shoulderL)
    const sR = get(LM.shoulderR)
    if (!sL || !sR || sL.vis < MIN_VIS || sR.vis < MIN_VIS) return false
    const shoulderPx = Math.hypot(sL.x - sR.x, sL.y - sR.y)
    if (shoulderPx < 8) return false

    const roll = Math.atan2(sL.y - sR.y, sL.x - sR.x)
    // Turning left/right: the shoulders' depth difference (metres, from world landmarks; smaller z = closer).
    const wL = world?.[LM.shoulderL]
    const wR = world?.[LM.shoulderR]
    const rawYaw = wL && wR ? Math.atan2(wL.z - wR.z, wL.x - wR.x) : 0
    const yaw = this.smooth('yaw', Math.max(-MAX_YAW, Math.min(MAX_YAW, rawYaw)), t, 0.3)
    // On screen the shoulders look narrower when turned; undo that so the 3D shirt keeps its true width.
    const width = shoulderPx / Math.max(Math.cos(yaw), 0.45)

    const mid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 }
    const hL = get(LM.hipL)
    const hR = get(LM.hipR)
    let waist: { x: number; y: number }
    let waistRoll = roll
    // The tracker is rarely confident about hips (often ~0.5 even when they are in view), so accept less here.
    const hipsSeen = !!hL && !!hR && hL.vis > HIP_VIS && hR.vis > HIP_VIS
    if (hipsSeen) {
      waist = { x: (hL.x + hR.x) / 2, y: (hL.y + hR.y) / 2 }
      waistRoll = Math.atan2(hL.y - hR.y, hL.x - hR.x)
    } else {
      // Hips out of frame: assume a typical torso length below the shoulders.
      const len = TORSO * width
      waist = { x: mid.x + Math.sin(roll) * len, y: mid.y - Math.cos(roll) * len }
    }
    const lengthScale = Math.hypot(waist.x - mid.x, waist.y - mid.y) / TORSO

    this.fitHead(get(LM.earL), get(LM.earR), roll, width)

    const { chest, waist: waistBone } = g.bones
    chest.position.set(mid.x, mid.y, 0)
    chest.rotation.set(0, yaw, roll)
    chest.scale.set(width * EASE, lengthScale, width)
    waistBone.position.set(waist.x, waist.y, 0)
    waistBone.rotation.set(0, yaw, waistRoll)
    waistBone.scale.set(width * EASE, lengthScale, width)

    const arms = [
      { upper: g.bones.armL, fore: g.bones.foreArmL, shoulder: sL, elbow: get(LM.elbowL), wrist: get(LM.wristL), zSign: -1 },
      { upper: g.bones.armR, fore: g.bones.foreArmR, shoulder: sR, elbow: get(LM.elbowR), wrist: get(LM.wristR), zSign: 1 },
    ]
    const seen = (p: Point | null): p is Point => !!p && p.vis > 0.4
    // Angle that turns a bone's local -y (its rest direction along the arm) to point from `a` to `b`.
    const aim = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2
    // Stretch along the arm to match its length on screen (short when pointing at the camera), within limits.
    const stretch = (seenLen: number, restLen: number) => Math.min(Math.max(seenLen / restLen, 0.6), 1.25)
    for (const { upper, fore, shoulder, elbow, wrist, zSign } of arms) {
      // When the body turns, the far shoulder moves back and the near one forward.
      const z = zSign * 0.5 * width * Math.sin(yaw)
      // No elbow in view: let the arm hang along the body.
      const upperAngle = seen(elbow) ? aim(shoulder, elbow) : roll
      upper.position.set(shoulder.x, shoulder.y, z)
      upper.rotation.set(0, 0, upperAngle)

      const lengths = g.armLengths
      if (!lengths) {
        // Short sleeves: keep proportions; the forearm bone carries no sleeve.
        upper.scale.setScalar(width)
        fore.position.copy(upper.position)
        continue
      }
      const restUpper = lengths.upper * width
      const elbowPos = seen(elbow)
        ? elbow
        : { x: shoulder.x + Math.sin(upperAngle) * restUpper, y: shoulder.y - Math.cos(upperAngle) * restUpper }
      const upperLen = Math.hypot(elbowPos.x - shoulder.x, elbowPos.y - shoulder.y)
      upper.scale.set(width, width * stretch(upperLen, restUpper), width)

      fore.position.set(elbowPos.x, elbowPos.y, z)
      fore.rotation.set(0, 0, seen(wrist) ? aim(elbowPos, wrist) : upperAngle)
      const foreLen = seen(wrist) ? Math.hypot(wrist.x - elbowPos.x, wrist.y - elbowPos.y) : lengths.fore * width
      fore.scale.set(width, width * stretch(foreLen, lengths.fore * width), width)
    }
    return hipsSeen ? 'full' : 'partial'
  }

  /** Places the head occluder from the ears: centred just below them, about as wide as they are apart. */
  private fitHead(earL: Point | null, earR: Point | null, roll: number, bodyWidth: number) {
    if (!earL || !earR || earL.vis < 0.3 || earR.vis < 0.3) {
      this.head.visible = false
      return
    }
    const earW = Math.hypot(earL.x - earR.x, earL.y - earR.y)
    if (earW < 4) {
      this.head.visible = false
      return
    }
    // Down the face, in the body's tilt: from the ears' midpoint towards the chin.
    const drop = earW * 0.15
    this.head.position.set((earL.x + earR.x) / 2 + Math.sin(roll) * drop, (earL.y + earR.y) / 2 - Math.cos(roll) * drop, 0)
    this.head.rotation.set(0, 0, roll)
    this.head.scale.set(earW * 0.62, earW * 0.85, bodyWidth * 0.3)
    this.head.visible = true
  }
}
