import {
  createObjectiveState,
  lootLocked,
  serializeObjectiveState,
  stepObjective,
} from '../shared/nightshift/objectives.mjs';

export class ObjectiveSim {
  constructor() { this.reset(null); this.pendingYanks = []; }

  reset(plan) {
    this.plan = plan ?? null;
    this._state = createObjectiveState(this.plan ?? { kind: 'grab' });
    this.pendingYanks = [];
  }

  noteYank(role) {
    if (role === 'pix' || role === 'nee') this.pendingYanks.push(role);
  }

  step(dt, players, carrierRole = '') {
    const inputPlayers = (Array.isArray(players) ? players : []).filter((p) => p?.connected !== false).map((p) => ({
      role: p.role, x: p.position?.x, y: p.position?.y, z: p.position?.z, tetherPull: p.tetherPull,
    }));
    const events = stepObjective(this._state, this.plan ?? { kind: 'grab' }, {
      dt, players: inputPlayers, carrier: carrierRole === 'pix' || carrierRole === 'nee' ? carrierRole : null,
      yanks: this.pendingYanks,
    });
    this.pendingYanks = [];
    return events;
  }

  get locked() { return lootLocked(this._state, this.plan); }
  get state() { return this._state; }
  snapshot() { return serializeObjectiveState(this._state); }
}

export function shouldBroadcast(prevSeq, sim, elapsedSinceLastBroadcastSec) {
  const moving = Math.abs(sim.state.timer) > 1e-6 || (sim.state.progress > 1e-6 && sim.state.progress < 1 - 1e-6);
  return sim.state.seq !== prevSeq || (Number.isFinite(elapsedSinceLastBroadcastSec) && elapsedSinceLastBroadcastSec >= 0.5 && !sim.state.done && moving);
}
