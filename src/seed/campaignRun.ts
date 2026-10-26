import { campaignLayout } from '../../shared/campaign/levels.mjs';
import type { RunLayout } from './index.ts';

export function generateCampaignRun(levelId: string): RunLayout {
  return campaignLayout(levelId) as RunLayout;
}
