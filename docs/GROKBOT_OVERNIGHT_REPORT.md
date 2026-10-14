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

9. `d2f3e70` Test-only `?autotest` autopilot (`src/dev/Autopilot.ts`): steers by position through the normal control seam (no teleporting, real collisions), so verifiers behave the same at 2 FPS and 144 FPS. Only active with `?autotest`. verify-heist passes end-to-end.
10. `2d8a94f` **Meshopt-compressed GLBs** (drone 370→137 kB, robotics-hero 1067→431 kB, office-kit 927→427 kB; 2.36 → 0.99 MB total). Decoder is vendored at `public/vendor/meshopt_decoder.js` and served from our own origin, not a CDN (checked: all three GLBs + decoder load 200 from localhost, no console errors). Re-run `tools/compress-glbs.sh` after any Blender re-export.
11. `cf39356` + `c8d4148` **Shadow pass culling.** Only large props are shadow candidates, and static casters outside the camera-following 48 m shadow box are dropped from the shadow pass (refreshed only when the snapped centre moves). Spawn draw calls 432 → 377. Also fixed a dev-server-only duplicate Babylon import.
12. `d6dd5a9` **Controls redundancy removed.** The bottom line now only shows dev extras (Tab, right-drag, wheel, F2, [H], Esc); player controls live only in the quick-controls card and pause menu.
13. `e06e82e` + `626528c` Autopilot `hold` mode (keeps station against tether drag at co-op terminals). **verify-multiplayer-heist and verify-gameplay now pass.**
14. `ec20d99` **First-pass CPU companion.** Single Player → START now launches the game: you fly PIX, and the CPU NEE (`BotControlSource` with sensors) follows with slack so the tether stays loose, matches altitude, boosts to catch up, and holds still while hacking. It does not hack, grab or plan yet. Dev-local's inactive drone stays idle as before. New `tools/verify-singleplayer.mjs` (in verify-all).

Untouched: flight, tether, hacking, security, server and replication code. No changes to main.

## Performance (`tools/capture-areas.mjs`, 1280x720, dev-local spawn, software render)
| | Before (Astra 401bcdd) | After (final, c8d4148) |
|---|---|---|
| Meshes | 377 | 425 |
| Active meshes | 243 | 297 |
| Draw calls | 494 | **377** (-24%) |
| Materials | 67 | 94 |
| Triangles | 94k | 182k |
| Scene CPU frame time (SwiftShader) | 7.5 ms | 12.9–15.7 ms* |
| Initial JS chunk | 6.25 MB | 186 kB (+170 kB GameApp, +5.9 MB lazy PrototypeHeist chunk) |
| GLB assets | 2.36 MB (Grok props, uncompressed) | 0.99 MB (meshopt) |
| Load to playable (local) | 3.0 s | 2.6 s |

*Frame time under software rendering also includes the full-map shadow pass that Astra's build did not have and is noisy between runs (9.3–15.7 ms tonight; 15.7 ms in the final capture with a dev server and verifier running alongside); it is not a GPU number. Real FPS on the 1070 is **unmeasured**.

## Tests (game code c8d4148, test fixes 644ce94 + 7463564, software WebGL, `node tools/verify-all.mjs`)
Run 04:34–05:08 AM PT on final code (`dist/` preview + local server).

| Check | Astra 401bcdd | Final c8d4148 |
|---|---|---|
| `npm run build` | pass | **pass** (chunk-size warning only) |
| verify-multiplayer | pass | **pass** (13 s) |
| verify-dev-local | fail (old waypoints) | **pass** (156 s) |
| verify-gameplay | fail (old waypoints) | **pass** on verify-all retry (804 s); first attempt failed: player-2 couldn't catch cargo-core (6.5 m away) |
| verify-heist | fail (vent stall) | **pass after test fix (`644ce94`)**: 5/6 runs after the fix; the one failure was earlier in the route (memory-trace hack overlay didn't open within 30 s at ~9 FPS), not the grab. Before the fix: 3/4 passed here, and the failures stopped with NEE 3.3 m from the prototype, just outside the 3.2 m grab radius |
| verify-multiplayer-heist | fail (vent stall) | **pass** after test fix `7463564` (2/2 runs, ~135 s). Before the fix it failed 3/3 at ~05:25 PT |
| verify-singleplayer (new) | n/a | **pass** (22–24 s; tether gap 1.18, NEE moved 13.2 m following PIX); re-run 2/2 pass at 7463564 |


## Screenshots (`/workspace/handshake/report/screens/`, fresh before/after pairs from the same cameras)
- `before-reception.png` / `after-reception.png`: lobby, desk and under-desk route
- `before-vent.png` / `after-vent.png`: staff vent climb
- `before-office.png` / `after-office.png`: two-key office with Blender chairs, desks and beacons
- `before-server.png` / `after-server.png`: memory array gallery, racks and cooling
- `before-lab-vault.png` / `after-lab-vault.png`: hero lab and vault (the quality reference)
- `before-escape.png` / `after-escape.png`: west escape spine to pickup
- `before-gameplay-camera.png` / `after-gameplay-camera.png`: spawn view with the new quick-controls card

## Remaining problems
- **Fixed (test bugs, not game code):** (1) The verify-heist grab failure was positional. Both drones flew to the same last vault waypoint, so PIX's body shoved NEE about 0.6 m back to roughly 3.3 m from the prototype, outside the 3.2 m grab radius (the earlier "1.7 m" figure was wrong). The grab code, cradle lock, c8d4148 and ec20d99 are not involved, and the grab radius stays matched with the server. The test now holds NEE at 1.6 m before pressing grab. (2) verify-multiplayer-heist's autopilot wait also accepted `[data-testid=mission-complete]`. That overlay is always in the DOM (just hidden), so every wait returned instantly and the run broke in a different place each time. It now requires `.visible`.
- **Still flaky at software-WebGL FPS (3–18):** occasionally a hack overlay doesn't open within the timeout (1 of the last 6 verify-heist runs). These are timing flakes in the tests, not gameplay bugs. Check them on the 1070.
- Nothing has been playtested by a human or on a real GPU; all FPS evidence is software rendering.
- CPU companion is follow-only: no hacking, grabbing, rescuing, or path-finding (it can get snagged on walls/doorframes and relies on the tether to drag it through).
- verify-* now steer with the test-only autopilot; the old keyboard path is a fallback, so real key-feel at low FPS isn't what's being tested.
- Level chunk still 5.9 MB (Havok wasm + Babylon); draw calls 377 could drop further with thin instances.
- One 1024 shadow map: soft shadows at distance; no baked AO outside the lab.
- With `?debug=1` the dev readout text overlaps the quick-controls card (dev-only view; players don't see it).
- Stress tests (`stress-multiplayer`, `stress-stability`) were not run.

## Recommended next
0. Run `node tools/verify-all.mjs` on the 1070 at full FPS to confirm the heist tests are stable with real GPU timing.
1. On the 1070: `npm run build`, serve it (`npx vite preview --port 5173` + `node server/index.mjs`), then `node tools/verify-all.mjs "http://localhost:5173/"` at full res, plus a 10-minute co-op playtest and a single-player try. Note FPS per area.
2. Companion v2: waypoint graph from `heist-layout.json`, go-to-terminal + hack-B on request, auto-rescue when PIX is spotted.
3. Thin instances for the prop kit; bake AO for non-lab areas.
4. Pick the review merges: `grok-overnight` → PR into `astra-production-pass` (not main) once you've playtested.
