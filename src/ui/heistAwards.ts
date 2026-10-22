import type { DroneRole } from '../network/NetworkTypes.ts';
import type { FaceMood } from './FaceGlyph.ts';

/** Snapshot of counters MissionDirector can already see (plus a few light hooks). */
export interface RunStats {
  elapsedSeconds: number;
  timesSpotted: number;
  objectsThrown: number;
  tetherSaves: number;
  clotheslines: number;
  /** Cord yanks / twangs this run (from gameEvents 'yank'). */
  cordTwangs: number;
  /** Detection peaked high then cooled without a spot. */
  nearMisses: number;
  /** Planar metres the heavy lab crate moved while held. */
  crateHaulMeters: number;
  /** Who was spotted most often (for owner-coloured awards). */
  spottedBy: ReadonlyArray<DroneRole>;
  /** Who initiated the most yanks. */
  yankBy: ReadonlyArray<DroneRole>;
  outcome: 'win' | 'fail';
}

export interface HeistAward {
  id: string;
  /** Playful title, sentence case. */
  title: string;
  detail: string;
  owner: DroneRole | 'both' | 'none';
}

export interface GradeFace {
  mood: FaceMood;
  color: string;
  label: string;
}

const PIX = '#3DDBFF';
const NEE = '#FF6194';
const BOTH = '#BE9162';

/** Grade = three face-screens (not stars). Better runs get happier faces. */
export function gradeFaces(stats: RunStats): GradeFace[] {
  const stars = gradeScore(stats);
  const moods: FaceMood[] =
    stars >= 3 ? ['proud', 'happy', 'proud']
      : stars === 2 ? ['happy', 'happy', 'sneaky']
        : ['shocked', 'sneaky', 'sleepy'];
  const labels = [`Grade face 1 of 3`, `Grade face 2 of 3`, `Grade face 3 of 3`];
  return moods.map((mood, i) => ({
    mood,
    color: i === 1 ? NEE : PIX,
    label: `${labels[i]}: ${mood}`,
  }));
}

/** Same 1–3 scale the old ★ rating used, kept so feel matches prior runs. */
export function gradeScore(stats: RunStats): 1 | 2 | 3 {
  const spotted = Math.round(stats.timesSpotted);
  const bonusTime = stats.elapsedSeconds < 420;
  const bonusHeroics = stats.tetherSaves + stats.clotheslines >= 2;
  return (1 + (spotted <= 1 ? 1 : 0) + (bonusTime || bonusHeroics ? 1 : 0)) as 1 | 2 | 3;
}

export function formatRunTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function majority(roles: ReadonlyArray<DroneRole>): DroneRole | 'both' {
  let pix = 0;
  let nee = 0;
  for (const role of roles) {
    if (role === 'pix') pix += 1;
    else nee += 1;
  }
  if (pix === nee) return 'both';
  return pix > nee ? 'pix' : 'nee';
}

function name(owner: DroneRole | 'both' | 'none'): string {
  if (owner === 'pix') return 'PIX';
  if (owner === 'nee') return 'NEE';
  if (owner === 'both') return 'both drones';
  return 'the crew';
}

/**
 * Pick 2–3 funny awards from real counters. Prefer the most distinctive stats;
 * always return something cheeky even on a quiet run.
 */
