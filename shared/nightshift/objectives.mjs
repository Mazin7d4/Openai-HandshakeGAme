const EPS = 1e-6;
const privateState = new WeakMap();

export const OBJECTIVE_TUNING = Object.freeze({
  leverRadius: 3,
  leverHoldSeconds: 1,
  pylonHookRadius: 2.5,
  // The bot intentionally settles just inside its 1.2 m hold radius. A
  // qualifying wrap therefore needs to begin below the visual redline so the
  // safe remains inside its hook radius while the first pull lands.
  pylonPullStrain: 0.35,
  pylonPullSeconds: 0.6,
  pylonCooldown: 0.8,
  pylonWrapRadius: 2,
  fragileCooldown: 1,
  relayPadRadius: 2.5,
  relayStepSeconds: 6,
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value)));
const point = (v) => ({ x: finite(v?.x), y: finite(v?.y), z: finite(v?.z) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const planarDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function playersOf(input) {
  return (Array.isArray(input?.players) ? input.players : []).filter((p) => p && (p.role === 'pix' || p.role === 'nee'))
    .map((p) => ({ role: p.role, x: finite(p.x), y: finite(p.y), z: finite(p.z), tetherPull: clamp(p.tetherPull, 0, 1) }));
}

function event(state, events, type, role) {
  const item = role ? { type, role } : { type };
  events.push(item);
  state.seq += 1;
  state.lastEvent = type;
}

function finish(state, events) {
  if (!state.done) {
    state.done = true;
    state.progress = 1;
    event(state, events, 'done');
  }
}

export function createObjectiveState(plan) {
  const kind = plan?.kind ?? 'grab';
  const state = {
    // Ordinary variety fragile objectives are a live integrity readout. Authored
    // campaign fragile phases finish when the carrier reaches extraction.
    kind, done: kind === 'grab' || (kind === 'fragile' && !plan?.fragileLoot), progress: 1,
    step: 0, timer: 0, pulls: 0, cracks: 0, shatters: 0, seq: 0, lastEvent: null,
  };
  if (kind !== 'grab' && kind !== 'fragile') state.progress = 0;
  privateState.set(state, { leverHeld: [false, false] });
  return state;
}

function twinLevers(state, plan, input, players, events, dt) {
  const levers = Array.isArray(plan?.levers) ? plan.levers : [];
  const radius = finite(plan?.leverRadius, OBJECTIVE_TUNING.leverRadius);
  const previous = privateState.get(state) ?? {};
  const old = previous.leverHeld ?? [false, false];
  const oldOwners = previous.leverOwners ?? [null, null];
  const next = [false, false];
  const owners = [null, null];
  const candidates = levers.slice(0, 2).map((lever) => players.filter((p) => lever && distance(p, point(lever)) <= radius));
  const pair = candidates[0]?.find((a) => candidates[1]?.some((b) => b.role !== a.role));
  if (pair) {
    const partner = candidates[1].find((p) => p.role !== pair.role);
    next[0] = true; owners[0] = pair.role;
    next[1] = true; owners[1] = partner.role;
  } else {
    for (let i = 0; i < 2; i++) {
      const candidate = candidates[i]?.[0];
      if (candidate) { next[i] = true; owners[i] = candidate.role; }
    }
    if (owners[0] && owners[0] === owners[1]) { next[1] = false; owners[1] = null; }
  }
  const heldCount = next.filter(Boolean).length;
  if (heldCount !== old.filter(Boolean).length) {
    const changed = next.findIndex((v, i) => v !== old[i]);
    event(state, events, next[changed] ? 'lever-on' : 'lever-off', owners[changed] ?? oldOwners[changed] ?? undefined);
  }
  privateState.set(state, { ...previous, leverHeld: next, leverOwners: owners });
  const bothDifferent = next[0] && next[1] && owners[0] !== owners[1];
  const hold = Math.max(EPS, finite(plan?.holdSeconds, OBJECTIVE_TUNING.leverHoldSeconds));
  if (bothDifferent) state.timer += dt;
  else state.timer = Math.max(0, state.timer - 2 * dt);
  state.progress = bothDifferent ? 0.5 + 0.5 * Math.min(1, state.timer / hold) : 0.25 * heldCount;
  if (state.timer >= hold) finish(state, events);
}

function pylonSafe(state, plan, input, players, events, dt) {
  const pylon = point(plan?.pylon), safe = point(plan?.safe), anchor = point(plan?.anchor);
  const hookRadius = finite(plan?.hookRadius, OBJECTIVE_TUNING.pylonHookRadius);
  const hooked = players.find((p) => distance(p, safe) <= hookRadius);
  const other = hooked && players.find((p) => p.role !== hooked.role);
  let wrapped = false;
  if (hooked && other && planarDistance(other, pylon) >= OBJECTIVE_TUNING.pylonWrapRadius) {
    const ax = safe.x - pylon.x, az = safe.z - pylon.z;
    const bx = other.x - pylon.x, bz = other.z - pylon.z;
    const denom = Math.hypot(ax, az) * Math.hypot(bx, bz);
    wrapped = denom > EPS && (ax * bx + az * bz) / denom <= -0.5;
  }
  const tuning = privateState.get(state) ?? {};
  const yank = hooked && other && wrapped && Array.isArray(input?.yanks)
    && (input.yanks.includes(hooked.role) || input.yanks.includes(other.role));
  if (state.timer < 0) {
    state.timer = Math.min(0, state.timer + dt);
  } else if (!hooked || !other || !wrapped || Math.max(hooked.tetherPull, other.tetherPull) < OBJECTIVE_TUNING.pylonPullStrain) {
    state.timer = Math.max(0, state.timer - 2 * dt);
  } else {
    state.timer += dt;
    if (yank) state.timer = Math.max(state.timer, OBJECTIVE_TUNING.pylonPullSeconds);
  }
  const required = Math.max(1, Math.floor(finite(plan?.pullsRequired, 1)));
  if (state.timer >= 0 && (yank || state.timer >= OBJECTIVE_TUNING.pylonPullSeconds)
    && hooked && other && wrapped
    && (yank || Math.max(hooked.tetherPull, other.tetherPull) >= OBJECTIVE_TUNING.pylonPullStrain)) {
    state.pulls += 1; event(state, events, 'pull', hooked.role);
    state.timer = -OBJECTIVE_TUNING.pylonCooldown;
  }
  state.progress = Math.min(1, state.pulls / required);
  if (state.pulls >= required) finish(state, events);
  privateState.set(state, { ...tuning });
}

function fragile(state, plan, input, events, dt) {
  state.timer = Math.max(0, state.timer - dt);
  if (input?.carrier && Array.isArray(input.yanks) && input.yanks.length && state.timer <= 0) {
    state.cracks += 1; state.timer = OBJECTIVE_TUNING.fragileCooldown; event(state, events, 'crack', input.carrier);
    const required = Math.max(1, Math.floor(finite(plan?.cracksToShatter, 3)));
    if (state.cracks >= required) {
      state.shatters += 1; state.cracks = 0; event(state, events, 'shatter', input.carrier);
    }
  }
  const required = Math.max(1, Math.floor(finite(plan?.cracksToShatter, 3)));
  state.progress = 1 - state.cracks / required;
}

function relay(state, plan, players, events, dt) {
  const pads = Array.isArray(plan?.pads) ? plan.pads : [];
  const radius = finite(plan?.padRadius, OBJECTIVE_TUNING.relayPadRadius);
  const stepSeconds = Math.max(EPS, finite(plan?.stepSeconds, OBJECTIVE_TUNING.relayStepSeconds));
  if (state.done || !pads.length) return;
  const target = pads[state.step];
  const toucher = players.find((p) => p.role === target?.role && distance(p, point(target)) <= radius);
  if (toucher) {
    state.step += 1; state.timer = 0; event(state, events, 'step', toucher.role);
    if (state.step >= pads.length) finish(state, events);
  } else if (state.step > 0) {
    state.timer += dt;
    if (state.timer > stepSeconds) { state.step = 0; state.timer = 0; event(state, events, 'reset'); }
  }
  state.progress = pads.length ? state.step / pads.length : 0;
}

export function stepObjective(state, plan, input = {}) {
  if (!state || !plan) return [];
  const events = [];
  const dt = clamp(input.dt, 0, 0.25);
  const players = playersOf(input);
  if (state.done && state.kind !== 'fragile') return events;
  switch (state.kind) {
    case 'twin-levers': twinLevers(state, plan, input, players, events, dt); break;
    case 'pylon-safe': pylonSafe(state, plan, input, players, events, dt); break;
    case 'fragile': fragile(state, plan, input, events, dt); break;
    case 'relay': relay(state, plan, players, events, dt); break;
    default: state.done = true; state.progress = 1;
  }
  state.progress = clamp(state.progress, 0, 1);
  return events;
}

export function lootLocked(state, plan) {
  return !!state && !!plan && ['twin-levers', 'pylon-safe', 'relay'].includes(plan.kind) && !state.done;
}

/** Campaign carry phases finish when the mission's extraction check succeeds. */
export function completeFragileCarry(state, plan) {
  if (!state || plan?.kind !== 'fragile' || !plan?.fragileLoot) return false;
  if (!state.done) {
    state.done = true;
    state.progress = 1;
    state.seq += 1;
    state.lastEvent = 'done';
  }
  return true;
}

export function objectiveBotTarget(state, plan, botRole, players) {
  if (!state || !plan || state.done) return null;
  const list = Array.isArray(players) ? players : [];
  const leader = list.find((p) => p && p.role !== botRole);
  if (!leader) return null;
  const pos = point(leader.position ?? leader);
  if (plan.kind === 'twin-levers' && plan.levers?.length >= 2) {
    const d0 = distance(pos, point(plan.levers[0])), d1 = distance(pos, point(plan.levers[1]));
    if (Math.min(d0, d1) > 6) return null;
    const target = point(plan.levers[d0 <= d1 ? 1 : 0]);
    return { ...target, y: Math.max(1.6, target.y) };
  }
  if (plan.kind === 'pylon-safe' && plan.pylon && plan.safe && plan.anchor) {
    if (distance(pos, point(plan.pylon)) > 10) return null;
    const target = distance(pos, point(plan.safe)) < distance(pos, point(plan.anchor))
      ? point(plan.anchor)
      : point(plan.safe);
    return { ...target, y: Math.max(1.6, target.y) };
  }
  if (plan.kind === 'relay' && plan.pads?.[state.step]?.role === botRole) {
    const target = point(plan.pads[state.step]);
    return { ...target, y: Math.max(1.6, target.y) };
  }
  return null;
}

export function objectiveBotAvoidYank(state, plan, carrier) {
  return plan?.kind === 'fragile' && carrier != null;
}

export function objectiveHud(state, plan) {
  const label = String(plan?.label ?? '').slice(0, 22);
  const n = (v) => Math.max(0, Math.floor(finite(v)));
  let detail = '';
  switch (plan?.kind) {
    case 'twin-levers': detail = `Levers ${n(state?.progress >= 0.5 ? 2 : state?.progress * 4)}/2 · hold ${(finite(plan.holdSeconds, 1)).toFixed(1)}s`; break;
    case 'pylon-safe': detail = `Pulls ${n(state?.pulls)}/${n(plan.pullsRequired || 1)}`; break;
    case 'fragile': detail = `Integrity ${n((1 - finite(state?.cracks) / Math.max(1, n(plan.cracksToShatter || 3))) * n(plan.cracksToShatter || 3))}/${n(plan.cracksToShatter || 3)}`; break;
    case 'relay': detail = `Pad ${n(state?.step)}/${n(plan.pads?.length)} · ${n(Math.max(0, finite(plan.stepSeconds, 6) - finite(state?.timer)))}s left`; break;
    default: detail = 'Ready';
  }
  return { label, detail, progress: clamp(state?.progress, 0, 1) };
}

export function serializeObjectiveState(state) {
  const result = {};
  for (const key of ['kind', 'done', 'step', 'pulls', 'cracks', 'shatters', 'lastEvent']) result[key] = state?.[key];
  for (const key of ['progress', 'timer']) result[key] = Math.round(finite(state?.[key]) * 1000) / 1000;
  result.seq = Math.round(finite(state?.seq));
  return result;
}

export function applyObjectiveSnapshot(state, snap) {
  if (!state || !snap) return state;
  for (const key of ['kind', 'done', 'step', 'pulls', 'cracks', 'shatters', 'lastEvent', 'progress', 'timer', 'seq']) if (key in snap) state[key] = snap[key];
  state.progress = clamp(state.progress, 0, 1);
  privateState.set(state, { leverHeld: [false, false], leverOwners: [null, null] });
  return state;
}
