export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  run: boolean;
}

export interface LocomotionIntent {
  /** Velocity relative to the character, in meters/second. +Z is her forward, +X is her right. */
  localVelocity: { x: number; z: number };
  /** 0 = walk gait, 1 = run gait. */
  run: number;
  /** Radians/second. Positive turns toward world +X (increasing yaw). */
  yawRate: number;
  grounded: boolean;
  jump: boolean;
  horizontalSpeed: number;
}

export const CHARACTER_ASSET_PATH = '/assets/character/player.glb';

export const LOCOMOTION_CLIPS = [
  'idle',
  'walk',
  'run',
  'strafeLeftWalk',
  'strafeRightWalk',
  'strafeLeft',
  'strafeRight',
  'turnLeft',
  'turnRight',
  'jump',
] as const;

export type LocomotionClipName = (typeof LOCOMOTION_CLIPS)[number];

/** Root-motion speed removed during the Blender conversion, in meters/second. */
export const CLIP_AUTHORED_SPEED: Record<LocomotionClipName, number> = {
  idle: 0,
  walk: 1.68,
  run: 3.77,
  strafeLeftWalk: 1.95,
  strafeRightWalk: 1.95,
  strafeLeft: 3.62,
  strafeRight: 3.62,
  turnLeft: 0,
  turnRight: 0,
  jump: 0,
};
