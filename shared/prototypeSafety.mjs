/** Return a reachable cradle pose when free mission loot escapes the playable cutaway or a closing gate. */
export function prototypeRecovery(position, cradle, alarm = false) {
  const finite = Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  const outside = !finite || Math.abs(position.x) > 18.2 || position.z < -66 || position.z > 46.2 || position.y < -0.5 || position.y > 8.5;
  const sealedBehindTeam = alarm && position.z < 3.5;
  if (!outside && !sealedBehindTeam) return null;
  return { x: cradle.x, y: Math.min(7.5, Math.max(1.5, cradle.y)), z: Math.max(alarm ? 5 : -65, cradle.z) };
}
