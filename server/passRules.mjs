// Server-side twin of src/gameplay/passRules.ts. The wider range and cone
// absorb snapshot latency; the client remains the tighter interaction gate.
export const PASS_RANGE = 2.0;
export const PASS_CONE_DEG = 65;
export const PASS_CLOSE_RANGE = 0.6;

/**
 * Drone visuals turn their face back toward the gameplay camera, so the yaw in
 * snapshots / visual.root.rotation.y points at the camera. The player's facing
 * (camera forward, with the small travel bias) is the opposite direction.
 */
export function facingYaw(visualYaw) {
  return visualYaw + Math.PI;
}

export function canPass({ holder, holderYaw, partner, range = PASS_RANGE, coneDeg = PASS_CONE_DEG }) {
  const dx = partner.x - holder.x;
  const dy = partner.y - holder.y;
  const dz = partner.z - holder.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > range) return { ok: false, reason: 'far' };
  if (distance <= PASS_CLOSE_RANGE) return { ok: true, reason: 'ok' };

  const horizontalDistance = Math.hypot(dx, dz);
  if (horizontalDistance <= Number.EPSILON) return { ok: false, reason: 'behind' };
  const forwardX = Math.sin(holderYaw);
  const forwardZ = Math.cos(holderYaw);
  const directionX = dx / horizontalDistance;
  const directionZ = dz / horizontalDistance;
  const dot = forwardX * directionX + forwardZ * directionZ;
  const cross = forwardX * directionZ - forwardZ * directionX;
  const angleDeg = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
  return angleDeg <= coneDeg
    ? { ok: true, reason: 'ok' }
    : { ok: false, reason: 'behind' };
}
