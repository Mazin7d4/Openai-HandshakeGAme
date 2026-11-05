/** Plain horizontal/3D pass validation shared by client-side interaction code and tests. */
export const PASS_RANGE = 1.6;
export const PASS_CONE_DEG = 50;
export const PASS_CLOSE_RANGE = 0.6;

/**
 * Drone visuals turn their face back toward the gameplay camera, so the yaw in
 * snapshots / visual.root.rotation.y points at the camera. The player's facing
 * (camera forward, with the small travel bias) is the opposite direction.
 */
export function facingYaw(visualYaw: number): number {
  return visualYaw + Math.PI;
}

export type PassReason = 'ok' | 'far' | 'behind';

export interface PassRulesInput {
  holder: { x: number; y: number; z: number };
  holderYaw: number;
  partner: { x: number; y: number; z: number };
  range?: number;
  coneDeg?: number;
}

/**
 * Decide whether a holder can pass to a partner.
 *
 * Range is 3D, while the facing cone is measured on the horizontal x/z plane
 * using the drone convention forward = (sin(yaw), 0, cos(yaw)). Very close
 * drones overlap, so the cone is intentionally ignored within PASS_CLOSE_RANGE.
 */
export function canPass({
  holder,
  holderYaw,
  partner,
  range = PASS_RANGE,
  coneDeg = PASS_CONE_DEG,
}: PassRulesInput): { ok: boolean; reason: PassReason } {
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
