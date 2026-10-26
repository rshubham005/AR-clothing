// Loads a garment model (.glb made by scripts/build-garment.mjs) as a Garment.
import * as THREE from 'three'
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { BONE_NAMES, type BoneName, type Garment } from './garment'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<GLTF>>()

const load = (src: string) => {
  let p = cache.get(src)
  if (!p) {
    p = loader.loadAsync(src)
    p.catch(() => cache.delete(src)) // allow a retry after a network error
    cache.set(src, p)
  }
  return p
}

/** Each call returns its own copy, so the preview and the live view can pose theirs independently. */
export async function loadModelGarment(src: string, color: string): Promise<Garment> {
  const gltf = await load(src)
  const object = clone(gltf.scene)

  const bones = {} as Record<BoneName, THREE.Bone>
  for (const name of BONE_NAMES) {
    const bone = object.getObjectByName(name)
    if (!(bone instanceof THREE.Bone)) throw new Error(`${src} is missing the "${name}" bone`)
    bone.rotation.order = 'ZYX'
    bones[name] = bone
  }

  const fabric: THREE.MeshStandardMaterial[] = []
  const materials = new Set<THREE.Material>()
  object.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return
    // The posed garment spans hundreds of pixels; its rest-pose bounds are useless for culling.
    o.frustumCulled = false
    // Materials are shared with the cached original; give this copy its own so colours don't leak between views.
    const m = (o.material as THREE.MeshStandardMaterial).clone()
    o.material = m
    materials.add(m)
    if (m.name === 'fabric') fabric.push(m)
  })

  const info = (gltf.scene.userData.garment ?? {}) as { upperArm?: number; foreArm?: number }
  const setColor = (c: string) => fabric.forEach((m) => m.color.set(c))
  setColor(color)

  return {
    object,
    bones,
    armLengths: info.upperArm && info.foreArm ? { upper: info.upperArm, fore: info.foreArm } : undefined,
    restPose: 'posed',
    setColor,
    // Geometry is shared with the cached original, so only this copy's materials are freed.
    dispose: () => materials.forEach((m) => m.dispose()),
  }
}
