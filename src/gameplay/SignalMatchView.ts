import type { GameAudio } from '../audio/GameAudio.ts';
import type { HackMinigameView } from './HackMinigame.ts';

/** Two-axis waveform matching task. Range inputs support mouse, keyboard and touch. */
export class SignalMatchView implements HackMinigameView {
  private readonly overlay: HTMLDivElement;
  private readonly frequency: HTMLInputElement;
  private readonly amplitude: HTMLInputElement;
  private readonly playerWave: SVGPathElement;
  private readonly meter: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly targetFrequency: number;
  private readonly targetAmplitude: number;
  private completionTimer: number | null = null;
  private disposed = false;
  private completed = false;
  private readonly cancel: () => void;
  private readonly audio?: GameAudio;

  constructor(
    parent: HTMLElement,
    stationLabel: string,
    complete: () => void,
    cancel: () => void,
    audio?: GameAudio,
  ) {
    this.cancel = cancel;
    this.audio = audio;
    const seed = Math.floor(performance.now()) % 41;
    this.targetFrequency = 32 + seed;
    this.targetAmplitude = 38 + ((seed * 7) % 45);
    this.overlay = document.createElement('div');
    this.overlay.className = 'hack-overlay';
    this.overlay.dataset.testid = 'signal-match';
    this.overlay.dataset.targetFrequency = String(this.targetFrequency);
    this.overlay.dataset.targetAmplitude = String(this.targetAmplitude);
    const panel = document.createElement('section');
    panel.className = 'hack-panel';
    panel.innerHTML = `<p class="menu-kicker"></p><h2>SIGNAL MATCH</h2><p class="hack-help">Tune both controls until your trace locks onto the target waveform.</p>`;
    panel.querySelector('.menu-kicker')!.textContent = stationLabel;
    const scope = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    scope.classList.add('signal-scope');
    scope.setAttribute('viewBox', '0 0 420 150');
    const targetWave = document.createElementNS(scope.namespaceURI, 'path');
    targetWave.classList.add('signal-wave', 'target');
    this.playerWave = document.createElementNS(scope.namespaceURI, 'path') as SVGPathElement;
    this.playerWave.classList.add('signal-wave', 'player');
    targetWave.setAttribute('d', this.wavePath(this.targetFrequency, this.targetAmplitude));
    scope.append(targetWave, this.playerWave);
    this.frequency = this.slider('FREQUENCY', 0);
    this.amplitude = this.slider('AMPLITUDE', 100);
    const controls = document.createElement('div');
    controls.className = 'signal-controls';
    controls.append(this.controlRow('FREQUENCY', this.frequency), this.controlRow('AMPLITUDE', this.amplitude));
    const track = document.createElement('div');
    track.className = 'match-meter';
    this.meter = document.createElement('div');
    track.append(this.meter);
    this.status = document.createElement('p');
    this.status.className = 'hack-status';
    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.className = 'hack-cancel';
    this.cancelButton.textContent = 'CANCEL';
    this.cancelButton.addEventListener('click', this.cancel);
    const update = () => this.update(complete);
    this.frequency.addEventListener('input', update);
    this.amplitude.addEventListener('input', update);
    panel.append(scope, controls, track, this.status, this.cancelButton);
    this.overlay.append(panel);
    parent.append(this.overlay);
    this.update(complete);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.completionTimer !== null) window.clearTimeout(this.completionTimer);
    this.cancelButton.removeEventListener('click', this.cancel);
    this.overlay.remove();
  }

  private slider(label: string, value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(value);
    input.dataset.control = label.toLowerCase();
    input.setAttribute('aria-label', label);
    return input;
  }

  private controlRow(label: string, input: HTMLInputElement): HTMLLabelElement {
    const row = document.createElement('label');
    row.append(document.createTextNode(label), input);
    return row;
  }

  private update(complete: () => void): void {
    if (this.completed || this.disposed) return;
    const frequency = Number(this.frequency.value);
    const amplitude = Number(this.amplitude.value);
    const error = Math.hypot(frequency - this.targetFrequency, amplitude - this.targetAmplitude);
    const closeness = Math.max(0, 1 - error / 90);
    this.playerWave.setAttribute('d', this.wavePath(frequency, amplitude));
    this.meter.style.width = `${Math.round(closeness * 100)}%`;
    this.status.textContent = closeness > 0.9 ? 'LOCK ALMOST STABLE' : closeness > 0.65 ? 'SIGNAL CONVERGING' : 'SEARCHING…';
    this.audio?.click(closeness);
    if (Math.abs(frequency - this.targetFrequency) <= 4 && Math.abs(amplitude - this.targetAmplitude) <= 4) {
      this.completed = true;
      this.overlay.classList.add('success');
      this.status.textContent = 'SIGNAL LOCKED';
      this.meter.style.width = '100%';
      this.audio?.success();
      this.completionTimer = window.setTimeout(complete, 650);
    }
  }

  private wavePath(frequency: number, amplitude: number): string {
    const cycles = 1.2 + frequency / 22;
    const height = 10 + amplitude * 0.48;
    const points: string[] = [];
    for (let x = 0; x <= 420; x += 5) {
      const y = 75 + Math.sin((x / 420) * Math.PI * 2 * cycles) * height;
      points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(' ');
  }
}
