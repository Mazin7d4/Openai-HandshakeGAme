import { generateRun } from '../seed/index.mjs';
import { generateFloorPlan } from '../nightshift/plan.mjs';

const LEVEL_IDS = ['l1-tethered', 'l2-twin-levers', 'l3-wrap-and-drag', 'l4-fragile-relay', 'l5-big-vault'];
const SEEDS = [0x6c1a11, 0x6c1a22, 0x6c1a33, 0x6c1a44, 0x6c1a55];

function campaignJob(level) {
  return {
    id: level.id,
    name: level.name,
    boss: level.index === 5,
    payoutScale: 1,
    blurb: level.blurb,
    tutorial: level.index === 1,
  };
}

const vec = (x, z, y = 2.1) => ({ x, y, z });
const twin = (z) => ({
  kind: 'twin-levers', label: 'Open the paired lock',
  hint: 'Hold both console handles together.',
  levers: [vec(-4.1, z), vec(4.1, z)], leverRadius: 1.5, holdSeconds: 1.2,
});
const pylon = () => ({
  kind: 'pylon-safe', label: 'Pull the heavy safe',
  hint: 'Stay by the safe while your partner wraps the cord around the post.',
  pylon: vec(0, 5), safe: vec(-4, 5), anchor: vec(6.5, 5),
  hookRadius: 2, pullsRequired: 3,
});
const fragile = () => ({
  kind: 'fragile', label: 'Carry the glass core',
  hint: 'Carry the core gently to the green loading pad.',
  cracksToShatter: 3, fragileLoot: { cracksToShatter: 3 },
});

function authoredPlan(level, layout) {
  const source = generateFloorPlan(level.seed, 1, { ...layout, floor: 1 });
  let phases;
  if (level.index === 1) phases = [{ kind: 'grab', label: 'Carry the prototype', hint: 'Lift the core and fly together to the loading dock.' }];
  if (level.index === 2) phases = [twin(4.8)];
  if (level.index === 3) phases = [pylon()];
  if (level.index === 4) phases = [{
    kind: 'relay', label: 'Power the relay', hint: 'Hold each matching station as the power reaches it.',
    pads: [{ ...vec(4, -8), role: 'pix' }, { ...vec(4, -2), role: 'nee' },
      { ...vec(0, 5), role: 'pix' }, { ...vec(3, 12), role: 'nee' }],
    padRadius: 2, stepSeconds: 9, fragileLoot: { cracksToShatter: 3 },
  }, fragile()];
  if (level.index === 5) phases = [twin(-8), pylon(), fragile()];
  return {
    ...source,
    // The existing annex already supplies the architecture and landmarks.
    // Extra randomized furnishings would compete with the single lesson.
    rooms: source.rooms.map((room) => ({ ...room, archetype: 'classic', pieces: [] })),
    hazards: [], objective: phases[0], ...(phases.length > 1 ? { phases } : {}),
    job: campaignJob(level), campaign: { levelId: level.id, index: level.index },
  };
}

const definitions = [
  { id: 'l1-tethered', index: 1, name: 'Tethered', teaches: 'Fly together, mind the cord, and carry the prototype.', blurb: 'Thread the warm vault together and bring the prototype home.', seed: SEEDS[0], twist: 'warm', cord: 'standard', par: { seconds: 150 }, coach: [{ text: 'Fly together — the cord is your tool.', until: 'moved' }, { text: 'Carry the prototype to extraction together.', until: 'delivered' }] },
  { id: 'l2-twin-levers', index: 2, name: 'Twin Levers', teaches: 'Stretch the cord and hold both levers at once.', blurb: 'Two levers, one vault: make the tether work for you.', seed: SEEDS[1], twist: 'glass', cord: 'standard', par: { seconds: 180 }, coach: [{ text: 'Pull both levers while staying connected.', until: 'lever' }] },
  { id: 'l3-wrap-and-drag', index: 3, name: 'Wrap and Drag', teaches: 'Wrap the cord around the pylon and pull in rhythm.', blurb: 'The safe slides free only when the tether finds the corner.', seed: SEEDS[2], twist: 'warm-metal', cord: 'long', par: { seconds: 210 }, coach: [{ text: 'Hook the safe, wrap the pylon, then pull.', until: 'pull' }] },
  { id: 'l4-fragile-relay', index: 4, name: 'Fragile Relay', teaches: 'Alternate relay pads, then carry without yanking.', blurb: 'Cross the swept corridor, then keep the fragile core steady.', seed: SEEDS[3], twist: 'lights-out', cord: 'standard', par: { seconds: 240 }, coach: [{ text: 'Follow the pads in order — PIX, NEE, PIX.', until: 'pad' }, { text: 'The core is fragile. No yanks while carrying.', until: 'delivered' }] },
  { id: 'l5-big-vault', index: 5, name: 'The Big Vault', teaches: 'Everything you learned, under the final alarm.', blurb: 'Open the big vault, drag its safe, and escape with the fragile core.', seed: SEEDS[4], twist: 'alarm-red', cord: 'standard', par: { seconds: 240 }, coach: [{ text: 'Phase 1/3 · Pull both levers.', until: 'lever' }, { text: 'Phase 2/3 · Wrap the pylon.', until: 'pull' }, { text: 'Phase 3/3 · Carry out without a yank.', until: 'delivered' }] },
];

export const CAMPAIGN_LEVELS = Object.freeze(definitions.map((level) => Object.freeze({
  ...level,
  coach: [],
  buildPlan: (layout) => authoredPlan(level, layout),
})));

export function campaignLevel(levelId) {
  return CAMPAIGN_LEVELS.find((level) => level.id === levelId) ?? null;
}

export function campaignLayout(levelId) {
  const level = campaignLevel(levelId);
  if (!level) throw new Error(`Unknown campaign level: ${levelId}`);
  const raw = generateRun(level.seed, 1);
  const layout = {
    ...raw, floor: level.index,
    spawn: vec(0, level.index >= 4 ? -16 : level.index === 1 ? -10 : -3, 2.2),
    loot: vec(0, 18, 5.25), extraction: vec(11, 43.5, 2),
    terminals: { ...raw.terminals, 'terminal-c': vec(0, -5, 2.2) },
    patrolRoutes: [], cameras: [],
    cord: { restLength: 7, maxLength: 10 },
  };
  return Object.freeze({ ...layout, plan: level.buildPlan(layout) });
}

export { LEVEL_IDS };
