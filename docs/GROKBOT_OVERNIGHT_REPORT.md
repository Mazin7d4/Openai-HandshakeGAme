# Grok Bot overnight report: branch `grok-overnight`

Coding tool: I wrote all the code directly. I did not use Antigravity CLI.
Render setup: headless Chromium with SwiftShader software WebGL (no GPU). It runs at 2–5 FPS, so FPS numbers from it mean nothing. Draw calls and CPU frame time are the useful numbers.

## Review of Astra's work (`astra-production-pass` @ 401bcdd)
- **Good:** one data-driven layout (`heist-layout.json`), a hand-built mission route (reception → under-desk → vent → two-key office → server gallery → lab/vault → escape spine → pickup), a strong Blender hero kit, a shared PBR palette and a cinematic camera.
- **Risks found:** about 494 draw calls; shadows only around the lab; plain boxes outside the lab; old verifiers routed through the new walls; ANGLE hardcoded to d3d11; one 6.2 MB bundle.

## Commits since 401bcdd (in order)
1. `6b96a81` Dressed reception, vent, office, server and escape areas. Merged decorative meshes (494 → 318 draw calls). Added the headless area-capture tool and the ANGLE override.
2. `afcccab` Objective beacons on the next goal(s). Filmic vignette and colour curves. Fixed the escape review camera.
3. `197fead` First overnight report.
4. `2b2d769` Verifiers re-routed to Astra's layout, with steering that tolerates low FPS and retries. Added `?scale=` and `?lowfx` render flags and the `tools/verify-all.mjs` runner. **Bug fix:** grabbable objects no longer tunnel out of the world.
5. `9b225a8` Blender prop kit (`office-kit.glb`, instanced): sofa, chairs, racks, shelving, plants, cooling units, duct, bookshelf. Static colliders on big props, so drones no longer pass through sofas or shelves. The prototype stays cradled until its first grab.
6. `25649c6` **Code split.** Engine, physics and level now lazy-load, and the start chunk is 186 kB (was 6.2 MB), so the menu shows instantly while the game downloads in the background. The level chunk is still 5.9 MB (1.28 MB gzip).
7. `14139d5` **Shadows across every area.** The shadow frustum follows the camera and snaps to a 2 m grid to avoid shimmer. Blender props cast shadows. It reuses the same single 1024 shadow map.
8. `d9f6e27` + final commit. **First-time quick-controls card:** a short controls list plus "stay tethered, follow the beacon". It auto-hides (16 s on first run, 6 s after that), [H] toggles it, and it is listed in the pause controls. It never blocks clicks. The final commit moves it above the bottom hint line and updates these reports.

Untouched: flight, tether, hacking, security, server and replication code. No changes to main.

## Performance (`tools/capture-areas.mjs`, 1280x720, dev-local, software render)
| | Before (Astra 401bcdd) | After (final) |
|---|---|---|
| Meshes | 377 | 425 |
| Active meshes | 243 | 297 |
| Draw calls | 494 | 432 |
| Materials | 67 | 94 |
| Triangles | 94k | 182k |
| Scene CPU frame time | 7.5 ms | 9.3 ms |
| Initial JS chunk | 6.25 MB | 186 kB (+5.9 MB lazy level chunk) |
| Load to playable (local) | 3.0 s | 2.8 s |

Draw calls were 326 before the prop kit and the shadows. They went back up to 432 because the Blender props are instanced but each instance still counts, and shadow casters add a shadow pass. That's still 13% below Astra, with twice the geometry detail and shadows everywhere. Real-GPU FPS on the 1070 is **unmeasured**.

## Tests (final code, software WebGL, `node tools/verify-all.mjs`)
| Check | Astra baseline | Final |
|---|---|---|
| `npm run build` | pass | **pass** |
| verify-multiplayer | pass | **pass** |
| verify-dev-local | fail (old waypoints) | **pass** |
| verify-gameplay | fail (old waypoints) | **pass** |
| verify-heist | fail (vent stall) | fail. Run 1: packet hack overlay didn't open at terminal A. Run 2: NEE missed a 0.45 m waypoint near the vent at **2 FPS** |
| verify-multiplayer-heist | fail (vent stall) | fail, but it got further: through hacks A and B and the trip to the servers, then the memory-trace hack didn't start (15 FPS) |

The heist verifiers steer with timed key presses, so at 2–15 FPS they fail at a different place on each run. This is not a proven regression, but **the full mission is still NOT verified end-to-end.** The shadow change costs a little extra CPU and GPU, which may slow the software render further. Stress tests were not run.

## Screenshots (`/workspace/handshake/report/screens/`, fresh before/after pairs from the same cameras)
- `before-reception.png` / `after-reception.png`: lobby, desk and under-desk route
- `before-vent.png` / `after-vent.png`: staff vent climb
- `before-office.png` / `after-office.png`: two-key office with Blender chairs, desks and beacons
- `before-server.png` / `after-server.png`: memory array gallery, racks and cooling
- `before-lab-vault.png` / `after-lab-vault.png`: hero lab and vault (the quality reference)
- `before-escape.png` / `after-escape.png`: west escape spine to pickup
- `before-gameplay-camera.png` / `after-gameplay-camera.png`: spawn view with the new quick-controls card

## Remaining problems
- Full heist not verified end-to-end. It needs a real GPU run.
- The controls card and the bottom hint line overlap in purpose. Pick one later.
- The level chunk is 5.9 MB. Havok wasm and the GLBs could be split or compressed further (Draco/meshopt).
- Draw calls (432) could go lower with thin instances and fewer shadow casters (only the big props).
- One 1024 shadow map, so shadows look soft at distance. No baked AO outside the lab.
- Nothing has been playtested by a human.

## Recommended next
1. On the 1070: `npm run build`, then `node tools/verify-all.mjs "http://localhost:5173/"` (full res) and a 10-minute co-op playtest. Note the FPS in each area.
2. If the heist steps still fail on the GPU, look first at the terminal-A interaction range (props near terminals).
3. Meshopt-compress the GLBs and convert props to thin instances.
4. Bake AO for the non-lab areas, then start the CPU companion in `BotControlSource.ts`.
