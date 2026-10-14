# Grok Bot overnight report — branch `grok-overnight`

Coding tool: I wrote all the code directly. `agy` (Antigravity CLI) is installed on the box, but I did not use it.
Render setup: headless Chromium with SwiftShader software WebGL (no GPU), running at about 3 FPS.

## Review of Astra's work (`astra-production-pass` @ 401bcdd vs main)
- **Good:** One layout file (`heist-layout.json`) for the level. A hand-built mission path: reception → under-desk crawl → vent → two-key office → server gallery → robotics lab/vault → west escape spine → pickup. A strong Blender hero kit (`robotics-hero.glb`, 1.07 MB). Shared PBR palette. A new cinematic camera. All of it builds cleanly.
- **Risks:**
  1. The server rack trim and fixtures were about 180 separate meshes, which meant roughly 494 draw calls.
  2. Shadows only cover about ±24 units around the lab.
  3. Outside the lab, everything was still plain boxes.
  4. `verify-gameplay` and `verify-dev-local` still use waypoints from the old TestRoom, which go through the new walls. They will fail on any machine until someone re-routes them.
  5. The verifiers hardcode `--use-angle=d3d11` (Windows only). I added an `ANGLE` env override.
  6. One 6.2 MB JS bundle (1.36 MB gzip).

## What changed (commits)
- `6b96a81` New `src/level/AreaDressing.ts` adds collision-free set dressing to every area outside the lab, batched into one merged mesh per material:
  - **Reception:** plants, mustard sofa, coffee table with books, framed art, pendants, entry mat, yellow wayfinding marks to the staff vent.
  - **Vent:** louvres, ductwork, hazard chevrons.
  - **Office:** two chairs, keyboards, mugs, notebooks, sticky notes, cables, whiteboard heist plan, bookshelf with colourful bins, plants, rug trim, pendants.
  - **Server:** overhead cable trays (matching the "follow the cable trays" sign), cyan and amber LED bars on the racks, cold-aisle tiles, keep-clear lines, cooling units with live-looking screens, copper pipes.
  - **Escape spine:** wall pipes, storage shelving with bins, floor chevrons, pickup hazard border.
  - **Also in this commit:** `mergeDecorative()` batches Astra's physics-free trim. New `tools/capture-areas.mjs` (headless screenshots + scene stats). ANGLE override for the verifiers.
- *(second commit)* **Objective beacons.** A spinning gold diamond and a pulsing floor ring mark the next goal(s): terminals A and B, then C, then the vault core, then pickup. They turn mint during the alarm. They only read existing mission state, with no network or physics changes. Also added a cheap filmic vignette and colour curves.
- *(this report)* `docs/GROKBOT_OVERNIGHT_REPORT.md`.
- **Left alone:** no changes to flight, tether, hacking, security, server or replication code. The only change in `MissionDirector.ts` passes three extra read-only fields to the presentation layer.

## Performance (same capture tool, software render, 1280x720, dev-local)
| | Before (Astra) | After |
|---|---|---|
| Meshes | 377 | 200 |
| Active meshes | 243 | 159 |
| Draw calls | 494 | 326 |
| Materials | 67 | 81 |
| Triangles | 94k | 122k |
| Scene frame time (CPU) | 9.5 ms | 6.6 ms |
| FPS (SwiftShader) | 3.8 | 2.7–3.0 (fill-bound; not meaningful) |
| Bundle | 6.25 MB | about the same |

Draw calls went down about 34% even with far more visible detail. Real GPU FPS still needs measuring on the 1070.

## Tests
| Verifier | Baseline (Astra) | Final |
|---|---|---|
| `npm run build` (tsc + vite) | pass | pass |
| verify-multiplayer | **pass** | **pass** |
| verify-heist | fail: NEE stalled at vent (-1.6, 6.9, -42.5) | fail: "Could not activate NEE" (Tab timing) |
| verify-multiplayer-heist | fail: same vent stall | fail: NEE missed a 0.45-tolerance point at reception |
| verify-gameplay | fail: old TestRoom waypoint | fail: same |
| verify-dev-local | fail: old TestRoom waypoint | fail: same |

- The heist verifiers steer by timed key presses. At 3 FPS in software render they can't steer reliably, so they failed both before and after my changes, at different points each run.
- **The full mission has NOT been verified end-to-end on the new branch.** Please run `node tools/verify-heist.mjs` and `node tools/verify-multiplayer-heist.mjs` on the 1070 PC.
- All the new decoration is collision-free, so it should not block any route. But a drone can now fly visually through a sofa or shelf.
- Stress tests were not run.

## Remaining problems
- The other areas now read as furnished, but they're still procedural primitives. They don't match the bevelled Blender quality of the lab and vault.
- Shadows only cover the lab.
- Old verifiers need re-routing for the new layout.
- Bundle size and code-splitting.
- No real-GPU frame numbers.
- Beacons and dressing haven't been playtested by a human.

## Recommended next
1. Run the heist verifiers and a short playtest on the 1070 to confirm nothing regressed. Check that the beacons help.
2. Re-route `verify-gameplay` and `verify-dev-local` to the new level.
3. Build a Blender kit (`tools/blender/build_office.py`) for the sofa, chairs, racks and shelving, replacing the primitives one-for-one.
4. Use a cascaded shadow generator or baked AO for the non-lab areas.
5. Lazy-load Havok and Colyseus to cut the bundle size.

## Screenshots (`/workspace/handshake/report/screens/`)
`before-*.png` = Astra baseline, `after-*.png` = grok-overnight. Same camera for each pair.
- reception: lobby, desk and under-desk route
- vent: staff vent climb
- office: two-key office
- server: memory array gallery
- lab-vault: hero lab and vault (quality reference, mostly unchanged)
- escape: west relief spine toward pickup
- gameplay-camera: spawn view in the real gameplay camera
