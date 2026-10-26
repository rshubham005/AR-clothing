// Body tracking with MediaPipe Pose Landmarker. Runs entirely on the device; the model and runtime are served
// from /public/mediapipe (see scripts/copy-mediapipe-wasm.mjs).
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerOptions } from '@mediapipe/tasks-vision'

const BASE = `${import.meta.env.BASE_URL}mediapipe`

export async function createPoseTracker(): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`)
  const options = (delegate: 'GPU' | 'CPU'): PoseLandmarkerOptions => ({
    baseOptions: { modelAssetPath: `${BASE}/pose_landmarker_lite.task`, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    // Some phones have no usable WebGL for MediaPipe; the CPU path is slower but works.
    return await PoseLandmarker.createFromOptions(fileset, options('CPU'))
  }
}
