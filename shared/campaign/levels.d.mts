import type { FloorPlan } from '../nightshift/types.d.ts';
import type { RunLayout } from '../seed/index.d.ts';
export interface CampaignLevel {
  id: 'l1-tethered' | 'l2-twin-levers' | 'l3-wrap-and-drag' | 'l4-fragile-relay' | 'l5-big-vault';
  index: 1 | 2 | 3 | 4 | 5;
  name: string;
  teaches: string;
  blurb: string;
  seed: number;
  twist?: string;
  cord?: string;
  par: { seconds: number };
  buildPlan(layout: RunLayout): FloorPlan;
  coach: Array<{ text: string; until: string }>;
}
export declare const CAMPAIGN_LEVELS: readonly CampaignLevel[];
export declare const LEVEL_IDS: readonly string[];
export declare function campaignLevel(levelId: string): CampaignLevel | null;
export declare function campaignLayout(levelId: string): RunLayout;
