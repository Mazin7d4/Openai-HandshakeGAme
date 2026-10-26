export interface CampaignLevelProgress { stars: [boolean, boolean, boolean]; bestSeconds: number }
export interface CampaignProgress { v: 1; levels: Record<string, CampaignLevelProgress> }
export const CAMPAIGN_STORAGE_KEY = 'pixnee.campaign.v1';

const empty = (): CampaignProgress => ({ v: 1, levels: {} });
function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
function valid(value: unknown): value is CampaignProgress {
  const data = value as CampaignProgress | null;
  return !!data && data.v === 1 && !!data.levels && typeof data.levels === 'object';
}
export function load(): CampaignProgress {
  try {
    const raw = storage()?.getItem(CAMPAIGN_STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!valid(parsed)) return empty();
    const levels: Record<string, CampaignLevelProgress> = {};
    for (const [id, value] of Object.entries(parsed.levels)) {
      const stars: [boolean, boolean, boolean] = Array.isArray(value.stars) && value.stars.length === 3
        ? [Boolean(value.stars[0]), Boolean(value.stars[1]), Boolean(value.stars[2])]
        : [false, false, false];
      levels[id] = { stars, bestSeconds: Number.isFinite(value.bestSeconds) ? Math.max(0, value.bestSeconds) : 0 };
    }
    return { v: 1, levels };
  } catch { return empty(); }
}
export function save(progress: CampaignProgress): CampaignProgress { try { storage()?.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(progress)); } catch { /* private mode */ } return progress; }
export function record(id: string, stars: readonly boolean[], seconds: number): CampaignProgress {
  const next = load(); const old = next.levels[id];
  const merged: [boolean, boolean, boolean] = [0, 1, 2].map((i) => Boolean(old?.stars?.[i] || stars[i])) as [boolean, boolean, boolean];
  next.levels[id] = { stars: merged, bestSeconds: old?.bestSeconds && old.bestSeconds < seconds ? old.bestSeconds : Math.max(0, seconds) };
  return save(next);
}
export function isUnlocked(indexOrId: number | string, progress = load()): boolean {
  const index = typeof indexOrId === 'number' ? indexOrId : ['l1-tethered', 'l2-twin-levers', 'l3-wrap-and-drag', 'l4-fragile-relay', 'l5-big-vault'].indexOf(indexOrId) + 1;
  if (index <= 1) return true;
  const previous = ['l1-tethered', 'l2-twin-levers', 'l3-wrap-and-drag', 'l4-fragile-relay'][index - 2];
  return Boolean(previous && progress.levels[previous]);
}
export function unlockAll(): CampaignProgress {
  const next = load();
  for (const id of ['l1-tethered', 'l2-twin-levers', 'l3-wrap-and-drag', 'l4-fragile-relay', 'l5-big-vault']) if (!next.levels[id]) next.levels[id] = { stars: [false, false, false], bestSeconds: 0 };
  return save(next);
}
