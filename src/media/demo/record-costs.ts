import type { Budget } from '../../ai/pricing.js';
import { getEnv } from '../../config/env.js';
import { createPool } from '../../db/pool.js';

// Budget entry kind -> cost_records.category (CHECK constraint in migrations/0001).
const CATEGORY: Record<string, string> = {
  script: 'script',
  illustration: 'illustration',
  voiceover: 'voiceover',
};

/**
 * Best-effort: writes a run's spend to cost_records so the dashboard can show it. `share` splits a
 * cost that several brands used (e.g. 1/3 of a shared storyboard and image set).
 */
export async function recordTestCosts(
  brandId: string,
  spend: readonly { provider: string; budget: Budget }[],
  metadata: Record<string, unknown>,
  share = 1,
): Promise<string> {
  const rows = spend.flatMap(({ provider, budget }) => budget.entries.map((e) => ({ provider, ...e })));
  if (rows.length === 0) return 'cost tracking: nothing spent';
  let db;
  try {
    db = createPool(getEnv().DATABASE_URL, 1);
    for (const e of rows) {
      await db.query(
        `INSERT INTO cost_records (brand_id, category, provider, units, unit_type, amount, currency, metadata)
         VALUES ($1, $2, $3, 1, 'request', $4, 'USD', $5)`,
        [
          brandId,
          CATEGORY[e.kind] ?? 'other',
          e.provider,
          (e.usd * share).toFixed(6),
          JSON.stringify({ ...metadata, model: e.model, test: true, ...(share !== 1 ? { share } : {}) }),
        ],
      );
    }
    return `cost tracking: ${rows.length} rows saved to cost_records`;
  } catch (err) {
    return `cost tracking: not saved to the database (${(err as Error).message.split('\n')[0]}) - see manifest.json`;
  } finally {
    await db?.end().catch(() => undefined);
  }
}
