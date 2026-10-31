export function scoreCampaignLevel(stats = {}) {
  const time = Number.isFinite(stats.seconds) && Number.isFinite(stats.parSeconds)
    ? stats.seconds <= stats.parSeconds : false;
  const loot = stats.lootIntact !== false;
  const noAlarm = stats.noAlarm === true || (stats.timesSpotted ?? 0) === 0;
  const stars = [time, loot, noAlarm];
  return { stars, count: stars.filter(Boolean).length };
}
