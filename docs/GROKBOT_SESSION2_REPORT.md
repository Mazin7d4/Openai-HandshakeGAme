# Grok Bot lead-dev session 2: final report (branch `grok-overnight`)
Oct 14, 2026, 11:18–17:10 PT. Main was never touched or merged. The session's commits run from 797d7bd to the head of the branch.

## Commits (author / tokens)
| Commit | Priority | What | Author |
|---|---|---|---|
| 797d7bd | P1/P2 | Tether moves (yank/slingshot/bump/rescue, server-relayed), clothesline, sparks, camera shake, faces, synth SFX | Grok Bot |
| 4facb85 | P2 | Slingshot rule + verify-tether-moves | Grok Bot |
| dca04b0 | P2 | verify-multiplayer-yank | Grok Bot |
| a468d76 | P2 | Heavy Lab Crate co-op haul | Grok Bot |
| 4b33861 | P4 | P01 prototype model, security pods, server-arbitrated patrol stuns, success screen | Grok Bot |
| f95e92d | P4 | Vault bell-jar reveal, spotlight, camera beat, alarm transformation, beacons, confetti | **agy** (opus-4-6-thinking, 77k + 72.5k tokens), reviewed; 1 fix by Grok Bot |
| a8472b4 | P4/P6 | Success-screen styling, heist test fixes, screenshots | Grok Bot |
| e862431, 19e6913, b5fe755 | P4/P6 | Crate blocks escape vent; confetti delay + pickup SFX; lobby copy-code/role line | Grok Bot (agy s4/s5 runs failed: ~900k tokens burned on network errors) |
| a9e6bbd, f0f1ec6 | test | `?autotest&stage=escape` shortcut, verify-crate, per-check timeouts | Grok Bot |
| 0218456 | fix | [E] near carrier stole partner's held object (client + server) | Grok Bot |
| 587e459 | P6 | Settings: volume, look sensitivity, screen-shake toggle | **agy** (gemini-3.8-flash-high, 329k tokens, network error mid-run), finished + fixed by Grok Bot |
| 7f1e257 | P6 | Loading card; partner-disconnected/reconnecting overlay | Grok Bot |
| 6cd1f45, 163c6d9 | P3/fix | Mounted signs replace floating cards; grab prompt fix | Grok Bot |
| 9f6a19b | P1/P4 | Authored Heavy Lab Crate (flight case, handles, latches, hazard label); drag margin 3.36 → 5.76–6.04 | Grok Bot |
| eaf0c68 | P3 | Escape-spine finish: oak wainscot, aluminium rail, warm wall washers, cable tray, planters | Grok Bot |
| d11a65f | P7 | Companion state machine (follow/haul/guard/rescue) + verify-companion | Grok Bot |
| 5b784c6 | P8 | Rigid-rig merging, skipPointerMovePicking, frozen dressing materials | Grok Bot + **agy** (material freeze, gemini-3.8-flash-high, 102.6k tokens, success in 146 s) |

agy tally: 3 commits contain code it wrote. That came to about 580k tokens across the runs that produced code; the failed runs used roughly 1.2M more. It works well on small single-file briefs and badly on big multi-step ones.

## Per priority
- **P1 game feel:** done. Yank, slingshot, sparks, camera shake, face reactions, synth SFX, confetti and pickup sounds.
- **P2 tether signature:** done. Yank/rescue, clothesline-stun of patrols (server-arbitrated), slingshot, two-drone heavy-crate haul. Missing: a cord-lever mechanism.
- **P3 visuals:** partly done. Mounted signage, escape-spine Robotics-Lab finish, authored crate and prototype. The upper walls in the spine and parts of the office and server areas still read flat.
- **P4 heist:** done. Prototype under a bell jar, vault reveal, pickup alarm transformation, crate jam on the escape vent, extraction celebration.
- **P5 modular rooms:** **not done.**
- **P6 UX:** partly done. Lobby copy-code and role line, settings, loading card, partner-disconnect overlay, success screen. No full reconnect flow and no retry polish pass.
- **P7 companion:** done for this scope. The CPU NEE follows, hauls the heavy crate beside you (crate moved 8.12 vs 5.76 in dev-local), hovers to guard while you hack, and auto-yanks you when you're in trouble. A test only covers guard and rescue indirectly. The companion does not hack or carry the prototype on its own.
- **P8 performance:** see below.

## Tests (final code, 5b784c6, `tools/verify-all.mjs`, per-check timeouts)
All 10 checks PASS: crate 37 s, companion 13 s, multiplayer 10 s, dev-local 100 s, gameplay 224 s, heist 122 s, multiplayer-heist 167 s, singleplayer 21 s, tether-moves 15 s, multiplayer-yank 9 s. Log: session2/verify-s8.log.

## Performance (headless SwiftShader, gameplay camera at spawn, tools/capture-areas.mjs)
| | Before step 2 | After P3 dressing | After P8 |
|---|---|---|---|
| Draw calls | 417 | 421 | **401** |
| Meshes | 519 | 531 | **502** |
| Active meshes | 317 | 319 | 309 |
| Triangles | 190.5k | 196.3k | 196.3k |
| Frame ms (CPU, noisy) | 11.9 | 11.1 | 14.1 |

Earlier in the session the draw calls were 494 → 318 (merge dressing) and 432 → 377 (shadow-caster culling), and the GLBs went 2.36 → 0.99 MB. Frame time on SwiftShader is not meaningful, so this needs a run on the GTX 1070.

## Screenshots (session2/screens/)
s8-labcrate-grab.png, s8-labcrate-drag.png, s8-labcrate-extraction.png, s8-companion-haul.png, areas-before/before-escape.png vs areas-after/after-escape.png (plus the other areas), p4-vault-reveal.png, p4-pickup-alarm.png, p4-alarm-escape.png, p4-extraction.png, s7-settings.png, s7-loading.png, s7-partner-overlay.png, s7-signage-exit.png, yank.png, slingshot.png, mp-yank-guest.png.

## Remaining weaknesses
- No real-GPU playtest. Every number and test comes from 2–20 FPS software rendering.
- Patrol movement is simulated on each client; only the stuns are server-arbitrated.
- In multiplayer the crate is client-simulated by the holder. There is no MP crate test.
- P5 is not started. The office, server and upper walls still look like a blockout in places.
- The companion is simple steering with no pathfinding, so it can snag on geometry. Guard and rescue have no direct test.
- The full heist takes about 10 minutes on the box, so iteration is slow.

## Recommendation (highest value next)
1. Playtest on Mazin's GTX 1070: real feel, FPS and tuning of the yank and crate values.
2. A P3 pass on the office and server gallery: same restrained treatment, with materials and lighting before props.
3. Sync patrol positions from the server and add an MP crate test.
4. P5 room conventions, only after the above.
