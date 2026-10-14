# Prototype Theft — first mission

**Target:** a first-time pair should take roughly 8–12 minutes, including exploration and three existing hack puzzles. This is a design target; timing requires a human pair. The automated route exercises traversal and state changes at accelerated input speed.

| Beat | Space and play | Approximate first-play budget |
| --- | --- | --- |
| Arrival | Delivery apron, reception identity, under-desk path and the high service vent. Learn the building is human scale. | 1–1.5 min |
| Small cooperative challenge | The office splits PIX to a desktop console and NEE to a lower patch bay. The tether keeps their two heights a shared navigation problem. Both keys lift the office shutter. | 1.5–2 min |
| Deeper infiltration | Server gallery bends around opposing rack banks. A lower aisle and high route meet at the memory shelf; throwable clutter is available. | 1.5–2 min |
| Security and robotics lab | Third existing hack opens the central lab door. Camera begins a gentle reveal into the finished robotics area with human workbenches and the vault display. | 1.5–2 min |
| Theft | Fly up to the worktop-height prototype. The existing grab action trips the alarm. | 0.5–1 min |
| Alarm and escape | Main door closes, west relief shutter lifts, the service spine gains pulsing green wayfinding, patrols activate, and the camera opens up. Escape has two altitude changes and joins the extraction pad at the delivery side. | 1.5–2.5 min |

The office and central shutters use the already synchronized hack completion state. The relief shutter uses the existing synchronized alarm state. The server remains authoritative for all three terminals, the prototype, and extraction; positions come from `src/level/heist-layout.json` on both client and server. No new mission state or network protocol is needed.

**Camera:** anchored oblique heading preserves WASD mapping. Right mouse drag or two-finger touch adjusts yaw by at most 9° and pitch by at most 5°; the shot gently recenters. Wheel or pinch zoom stays within 85–116% of the authored dolly. The vault, service vent, and extraction have location-driven pitch and distance; F2 still opens the inspection camera.

**Hero visual standard:** five world units = one metre, with PIX/NEE approximately 1.4 units wide. White oak, ivory paint, sage panels, coral molded polymer, graphite rubber, pale fabric, soft plants, clear glass, and brushed aluminum. One 1.1 MB glTF kit supplies the lab robot, finished workbenches, pedestal, chair, plants, tools and cables; shared PBR materials and one small procedural display atlas finish it in Babylon. Use the same daylight/reflection/tone mapping language in other rooms. Collision remains simple and authored separately from art. Keep the camera side of architecture open or marked for occlusion fading; avoid enclosed roofs in the gameplay view.

## GROKBOT OVERNIGHT QUEUE

1. **Remaining environment modules:** Produce a small reusable reception and office kit, a pair of server racks, a vent segment, and a service spine wall/ceiling set at the above scale. Work inside `src/level/PrototypeHeist.ts` and new `public/assets/lab/` assets. Preserve openings, shutter coordinates, and all `heist-layout.json` positions. Export merged glTF meshes by material and simple separate collision proxies.
2. **Props and clutter:** Add a restrained set of human-scale reception stationery, two desk accessories, server cable trays and a few soft objects. Reuse `createLabPalette` colors. Make only strategically placed grabbable-looking props where the existing grab system already has a matching object; static decoration should never imply an unavailable interaction.
3. **Apply the visual language:** Replace the office and server area's primitive surfaces with the same oak/ivory/sage/aluminum palette, bevel radii, glass mullions and warm diffusers. Keep the lab/vault as the quality reference; avoid extra realtime lights or large uncompressed textures.
4. **UI and quality of life:** Tighten objective copy and route signage after a human pair times the mission. Improve the camera gesture hint for first-time players if necessary. Keep the existing minigames, HUD foundation, and F2 inspection.
5. **Repetitive art work:** Give every copied surface consistent UV scale, subtle roughness variation and atlas-friendly instrument marks. Re-export the Blender kit only after checking fit against the separately authored collision. Optimize the current hero GLB if size grows beyond 1.5 MB.
6. **Performance cleanup:** Profile first on a mid-range mobile browser. Reduce the current decorative draw calls from rack indicators and signs by merging meshes/atlasing materials where it measurably helps; do not flatten collision or remove important wayfinding. Record FPS and loading time before and after.

**Protected systems:** flight, tether physics, player and object replication, grab/throw, hacking UI and network state, security logic, extraction rules, existing tests. Art and level workers should not alter `server/index.mjs` except when a reviewed mission layout change requires a matching shared coordinate.
