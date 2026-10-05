import type { InputState } from '../types';

export class InputSystem {
  private state: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    run: false,
  };

  private keyMap: Record<string, keyof InputState> = {
    'KeyW': 'forward',
    'ArrowUp': 'forward',
    'KeyS': 'backward',
    'ArrowDown': 'backward',
    'KeyA': 'left',
    'ArrowLeft': 'left',
    'KeyD': 'right',
    'ArrowRight': 'right',
    'Space': 'jump',
    'ShiftLeft': 'run',
    'ShiftRight': 'run',
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
    window.addEventListener('blur', this.reset.bind(this));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const action = this.keyMap[event.code];
    if (action) {
      this.state[action] = true;
      event.preventDefault();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    const action = this.keyMap[event.code];
    if (action) {
      this.state[action] = false;
      event.preventDefault();
    }
  }

  private reset(): void {
    this.state = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      run: false,
    };
  }

  public getState(): Readonly<InputState> {
    return this.state;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
    window.removeEventListener('keyup', this.onKeyUp.bind(this));
    window.removeEventListener('blur', this.reset.bind(this));
  }
}