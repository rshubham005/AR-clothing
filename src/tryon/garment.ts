// Garments for try-on and the rig every garment must follow.
//
// Rig contract (the built-in garments follow it; a real rigged .glb must too):
// - Units: the distance between the two shoulder JOINTS is 1. Origin is midway between the shoulders.
// - Axes: +x is the wearer's left (image right when they face the camera), +y up, +z towards the camera.
// - Six bones, none nested (so a stretched torso can't shear the sleeves); each is posed in world space:
//     chest     at (0, 0, 0)          follows the shoulder line
//     waist     at (0, -TORSO, 0)     follows the hip line
//     armL      at (+0.5, 0, 0)       wearer's left upper arm, at the shoulder joint
//     armR      at (-0.5, 0, 0)       wearer's right upper arm
//     foreArmL  at the left elbow     (only long sleeves use the forearm bones)
//     foreArmR  at the right elbow
// - Each arm bone's local -y axis runs along its arm segment in the rest pose (any rest angle works).
// - Vertices between chest and waist blend between those two bones; sleeves follow their arm bones.
// scripts/build-garment.mjs turns a garment model into a .glb that follows this contract.
import * as THREE from 'three'

export const TORSO = 1.4
export const BONE_NAMES = ['chest', 'waist', 'armL', 'armR', 'foreArmL', 'foreArmR'] as const
export type BoneName = (typeof BONE_NAMES)[number]

export interface Garment {
  object: THREE.Object3D
  bones: Record<BoneName, THREE.Bone>
  /** Rest-pose arm segment lengths (rig units) for garments with long sleeves; sleeves then stretch to the arm. */
  armLengths?: { upper: number; fore: number }
  /** 'arms-down' garments get their arms spread a little in the 3D preview. */
  restPose: 'arms-down' | 'posed'
  setColor(color: string): void
  dispose(): void
}

/** Shape of a garment built in code. */
export interface GarmentShape {
  /** Short sleeves, or none (tank top). */
  sleeves: 'short' | 'none'
  /** Hem height as a fraction of the shoulder-to-hip distance (1 = at the hips). */
  length: number
  /** How far the front neckline dips below the collar, in rig units. */
  neckDip: number
  /** Body width multiplier (1 = regular fit). */
  fit: number
  /** Sleeve length in rig units. */
  sleeveLength: number
}

// Proportions shared by all built-in garments (rig units).
const NECK = 0.2 // half-width of the neck opening
const TOP = 0.14 // height of the collar above the shoulder joints
const HALF_W = 0.6 // half-width of the body at the chest
const HALF_D = 0.3 // half-depth of the body
const SLEEVE_R = 0.21
const STRAP = 0.17 // tank-top strap width

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)

/** Height of the garment's top edge at horizontal distance `ax` from the centre (neckline, shoulders, armholes). */
function topEdge(ax: number, front: boolean, shape: GarmentShape, halfW: number): number {
  if (ax < NECK) {
    const dip = front ? shape.neckDip : 0.05
    return TOP - dip * Math.sqrt(1 - (ax / NECK) ** 2)
  }
  const shoulder = (a: number) => TOP - TOP * Math.min((a - NECK) / (halfW - NECK), 1.3) ** 1.2
  if (shape.sleeves === 'none' && ax > NECK + STRAP) {
    // Armhole: drops from the end of the strap to under the arm.
    const u = clamp01((ax - NECK - STRAP) / (halfW - NECK - STRAP))
    return shoulder(NECK + STRAP) - 0.45 * smooth(u)
  }
  return shoulder(ax)
}

interface Builder {
  pos: number[]
  idx: number[]
  skinIdx: number[]
  skinW: number[]
}

/** A closed tube made of `rows` rings of `cols` points; `point(i, j)` gives position and bone weights. */
function addTube(b: Builder, rows: number, cols: number, point: (i: number, j: number) => { p: [number, number, number]; bones: [number, number]; w: [number, number] }) {
  const start = b.pos.length / 3
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const { p, bones, w } = point(i, j)
      b.pos.push(...p)
      b.skinIdx.push(bones[0], bones[1], 0, 0)
      b.skinW.push(w[0], w[1], 0, 0)
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = start + i * cols + j
      const bb = start + i * cols + ((j + 1) % cols)
      const c = a + cols
      const d = bb + cols
      b.idx.push(a, c, bb, bb, c, d)
    }
  }
}

