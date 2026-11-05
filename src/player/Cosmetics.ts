import type { DroneRole } from '../network/NetworkTypes.ts';

export type CosmeticId =
  | 'none'
  | 'star-eyes' | 'heart' | 'sunglasses' | 'sleepy' | 'wink' | 'determined'
  | 'beanie' | 'crown' | 'antenna-bobble' | 'headset' | 'party-hat' | 'safari-hat';
export type CosmeticKind = 'expression' | 'hat';

export interface CosmeticDefinition {
  id: CosmeticId;
  kind: CosmeticKind;
  label: string;
  hint: string;
  unlock: string;
}

export const COSMETICS: readonly CosmeticDefinition[] = [
  { id: 'star-eyes', kind: 'expression', label: 'Star-eyes', hint: 'Bright-eyed after a vault crack.', unlock: 'Crack the vault for the first time.' },
  { id: 'heart', kind: 'expression', label: 'Heart', hint: 'For the perfect pair.', unlock: 'Win your first co-op heist.' },
  { id: 'sunglasses', kind: 'expression', label: 'Sunglasses', hint: 'Cool under pressure.', unlock: 'Score 1,000 in Night Shift.' },
  { id: 'sleepy', kind: 'expression', label: 'Sleepy', hint: 'Night shift veteran.', unlock: 'Score 2,500 in Night Shift.' },
  { id: 'wink', kind: 'expression', label: 'Wink', hint: 'Security saw nothing.', unlock: 'Finish a no-alarm heist.' },
  { id: 'determined', kind: 'expression', label: 'Determined', hint: 'Eyes on the core.', unlock: 'Score 5,000 in Night Shift.' },
  { id: 'beanie', kind: 'hat', label: 'Beanie', hint: 'Low profile, high style.', unlock: 'Complete your first heist.' },
  { id: 'crown', kind: 'hat', label: 'Tiny crown', hint: 'Vault royalty.', unlock: 'Score 10,000 in Night Shift.' },
  { id: 'antenna-bobble', kind: 'hat', label: 'Antenna bobble', hint: 'A little extra signal.', unlock: 'Reach floor 2 in Night Shift.' },
  { id: 'headset', kind: 'hat', label: 'Headset', hint: 'Comms are clear.', unlock: 'Win your first co-op heist.' },
  { id: 'party-hat', kind: 'hat', label: 'Party hat', hint: 'Celebrate the clean getaway.', unlock: 'Reach floor 3 in Night Shift.' },
  { id: 'safari-hat', kind: 'hat', label: 'Safari hat', hint: 'For dangerous office terrain.', unlock: 'Finish a no-alarm heist.' },
];

const KEY = 'pixnee.cosmetics';
export interface SelectedCosmetics { expression: CosmeticId; hat: CosmeticId; }
interface StoredCosmetics { unlocked: CosmeticId[]; selectedExpression: CosmeticId; selectedHat: CosmeticId; }
const DEFAULT: StoredCosmetics = { unlocked: ['none'], selectedExpression: 'none', selectedHat: 'none' };

function load(): StoredCosmetics {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StoredCosmetics> | null;
    const unlocked = Array.isArray(parsed?.unlocked)
      ? parsed.unlocked.filter((id): id is CosmeticId => id === 'none' || COSMETICS.some((c) => c.id === id))
      : DEFAULT.unlocked;
    const old = parsed as Partial<StoredCosmetics> & { selected?: CosmeticId };
    const selectedExpression = unlocked.includes(old.selectedExpression as CosmeticId)
      && COSMETICS.some((item) => item.id === old.selectedExpression && item.kind === 'expression')
      ? old.selectedExpression as CosmeticId : (old.selected && COSMETICS.some((item) => item.id === old.selected && item.kind === 'expression') ? old.selected : 'none');
    const selectedHat = unlocked.includes(old.selectedHat as CosmeticId)
      && COSMETICS.some((item) => item.id === old.selectedHat && item.kind === 'hat')
      ? old.selectedHat as CosmeticId : (old.selected && COSMETICS.some((item) => item.id === old.selected && item.kind === 'hat') ? old.selected : 'none');
    return { unlocked: [...new Set(unlocked)], selectedExpression, selectedHat };
  } catch { return { ...DEFAULT, unlocked: [...DEFAULT.unlocked] }; }
}

function save(state: StoredCosmetics): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
}

export function getCosmetics(): StoredCosmetics { return load(); }
export function isCosmeticUnlocked(id: CosmeticId): boolean { return id === 'none' || load().unlocked.includes(id); }
export function selectCosmetic(id: CosmeticId, kind?: CosmeticKind): boolean {
  const state = load();
  if (!state.unlocked.includes(id)) return false;
  if (id === 'none') {
    if (kind === 'expression') state.selectedExpression = 'none';
    else if (kind === 'hat') state.selectedHat = 'none';
    else return false;
    save(state);
    return true;
  }
  const item = cosmeticDefinition(id);
  if (!item) return false;
  if (item.kind === 'expression') state.selectedExpression = id;
  else state.selectedHat = id;
  save(state);
  return true;
}

export function unlockCosmetic(id: CosmeticId): boolean {
  const state = load();
  if (state.unlocked.includes(id)) return false;
  state.unlocked.push(id);
  save(state);
  return true;
}

export function noteVaultCrack(): CosmeticId[] {
  const id: CosmeticId = 'star-eyes';
  return unlockCosmetic(id) ? [id] : [];
}

export function recordRunUnlocks(input: {
  outcome: 'win' | 'fail';
  timesSpotted: number;
  nightShiftScore?: number;
  nightShiftFloor?: number;
  cooperative?: boolean;
}): CosmeticId[] {
  const ids: CosmeticId[] = [];
  const add = (id: CosmeticId) => { if (unlockCosmetic(id)) ids.push(id); };
  if (input.outcome === 'win') add('beanie');
  if (input.outcome === 'win' && input.cooperative) { add('heart'); add('headset'); }
  if (input.outcome === 'win' && input.timesSpotted === 0) { add('wink'); add('safari-hat'); }
  const score = input.nightShiftScore ?? 0;
  if (score >= 1_000) add('sunglasses');
  if (score >= 2_500) add('sleepy');
  if (score >= 5_000) add('determined');
  if (score >= 10_000) add('crown');
  const floor = input.nightShiftFloor ?? 0;
  if (floor >= 2) add('antenna-bobble');
  if (floor >= 3) add('party-hat');
  return ids;
}

export function cosmeticDefinition(id: CosmeticId): CosmeticDefinition | null {
  return COSMETICS.find((item) => item.id === id) ?? null;
}

export function getSelectedCosmetics(): SelectedCosmetics {
  const state = load();
  return { expression: state.selectedExpression, hat: state.selectedHat };
}

export function cosmeticRoleHint(role: DroneRole): string { return `Local ${role.toUpperCase()} only`; }