export function pickAwards(stats: RunStats): HeistAward[] {
  const candidates: Array<HeistAward & { weight: number }> = [];

  if (stats.cordTwangs > 0) {
    const owner = majority(stats.yankBy);
    candidates.push({
      id: 'twang',
      title: 'Chief twanger',
      detail: `${stats.cordTwangs} cord twang${stats.cordTwangs === 1 ? '' : 's'} · ${name(owner)}`,
      owner,
      weight: 4 + Math.min(6, stats.cordTwangs),
    });
  }

  if (stats.clotheslines > 0) {
    candidates.push({
      id: 'clothesline',
      title: 'Laundry day',
      detail: `${stats.clotheslines} patrol${stats.clotheslines === 1 ? '' : 's'} clothesline`,
      owner: 'both',
      weight: 8 + stats.clotheslines * 2,
    });
  }

  if (stats.tetherSaves > 0) {
    candidates.push({
      id: 'rescue',
      title: 'Most yanked',
      detail: `${stats.tetherSaves} tether rescue${stats.tetherSaves === 1 ? '' : 's'}`,
      owner: 'both',
      weight: 7 + stats.tetherSaves * 2,
    });
  }

  if (stats.timesSpotted > 0) {
    const owner = majority(stats.spottedBy.length ? stats.spottedBy : ['pix', 'nee']);
    candidates.push({
      id: 'spotted',
      title: 'Caught on camera',
      detail: `${Math.round(stats.timesSpotted)} time${stats.timesSpotted === 1 ? '' : 's'} · mostly ${name(owner)}`,
      owner,
      weight: 3 + Math.round(stats.timesSpotted),
    });
  } else {
    candidates.push({
      id: 'ghost',
      title: 'Certified ghosts',
      detail: 'Zero spots. Security is writing a strongly worded sticky note.',
      owner: 'both',
      weight: 9,
    });
  }

  if (stats.nearMisses > 0) {
    candidates.push({
      id: 'near-miss',
      title: 'Almost toast',
      detail: `${stats.nearMisses} near miss${stats.nearMisses === 1 ? '' : 'es'}`,
      owner: 'both',
      weight: 5 + stats.nearMisses,
    });
  }

  if (stats.crateHaulMeters >= 2) {
    const metres = Math.round(stats.crateHaulMeters);
    candidates.push({
      id: 'haul',
      title: 'Crate chauffeur',
      detail: `${metres} m of heavy lab crate hauled`,
      owner: 'both',
      weight: 6 + Math.min(8, metres / 2),
    });
  }

  if (stats.objectsThrown > 0) {
    candidates.push({
      id: 'pitcher',
      title: 'Office pitcher',
      detail: `${Math.round(stats.objectsThrown)} object${stats.objectsThrown === 1 ? '' : 's'} yeeted`,
      owner: 'both',
      weight: 2 + Math.round(stats.objectsThrown),
    });
  }

  if (stats.elapsedSeconds < 300) {
    candidates.push({
      id: 'speed',
      title: 'Speed-run sticky',
      detail: `Case closed in ${formatRunTime(stats.elapsedSeconds)}`,
      owner: 'both',
      weight: 6,
    });
  } else if (stats.elapsedSeconds > 600) {
    candidates.push({
      id: 'scenic',
      title: 'Scenic route',
      detail: `${formatRunTime(stats.elapsedSeconds)} of quality loitering`,
      owner: 'both',
      weight: 4,
    });
  }

  // Quiet-run fillers so we always have 2–3 tags.
  candidates.push(
    {
      id: 'cord',
      title: 'Cord respected',
      detail: 'The tether survived. Mostly.',
      owner: 'both',
      weight: 1,
    },
    {
      id: 'duo',
      title: 'Two drones, one brain cell',
      detail: 'It counts as teamwork.',
      owner: 'both',
      weight: 1,
    },
  );

  candidates.sort((a, b) => b.weight - a.weight);
  const picked: HeistAward[] = [];
  const seen = new Set<string>();
  for (const award of candidates) {
    if (seen.has(award.id)) continue;
    seen.add(award.id);
    picked.push({ id: award.id, title: award.title, detail: award.detail, owner: award.owner });
    if (picked.length >= 3) break;
  }
  return picked.slice(0, Math.max(2, Math.min(3, picked.length)));
}

export function awardColor(owner: HeistAward['owner']): string {
  if (owner === 'pix') return '#0A5BC2';
  if (owner === 'nee') return '#C42A55';
  if (owner === 'both') return BOTH;
  return '#5C6B6A';
}

export function quipFor(stats: RunStats): string {
  if (stats.outcome === 'fail') {
    return 'PIX: “New plan.”   NEE: “That was the plan.”';
  }
  const spotted = Math.round(stats.timesSpotted);
  if (spotted === 0) return 'PIX: “Ghosts. We were ghosts.”   NEE: “I was SO nervous.”';
  if (stats.tetherSaves > 0) return 'NEE: “You yanked me out of there!”   PIX: “That’s what the cord is for.”';
  return 'PIX: “Nobody saw a thing.”   NEE: “Everybody saw everything.”';
}