/** Builds a simple top in code, so try-on works before real garment models exist. */
export function createGarment(shape: GarmentShape, color: string): Garment {
  const b: Builder = { pos: [], idx: [], skinIdx: [], skinW: [] }
  const [CHEST, WAIST, ARM_L, ARM_R] = [0, 1, 2, 3]
  const halfW = HALF_W * shape.fit
  const hem = -TORSO * shape.length

  // Body: an elliptical tube from the shoulders down to the hem.
  const COLS = 64
  const ROWS = 28
  addTube(b, ROWS, COLS, (i, j) => {
    const theta = (j / COLS) * Math.PI * 2
    const sx = Math.sin(theta)
    const cz = Math.cos(theta)
    const t = i / (ROWS - 1)
    const yTop = topEdge(Math.abs(sx * halfW), cz > 0, shape, halfW)
    const y = yTop + (hem - yTop) * t
    const down = clamp01(-y / TORSO)
    const hw = halfW - 0.04 * down
    const hd = HALF_D * (0.95 + 0.05 * shape.fit) - 0.02 * down
    const toWaist = smooth(down)
    return { p: [hw * sx, y, hd * cz], bones: [CHEST, WAIST], w: [1 - toWaist, toWaist] }
  })

  // Sleeves: a rounded cap over the shoulder joint, then a slightly flared tube with a hem that is shorter on the
  // side facing the body (like a real set-in sleeve).
  if (shape.sleeves === 'short') {
    const CAP_TOP = 0.07
    const CAP_H = 0.14
    const CAP_ROWS = 6
    const SROWS = CAP_ROWS + 8
    const SCOLS = 32
    const radius = SLEEVE_R * (0.6 + 0.4 * shape.fit)
    for (const [side, bone] of [
      [1, ARM_L],
      [-1, ARM_R],
    ] as const) {
      addTube(b, SROWS, SCOLS, (i, j) => {
        const theta = (j / SCOLS) * Math.PI * 2
        const s = Math.sin(theta)
        const c = Math.cos(theta)
        let r: number
        let y: number
        if (i < CAP_ROWS) {
          const phi = (i / (CAP_ROWS - 1)) * (Math.PI / 2)
          r = Math.max(radius * 0.92 * Math.sin(phi), 0.01)
          y = CAP_TOP - CAP_H * (1 - Math.cos(phi))
        } else {
          const t = (i - CAP_ROWS + 1) / (SROWS - CAP_ROWS)
          r = radius * (0.92 + 0.12 * t)
          const inner = Math.max(0, -side * s) // 1 on the side facing the body
          const yEnd = -shape.sleeveLength + 0.12 * inner
          y = CAP_TOP - CAP_H + (yEnd - CAP_TOP + CAP_H) * t
        }
        return { p: [side * 0.5 * shape.fit + r * s, y, r * c * 0.9], bones: [bone, CHEST], w: [1, 0] }
      })
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.skinIdx, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.skinW, 4))
  geometry.setIndex(b.idx)
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  // The rest pose is ~1 unit wide but the posed garment spans hundreds of pixels; skip culling on stale bounds.
  mesh.frustumCulled = false

  const rest: Record<BoneName, [number, number]> = {
    chest: [0, 0],
    waist: [0, -TORSO],
    armL: [0.5, 0],
    armR: [-0.5, 0],
    foreArmL: [0.5, -0.6],
    foreArmR: [-0.5, -0.6],
  }
  const bones = {} as Record<BoneName, THREE.Bone>
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(rest[name][0], rest[name][1], 0)
    bone.rotation.order = 'ZYX' // turn (yaw) first, then tilt (roll)
    mesh.add(bone)
    bones[name] = bone
  }
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(BONE_NAMES.map((n) => bones[n])))

  return {
    object: mesh,
    bones,
    restPose: 'arms-down',
    setColor: (c) => material.color.set(c),
    dispose: () => {
      geometry.dispose()
      material.dispose()
      mesh.skeleton.dispose()
    },
  }
}
