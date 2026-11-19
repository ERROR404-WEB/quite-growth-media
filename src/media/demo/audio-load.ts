import type { BrandConfig } from '../../brands/index.js';
import { getEnv } from '../../config/env.js';
import { createPool } from '../../db/pool.js';
import type { AudioAsset, AudioUsageStats } from '../audio-library.js';
import { loadAudioLibrary, loadAudioUsage } from '../audio-library-store.js';

/** Best-effort: approved licensed audio + this brand's recent usage (empty when the DB is unreachable). */
export async function loadApprovedAudio(
  brand: BrandConfig,
): Promise<{ library: AudioAsset[]; usage: Map<string, AudioUsageStats>; note: string }> {
  let db;
  try {
    db = createPool(getEnv().DATABASE_URL, 1);
    const library = await loadAudioLibrary(db, ['approved']);
    const usage = await loadAudioUsage(db, brand.id);
    return { library, usage, note: `${library.length} approved asset(s) in the audio library` };
  } catch (err) {
    return {
      library: [],
      usage: new Map(),
      note: `audio library unavailable (${(err as Error).message.split('\n')[0]}) - narration only`,
    };
  } finally {
    await db?.end().catch(() => undefined);
  }
}
