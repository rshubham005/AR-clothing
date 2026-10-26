// Copies MediaPipe's WebAssembly runtime into public/ so the app serves it itself (no CDN, nothing leaves the
// device). Runs before `dev` and `build`; the copied folder is git-ignored.
import { cpSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const to = resolve(root, 'public/mediapipe/wasm')

if (!existsSync(from)) {
  console.error('MediaPipe wasm not found. Run `npm install` first.')
  process.exit(1)
}
cpSync(from, to, { recursive: true })
