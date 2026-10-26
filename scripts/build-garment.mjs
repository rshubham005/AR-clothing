// Turns a garment model (.obj) into a try-on ready .glb that follows the rig in src/tryon/garment.ts:
//   - removes unwanted parts (e.g. button threads) and reduces the triangle count for phones
//   - rescales so the shoulder joints are 1 unit apart, centred between the shoulders
//   - finds the shoulder, elbow and wrist positions from the sleeves and adds the bones
//     chest, waist, armL, foreArmL, armR, foreArmR with skin weights
//
// Usage: node scripts/build-garment.mjs <config.json>
// The config lists the input file, output file and which material groups are sleeves (see scripts/garments/).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import * as THREE from 'three'

const TORSO = 1.4 // must match src/tryon/garment.ts
const ELBOW_AT = 0.54 // elbow position along shoulder→wrist (upper arm is a bit longer than the forearm)

const configPath = process.argv[2]
if (!configPath) {
  console.error('Usage: node scripts/build-garment.mjs <config.json>')
  process.exit(1)
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
const here = dirname(resolve(configPath))
const input = resolve(here, cfg.input)
const output = resolve(here, cfg.output)
const drop = new Set(cfg.drop ?? [])
const sleeves = new Set(cfg.sleeves ?? [])
const fixed = cfg.fixedMaterials ?? {} // material group → colour that never changes (buttons etc.)
// Some exporters (e.g. CLO3D) give every pattern piece the same material name. With "splitPieces", each `usemtl`
// starts a new group named piece_0, piece_1, ... so sleeves can be listed by piece number.
const splitPieces = !!cfg.splitPieces
// CLO3D also exports each piece three times (outer surface, inner surface, edge strip). "layers": 3 keeps only the
// first of every three, which saves two thirds of the triangles; the material is double-sided anyway.
const layers = cfg.layers ?? 1
let pieceCount = -1

// ---- 1. Read the OBJ: positions and triangles per material group (UVs/normals are not used: no textures). ----
const V = []
const tris = [] // [a, b, c, group]
let group = 'default'
for (const line of readFileSync(input, 'latin1').split('\n')) {
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.trim().split(/\s+/)
    V.push([+x, +y, +z])
  } else if (line.startsWith('usemtl')) {
    pieceCount++
    group = splitPieces ? `piece_${pieceCount}` : line.slice(6).trim()
  } else if (line.startsWith('f ') && !drop.has(group) && pieceCount % layers === 0) {
    const idx = line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((t) => {
        const i = parseInt(t.split('/')[0], 10)
        return i < 0 ? V.length + i : i - 1
      })
    for (let k = 1; k < idx.length - 1; k++) tris.push([idx[0], idx[k], idx[k + 1], group])
  }
}
console.log(`read ${V.length} vertices, ${tris.length} triangles (after dropping ${[...drop].join(', ') || 'nothing'})`)

// ---- 2. Find the arm joints from each sleeve: principal axis through the sleeve, cap end → shoulder, cuff → wrist. ----
const sleeveVerts = { L: new Set(), R: new Set() }
{
  const byGroup = new Map()
  for (const [a, b, c, g] of tris) {
    if (!sleeves.has(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, new Set())
    for (const i of [a, b, c]) byGroup.get(g).add(i)
  }
  // A side's sleeve may be several groups. +x is the wearer's left (the garment faces +z); the model need not be
  // centred on x = 0, so compare with the middle of its bounding box.
  let minX = Infinity
  let maxX = -Infinity
  for (const [x] of V) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  const centerX = (minX + maxX) / 2
  for (const set of byGroup.values()) {
    const meanX = [...set].reduce((s, i) => s + V[i][0], 0) / set.size
    for (const i of set) sleeveVerts[meanX > centerX ? 'L' : 'R'].add(i)
  }
  if (!sleeveVerts.L.size || !sleeveVerts.R.size) throw new Error(`need sleeve groups on both sides, found ${[...byGroup.keys()]}`)
}

function principalAxis(points) {
  const n = points.length
  const c = [0, 0, 0]
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / n
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const p of points)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += ((p[i] - c[i]) * (p[j] - c[j])) / n
  let v = [1, -1, 0]
  for (let it = 0; it < 50; it++) {
    const w = [0, 1, 2].map((i) => cov[i][0] * v[0] + cov[i][1] * v[1] + cov[i][2] * v[2])
    const len = Math.hypot(...w)
    v = w.map((x) => x / len)
  }
  return { c, v }
}

const percentile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

