export interface CampaignScoreStats { seconds?: number; parSeconds?: number; lootIntact?: boolean; noAlarm?: boolean; timesSpotted?: number }
export declare function scoreCampaignLevel(stats?: CampaignScoreStats): { stars: [boolean, boolean, boolean]; count: number };
