/**
 * Re-export the single daily-seed helper from shared/run.ts.
 * Same UTC calendar date → same 32-bit seed everywhere (client UI + headless QA).
 */
export { dailySeed } from '../run.ts';