const joints = {}
for (const side of ['L', 'R']) {
  const pts = [...sleeveVerts[side]].map((i) => V[i])
  const { c, v } = principalAxis(pts)
  // Point the axis away from the body.
  const sign = side === 'L' ? 1 : -1
  const dir = v[0] * sign < 0 ? v.map((x) => -x) : v
  const ts = pts.map((p) => (p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1] + (p[2] - c[2]) * dir[2])
  const at = (t) => c.map((x, k) => x + dir[k] * t)
  const tCap = percentile(ts, 0.01)
  const tCuff = percentile(ts, 0.995)
  const span = tCuff - tCap
  // The shoulder joint sits a little inside the top of the sleeve cap; the wrist a little inside the cuff.
  const shoulder = at(tCap + span * (cfg.shoulderInset ?? 0.06))
  const wrist = at(tCuff - span * (cfg.cuffInset ?? 0.03))
  joints[side] = { shoulder, wrist }
}
// The tracker's shoulder points sit a little below the top of the shoulder. Put the joint that far below the
// garment's top edge (measured at the joint's x), rather than trusting the sleeve axis for height.
{
  const width = Math.abs(joints.L.shoulder[0] - joints.R.shoulder[0])
  const used = new Set(tris.flatMap(([a, b, c]) => [a, b, c]))
  for (const side of ['L', 'R']) {
    const j = joints[side]
    let top = -Infinity
    for (const i of used) if (Math.abs(V[i][0] - j.shoulder[0]) < width * 0.025) top = Math.max(top, V[i][1])
    j.shoulder[1] = top - width * (cfg.shoulderDrop ?? 0.11)
    j.elbow = j.shoulder.map((x, k) => x + (j.wrist[k] - x) * ELBOW_AT)
  }
}
// Joints sit on the body's centre plane in depth (the middle of the garment front to back; models are not always
// placed at z = 0).
{
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [a, b, c] of tris)
    for (const i of [a, b, c]) {
      minZ = Math.min(minZ, V[i][2])
      maxZ = Math.max(maxZ, V[i][2])
    }
  for (const side of ['L', 'R']) for (const j of Object.values(joints[side])) j[2] = (minZ + maxZ) / 2
}

const mid = joints.L.shoulder.map((x, k) => (x + joints.R.shoulder[k]) / 2)
const scale = 1 / Math.hypot(...joints.L.shoulder.map((x, k) => x - joints.R.shoulder[k]))
const norm = (p) => p.map((x, k) => (x - mid[k]) * scale)
for (const side of ['L', 'R']) for (const k of ['shoulder', 'elbow', 'wrist']) joints[side][k] = norm(joints[side][k])
// The contract puts the shoulders at exactly (±0.5, 0, 0); remove any small tilt or depth offset.
for (const side of ['L', 'R']) {
  const s = joints[side].shoulder
  const off = [(side === 'L' ? 0.5 : -0.5) - s[0], -s[1], -s[2]]
  for (const k of ['shoulder', 'elbow', 'wrist']) joints[side][k] = joints[side][k].map((x, i) => x + off[i])
}
const P = V.map(norm)
const upperLen = Math.hypot(...joints.L.elbow.map((x, k) => x - joints.L.shoulder[k]))
const foreLen = Math.hypot(...joints.L.wrist.map((x, k) => x - joints.L.elbow[k]))
console.log('joints (rig units):', JSON.stringify(joints, (_, x) => (typeof x === 'number' ? +x.toFixed(3) : x)))
console.log(`upper arm ${upperLen.toFixed(3)}, forearm ${foreLen.toFixed(3)}, scale ${scale.toFixed(5)}/source unit`)
if (cfg.debugJoints) writeFileSync(resolve(here, cfg.debugJoints), JSON.stringify({ mid, scale, joints }, null, 2))

// ---- 3. Skin weights. ----
const BONES = ['chest', 'waist', 'armL', 'foreArmL', 'armR', 'foreArmR']
const B = Object.fromEntries(BONES.map((n, i) => [n, i]))
const smooth = (t) => {
  const x = Math.min(Math.max(t, 0), 1)
  return x * x * (3 - 2 * x)
}
const weights = new Map() // vertex → [[bone, w], ...]
function torsoWeights(p) {
  const down = smooth(-p[1] / TORSO)
  return [
    [B.chest, 1 - down],
    [B.waist, down],
  ]
}
function sleeveWeights(p, side) {
  const j = joints[side]
  const axis = j.wrist.map((x, k) => x - j.shoulder[k])
  const len2 = axis.reduce((s, x) => s + x * x, 0)
  const u = p.reduce((s, x, k) => s + (x - j.shoulder[k]) * axis[k], 0) / len2 // 0 at shoulder, 1 at wrist
  const fore = smooth((u - ELBOW_AT + 0.08) / 0.16) // soft bend around the elbow
  const body = 1 - smooth((u + 0.02) / 0.2) // the sleeve cap stretches between chest and arm
  return [
    [B.chest, body],
    [B[`arm${side}`], (1 - body) * (1 - fore)],
    [B[`foreArm${side}`], (1 - body) * fore],
  ]
}
// Parts that ride on the arm but aren't in a sleeve group (cuffs, cuff buttons): anything far enough along an arm
// and close to its axis follows that arm.
function armSide(p) {
  for (const side of ['L', 'R']) {
    const j = joints[side]
    const axis = j.wrist.map((x, k) => x - j.shoulder[k])
    const len2 = axis.reduce((s, x) => s + x * x, 0)
    const u = p.reduce((s, x, k) => s + (x - j.shoulder[k]) * axis[k], 0) / len2
    const foot = j.shoulder.map((x, k) => x + axis[k] * u)
    if (u > 0.3 && u < 1.3 && Math.hypot(...p.map((x, k) => x - foot[k])) < 0.3) return side
  }
  return null
}
for (const [a, b, c, g] of tris) {
  for (const i of [a, b, c]) {
    if (weights.has(i)) continue
    const side = sleeves.has(g) ? (sleeveVerts.L.has(i) ? 'L' : 'R') : armSide(P[i])
    weights.set(i, side ? sleeveWeights(P[i], side) : torsoWeights(P[i]))
  }
}

