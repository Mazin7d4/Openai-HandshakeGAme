/**
 * Apply a RunLayout to mutable gameplay sinks.
 * Server room and solo simulation both call this; Colyseus / Babylon stay outside.
 *
 * Expected `targets` (all optional — missing sinks are skipped):
 * {
 *   spawn?: { x,y,z },
 *   extraction?: { x,y,z },
 *   loot?: { x,y,z } | { position: {x,y,z} },
 *   terminals?: { 'terminal-a'|'terminal-b'|'terminal-c': {x,y,z} },
 *   objects?: Map|Record keyed by id with .position.{x,y,z} (moves `prototype`),
 *   security?: {
 *     applyLayout?(layout),           // preferred hook (SecuritySim)
 *     setPatrolHomes?(homes),
 *     setPatrolRoutes?(routes),
 *     setCameras?(cameras),
 *     setTuning?(tuning),
 *   },
 *   tether?: { restLength?, maxLength? },
 *   twist?: { ...mutable gameplay knobs },
 *   onApplied?(layout),
 * }
 */

/**
 * @param {{ x: number, y: number, z: number }} target
 * @param {{ x: number, y: number, z: number }} source
 */
function copyVec(target, source) {
  if (!target || !source) return;
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

/**
 * @param {import('./generateRun.mjs').RunLayout} layout
 * @param {Record<string, any>} [targets]
 * @returns {import('./generateRun.mjs').RunLayout}
 */
export function applyRunLayout(layout, targets = {}) {
  if (!layout) throw new Error('applyRunLayout: layout required');

  if (targets.spawn) copyVec(targets.spawn, layout.spawn);
  if (targets.extraction) copyVec(targets.extraction, layout.extraction);

  if (targets.loot) {
    if (targets.loot.position) copyVec(targets.loot.position, layout.loot);
    else copyVec(targets.loot, layout.loot);
  }

  if (targets.terminals) {
    for (const id of /** @type {const} */ (['terminal-a', 'terminal-b', 'terminal-c'])) {
      const sink = targets.terminals[id];
      const src = layout.terminals[id];
      if (sink && src) {
        if (sink.position) copyVec(sink.position, src);
        else copyVec(sink, src);
      }
    }
  }

  if (targets.objects) {
    const proto =
      typeof targets.objects.get === 'function'
        ? targets.objects.get('prototype')
        : targets.objects.prototype;
    if (proto?.position) copyVec(proto.position, layout.loot);
    else if (proto) copyVec(proto, layout.loot);
  }

  if (targets.tether) {
    targets.tether.restLength = layout.cord.restLength;
    targets.tether.maxLength = layout.cord.maxLength;
  }

  if (targets.twist) {
    const t = layout.twist;
    Object.assign(targets.twist, {
      id: t.id,
      label: t.label,
      lightScale: t.lightScale,
      gripScale: t.gripScale,
      neeNervousness: t.neeNervousness,
      hasteScale: layout.escalation.hasteScale,
      timerSeconds: layout.escalation.timerSeconds,
      cordMaxScale: t.cordMaxScale,
      cordRestScale: t.cordRestScale,
    });
  }

  const security = targets.security;
  if (security) {
    if (typeof security.applyLayout === 'function') {
      security.applyLayout(layout);
    } else {
      const homes = layout.patrolRoutes.map((route, i) => {
        const wp = route.waypoints[0];
        return { x: wp.x, y: wp.y, z: wp.z, index: i };
      });
      security.setPatrolHomes?.(homes);
      security.setPatrolRoutes?.(layout.patrolRoutes);
      security.setCameras?.(layout.cameras);
      security.setTuning?.({
        patrolSpeed: layout.escalation.patrolSpeed,
        cameraSweepScale: layout.escalation.cameraSweepScale,
        detectionRateScale: layout.escalation.detectionRateScale,
        guardCount: layout.escalation.guardCount,
      });
    }
  }

  targets.onApplied?.(layout);
  return layout;
}
