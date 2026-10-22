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
  /** Night Shift run seed (shown on the report + used for challenge links). */
  seed?: number;
}

export interface HeistAward {
  id: string;
  /** Playful title, sentence case. */
  title: string;
  detail: string;
  owner: DroneRole | 'both' | 'none';
}

export interface GradeFace {
  /** Short caption under the face (Speed / Stealth / Teamwork). */
  caption: string;
  earned: boolean;
  mood: FaceMood;
  color: string;
  label: string;
}

/** Accent bar only (not title text) — LED hues for PIX/NEE, graphite for shared. */
const PIX_LED = '#3DDBFF';
const NEE_LED = '#FF6194';
const SHARED_ACCENT = '#5C6B6A';
/** Grade-face dots stay neutral so cyan/coral remain PIX & NEE crew faces only. */
const GRADE_INK = '#1E2A2B';
const GRADE_MISS = '#A7B6B5';

/** Three grade faces map to the same axes as gradeScore. */
export function gradeFaces(stats: RunStats): GradeFace[] {
  const speed = stats.elapsedSeconds < 420;
  const stealth = Math.round(stats.timesSpotted) <= 1;
  const teamwork = stats.tetherSaves + stats.clotheslines >= 2;
  const axes: Array<{ caption: string; earned: boolean; good: FaceMood; miss: FaceMood }> = [
    { caption: 'Speed', earned: speed, good: 'proud', miss: 'sleepy' },
    { caption: 'Stealth', earned: stealth, good: 'sneaky', miss: 'shocked' },
    { caption: 'Teamwork', earned: teamwork, good: 'happy', miss: 'neutral' },
  ];
  return axes.map((axis) => ({
    caption: axis.caption,
    earned: axis.earned,
    mood: axis.earned ? axis.good : axis.miss,
    color: axis.earned ? GRADE_INK : GRADE_MISS,
    label: `${axis.caption}: ${axis.earned ? 'earned' : 'missed'}`,
  }));
}

/** Same 1–3 scale the old ★ rating used, kept so feel matches prior runs. */
export function gradeScore(stats: RunStats): 1 | 2 | 3 {
  const stealth = Math.round(stats.timesSpotted) <= 1;
  const speed = stats.elapsedSeconds < 420;
  const teamwork = stats.tetherSaves + stats.clotheslines >= 2;
  return (1 + (stealth ? 1 : 0) + (speed || teamwork ? 1 : 0)) as 1 | 2 | 3;
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

/** Left accent bar colour only (LED hues). Titles use graphite ink for AA. */
export function awardAccent(owner: HeistAward['owner']): string {
  if (owner === 'pix') return PIX_LED;
  if (owner === 'nee') return NEE_LED;
  if (owner === 'both') return SHARED_ACCENT;
  return SHARED_ACCENT;
}

/** @deprecated Prefer awardAccent for bars; titles should use graphite ink. */
export function awardColor(owner: HeistAward['owner']): string {
  return awardAccent(owner);
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