// ---- 4. Build the glTF: one primitive per material ("fabric" + any fixed-colour parts). ----
const doc = new Document()
const buffer = doc.createBuffer()
const fabric = doc.createMaterial('fabric').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0).setDoubleSided(true)
const parts = new Map([['fabric', { material: fabric, tris: [] }]])
for (const [name, hex] of Object.entries(fixed)) {
  const col = new THREE.Color(hex)
  const m = doc.createMaterial(name).setBaseColorFactor([col.r, col.g, col.b, 1]).setRoughnessFactor(0.5).setMetallicFactor(0)
  parts.set(name, { material: m, tris: [] })
}
for (const t of tris) (parts.get(t[3]) ?? parts.get('fabric')).tris.push(t)

const mesh = doc.createMesh('garment')
for (const [name, part] of parts) {
  if (!part.tris.length) continue
  const remap = new Map()
  const pos = []
  const jnt = []
  const wgt = []
  const idx = []
  for (const [a, b, c] of part.tris) {
    for (const i of [a, b, c]) {
      if (!remap.has(i)) {
        remap.set(i, remap.size)
        pos.push(...P[i])
        const w = weights.get(i).filter(([, x]) => x > 1e-3)
        const total = w.reduce((s, [, x]) => s + x, 0)
        for (let k = 0; k < 4; k++) {
          jnt.push(w[k]?.[0] ?? 0)
          wgt.push(w[k] ? w[k][1] / total : 0)
        }
      }
      idx.push(remap.get(i))
    }
  }
  const prim = doc
    .createPrimitive()
    .setMaterial(part.material)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(jnt)).setBuffer(buffer))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(wgt)).setBuffer(buffer))
  prim.setName(name)
  mesh.addPrimitive(prim)
}

// Bones: arms are turned so their local -y runs along the sleeve (the engine assumes this).
const rest = {
  chest: { t: [0, 0, 0], a: 0 },
  waist: { t: [0, -TORSO, 0], a: 0 },
}
for (const side of ['L', 'R']) {
  const j = joints[side]
  const angle = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]) + Math.PI / 2
  rest[`arm${side}`] = { t: j.shoulder, a: angle(j.shoulder, j.elbow) }
  rest[`foreArm${side}`] = { t: j.elbow, a: angle(j.elbow, j.wrist) }
}
const scene = doc.createScene('garment')
const skin = doc.createSkin('garment')
const ibm = []
for (const name of BONES) {
  const { t, a } = rest[name]
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a)
  const node = doc.createNode(name).setTranslation(t).setRotation([q.x, q.y, q.z, q.w])
  scene.addChild(node)
  skin.addJoint(node)
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...t), q, new THREE.Vector3(1, 1, 1)).invert()
  ibm.push(...m.elements)
}
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(new Float32Array(ibm)).setBuffer(buffer))
const meshNode = doc.createNode('garment').setMesh(mesh).setSkin(skin)
scene.addChild(meshNode)
scene.setExtras({ garment: { rig: 1, upperArm: +upperLen.toFixed(4), foreArm: +foreLen.toFixed(4) } })
doc.getRoot().setDefaultScene(scene)

// ---- 5. Optimise: merge duplicate vertices, simplify to the target size, smooth normals. ----
await MeshoptSimplifier.ready
const before = tris.length
await doc.transform(weld())
const ratio = Math.min(1, (cfg.targetTriangles ?? 25000) / before)
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.simplifyError ?? 0.01 }), prune())
// Smooth normals on the shared (welded) vertices. gltf-transform's normals() would un-share them and triple the size.
for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION').getArray()
  const idx = prim.getIndices().getArray()
  const n = new Float32Array(pos.length)
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3]
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]]
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]]
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] += f[k]
  }
  for (let v = 0; v < n.length; v += 3) {
    const len = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1
    for (let k = 0; k < 3; k++) n[v + k] /= len
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(buffer))
}
let after = 0
for (const p of mesh.listPrimitives()) after += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
const glb = await new NodeIO().writeBinary(doc)
writeFileSync(output, glb)
console.log(`triangles ${before} → ${after}; wrote ${output} (${(glb.byteLength / 1024).toFixed(0)} KB)`)
