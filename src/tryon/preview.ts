// A slowly turning 3D view of the selected garment, shown before the camera starts. Drag to turn it by hand.
import * as THREE from 'three'
import type { Garment } from './garment'

const ARM_SPREAD = 0.35 // radians; arms slightly away from the body so the sleeves read clearly

export class GarmentPreview {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50)
  private garment: Garment | null = null
  private raf = 0
  private yaw = -0.5
  private spin = 0.35 // radians per second
  private last = 0
  private drag: { x: number; yaw: number } | null = null
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a342d, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(1.5, 2, 3)
    this.scene.add(key)

    canvas.style.touchAction = 'pan-y'
    canvas.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
  }

  setGarment(g: Garment) {
    if (this.garment) {
      this.scene.remove(this.garment.object)
      this.garment.dispose()
    }
    this.garment = g
    if (g.restPose === 'arms-down') {
      g.bones.armL.rotation.z = ARM_SPREAD
      g.bones.armR.rotation.z = -ARM_SPREAD
    }
    g.object.rotation.y = 0
    this.scene.add(g.object)
    this.frame()
  }

  /** Fits the garment in view (whatever way it is turned), in the upper part of the stage, clear of the button. */
  private frame() {
    const g = this.garment
    if (!g) return
    const turn = g.object.rotation.y
    g.object.rotation.y = 0
    g.object.updateMatrixWorld(true)
    const box = new THREE.Box3()
    g.object.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return
      o.computeBoundingBox() // includes the current bone pose
      box.union(o.boundingBox!.clone().applyMatrix4(o.matrixWorld))
    })
    g.object.rotation.y = turn
    if (box.isEmpty()) return
    const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)
    const halfH = (box.max.y - box.min.y) / 2
    const centerY = (box.max.y + box.min.y) / 2
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const dist = 1.3 * Math.max(halfH / tan, radius / (tan * this.camera.aspect))
    const lookY = centerY - 0.2 * dist * tan
    this.camera.position.set(0, lookY + 0.1 * halfH, dist)
    this.camera.lookAt(0, lookY, 0)
  }

  setColor(color: string) {
    this.garment?.setColor(color)
  }

  resize(w: number, h: number) {
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the whole garment in view on narrow screens.
    this.camera.updateProjectionMatrix()
    this.frame()
  }

  start() {
    if (this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  dispose() {
    this.stop()
    this.canvas.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    this.garment?.dispose()
    this.renderer.dispose()
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now
    if (!this.drag) this.yaw += this.spin * dt
    if (this.garment) this.garment.object.rotation.y = this.yaw
    this.renderer.render(this.scene, this.camera)
  }

  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, yaw: this.yaw }
  }

  private onMove = (e: PointerEvent) => {
    if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.01
  }

  private onUp = () => {
    this.drag = null
  }
}
