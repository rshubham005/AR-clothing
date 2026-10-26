# Fitting Room

A single page where you pick a garment, see it in 3D, and try it on live with your phone's (or laptop's) camera.
No login, no database, no backend. The camera video never leaves the device.

## What it does
- **Collection:** Dress Shirt and Hoodie (real 3D models), Classic Tee, Oversized Tee, Crop Tee and Tank Top, each in several colours.
- **3D preview:** the selected garment turns slowly; drag to turn it by hand.
- **Try it on:** opens the front camera. MediaPipe Pose tracks the body on the device and a 3D garment
  (three.js) is drawn over the video, following the shoulders, hips, arms and forearms, including turning sideways.
  Phones can switch to the back camera so someone else can point it at you.

## Run
```
npm install
npm run dev        # http://localhost:5173 (also on your LAN)
npm run build      # typecheck + production build into dist/
```

The camera needs **HTTPS** on a phone (`localhost` on a computer is fine). To test on a phone, deploy
(e.g. `vercel`; `vercel.json` is included) or use an HTTPS tunnel such as
`npx cloudflared tunnel --url http://localhost:5173`.

## Garments
- **Dress Shirt** and **Hoodie** are real garment models (`public/garments/*.glb`); long sleeves follow the forearms.
- **Classic / Oversized / Crop Tee** and **Tank Top** are built in code (`src/tryon/garment.ts`) until models exist.

### Adding a garment model
1. Put the source `.obj` in `garments-src/<name>/` (git-ignored: purchased source files should not be published).
2. Add a config in `scripts/garments/<name>.json` (copy `dress-shirt.json`): input, output, the two sleeve
   material groups, parts to drop (e.g. button threads), fixed-colour parts (e.g. buttons), target triangle count.
   CLO3D exports (like the hoodie) give every pattern piece the same material: set `"splitPieces": true` to name
   them `piece_0`, `piece_1`, ... and `"layers": 3` to keep one of the outer/inner/edge copies CLO writes per piece.
   Sleeve pieces can be listed by number; cuffs are picked up automatically by their position on the arm.
3. Run `node scripts/build-garment.mjs scripts/garments/<name>.json`. It reduces the mesh, rescales it to the rig,
   finds shoulder/elbow/wrist from the sleeves, adds bones and skin weights, and writes the `.glb`.
4. Add an entry with `model: '/garments/<name>.glb'` to `src/tryon/catalog.ts`.

The garment must face +z with the wearer's left at +x and its sleeves as two separate material groups.
The rig (bones `chest`, `waist`, `armL`, `armR`, `foreArmL`, `foreArmR`) is described at the top of
`src/tryon/garment.ts`; a model rigged by hand in Blender to that contract works too.

### Licences
The dress shirt comes from CGTrader ("Realistic Dress Shirt v1"). If it is under CGTrader's Royalty Free licence, that
licence asks buyers to stop end users from getting the model file, and a web app has to send the file to the browser.
Check the licence (and ask the seller if needed) before a public launch.
The hoodie ("Hoodie model free 3D model", CGTrader) asks for credit to its author, andrewchristin; the page footer
credits every catalogue item that has a `credit` entry.

Invisible neck and head shapes (from the tracked shoulders and ears) hide the parts of a garment behind them, such
as the back of a collar or a lowered hood.

Known limits: no cloth physics, arms crossing in front of the chest are hidden behind the garment, and the fit is a
visual preview, not a size guide.

## Files
| File | Purpose |
|---|---|
| `src/App.tsx` | Page shell, in-app-browser warning, credits |
| `src/tryon/TryOn.tsx` | The fitting room: stage, camera, collection and colour pickers |
| `src/tryon/catalog.ts` | The garments on offer and their colours |
| `src/tryon/garment.ts` | Garment rig contract + garments built in code |
| `src/tryon/modelGarment.ts` | Loads garment models (.glb) |
| `scripts/build-garment.mjs` | Converts a garment model (.obj) into a rigged, phone-sized .glb |
| `src/tryon/preview.ts` | Turning 3D preview shown before the camera starts |
| `src/tryon/engine.ts` | Fits the garment's bones to the tracked body each frame and draws it over the video |
| `src/tryon/poseTracker.ts` | MediaPipe Pose setup (GPU, falls back to CPU); loaded on first "Try it on" |
| `src/tryon/oneEuro.ts` | Smoothing filter that stops the garment jittering |
| `src/userAgent.ts` | Phone and in-app-browser detection |
| `public/mediapipe/` | Bundled pose model; the MediaPipe runtime is copied here from `node_modules` before `dev`/`build` |

`archive/furniture/` holds the furniture viewer this project started as (code, models, old `vercel.json`). It is not
part of the build and can be deleted.

## Credits
Body tracking: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
(Apache 2.0).
