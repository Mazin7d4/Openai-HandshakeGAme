export interface InteractionActions {
  grabDrop: boolean;
  throwObject: boolean;
  interact: boolean;
  pause: boolean;
  switchDrone: boolean;
  /** Tether yank / slingshot (edge-triggered). */
  yank: boolean;
}

export function zeroInteractionActions(): InteractionActions {
  return {
    grabDrop: false,
    throwObject: false,
    interact: false,
    pause: false,
    switchDrone: false,
    yank: false,
  };
}
