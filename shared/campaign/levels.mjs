import { generateRun } from '../seed/index.mjs';
import { generateFloorPlan } from '../nightshift/plan.mjs';

const LEVEL_IDS = ['l1-tethered', 'l2-twin-levers', 'l3-wrap-and-drag', 'l4-fragile-relay', 'l5-big-vault'];
const SEEDS = [0x6c1a11, 0x6c1a22, 0x6c1a33, 0x6c1a44, 0x6c1a55];

function phaseFor(seed, index, layout, kind) {
  for (let attempt = 0; attempt < 256; attempt++) {
    const candidate = generateFloorPlan((seed + attempt * 0x9e3779b9) >>> 0, index, { ...layout, floor: index });
    if (candidate.objective.kind === kind) return candidate;
  }
  return generateFloorPlan(seed, index, { ...layout, floor: index });
}

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

function authoredPlan(level, layout) {
  if (level.index === 1) {
    const source = generateFloorPlan(level.seed, 1, { ...layout, floor: 1 });
    return {
      ...source,
      job: campaignJob(level),
      hazards: [],
      campaign: { levelId: level.id, index: level.index },
    };
  }
  if (level.index === 2) {
    const source = phaseFor(level.seed, 2, layout, 'twin-levers');
    return { ...source, job: campaignJob(level), campaign: { levelId: level.id, index: level.index } };
  }
  if (level.index === 3) {
    const source = phaseFor(level.seed, 3, layout, 'pylon-safe');
    return { ...source, job: campaignJob(level), campaign: { levelId: level.id, index: level.index } };
  }
  if (level.index === 4) {
    const source = phaseFor(level.seed, 4, layout, 'relay');
    const objective = { ...source.objective, fragileLoot: { cracksToShatter: 3 } };
    return { ...source, objective, job: campaignJob(level), campaign: { levelId: level.id, index: level.index } };
  }
  const twin = phaseFor(level.seed, 5, layout, 'twin-levers').objective;
  const pylon = phaseFor(level.seed + 0x1111, 5, layout, 'pylon-safe').objective;
  const fragile = { ...phaseFor(level.seed + 0x2222, 4, layout, 'fragile').objective, fragileLoot: { cracksToShatter: 3 } };
  const source = phaseFor(level.seed, 5, layout, 'twin-levers');
  return {
    ...source,
    objective: twin,
    phases: [twin, pylon, fragile],
    job: campaignJob(level),
    campaign: { levelId: level.id, index: level.index },
  };
}

const definitions = [
  { id: 'l1-tethered', index: 1, name: 'Tethered', teaches: 'Fly together, mind the cord, and carry the prototype.', blurb: 'Thread the warm vault together and bring the prototype home.', seed: SEEDS[0], twist: 'warm', cord: 'standard', par: { seconds: 150 }, coach: [{ text: 'Fly together — the cord is your tool.', until: 'moved' }, { text: 'Carry the prototype to extraction together.', until: 'delivered' }] },
  { id: 'l2-twin-levers', index: 2, name: 'Twin Levers', teaches: 'Stretch the cord and hold both levers at once.', blurb: 'Two levers, one vault: make the tether work for you.', seed: SEEDS[1], twist: 'glass', cord: 'standard', par: { seconds: 180 }, coach: [{ text: 'Pull both levers while staying connected.', until: 'lever' }] },
  { id: 'l3-wrap-and-drag', index: 3, name: 'Wrap and Drag', teaches: 'Wrap the cord around the pylon and pull in rhythm.', blurb: 'The safe slides free only when the tether finds the corner.', seed: SEEDS[2], twist: 'warm-metal', cord: 'long', par: { seconds: 210 }, coach: [{ text: 'Hook the safe, wrap the pylon, then pull.', until: 'pull' }] },
  { id: 'l4-fragile-relay', index: 4, name: 'Fragile Relay', teaches: 'Alternate relay pads, then carry without yanking.', blurb: 'Cross the swept corridor, then keep the fragile core steady.', seed: SEEDS[3], twist: 'lights-out', cord: 'standard', par: { seconds: 240 }, coach: [{ text: 'Follow the pads in order — PIX, NEE, PIX.', until: 'pad' }, { text: 'The core is fragile. No yanks while carrying.', until: 'delivered' }] },
  { id: 'l5-big-vault', index: 5, name: 'The Big Vault', teaches: 'Everything you learned, under the final alarm.', blurb: 'Open the big vault, drag its safe, and escape with the fragile core.', seed: SEEDS[4], twist: 'alarm-red', cord: 'standard', par: { seconds: 300 }, coach: [{ text: 'Phase 1/3 · Pull both levers.', until: 'lever' }, { text: 'Phase 2/3 · Wrap the pylon.', until: 'pull' }, { text: 'Phase 3/3 · Carry out without a yank.', until: 'delivered' }] },
];

export const CAMPAIGN_LEVELS = Object.freeze(definitions.map((level) => Object.freeze({
  ...level,
  buildPlan: (layout) => authoredPlan(level, layout),
})));

export function campaignLevel(levelId) {
  return CAMPAIGN_LEVELS.find((level) => level.id === levelId) ?? null;
}

export function campaignLayout(levelId) {
  const level = campaignLevel(levelId);
  if (!level) throw new Error(`Unknown campaign level: ${levelId}`);
  const raw = generateRun(level.seed, 1);
  const layout = { ...raw, cord: { restLength: 7, maxLength: 10 } };
  return Object.freeze({ ...layout, plan: level.buildPlan(layout) });
}

export { LEVEL_IDS };
