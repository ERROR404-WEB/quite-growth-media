import { BRANDS, type BrandConfig } from '../brands/index.js';
import type { Db } from './pool.js';
import { withTransaction } from './pool.js';

export interface SeedResult {
  brands: number;
  socialAccountsCreated: number;
}

/**
 * Upserts the nine brand configs and creates one placeholder social account per brand/platform
 * (status "not_connected"). Safe to run repeatedly.
 */
export async function seed(db: Db, brands: readonly BrandConfig[] = BRANDS): Promise<SeedResult> {
  return withTransaction(db, async (client) => {
    let socialAccountsCreated = 0;
    for (const b of brands) {
      await client.query(
        `INSERT INTO brands (id, brand_number, display_name, native_name, language, locale, audience, niche,
                             age_min, age_max, made_for_kids, daily_video_target, publish_timezone, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           brand_number = EXCLUDED.brand_number, display_name = EXCLUDED.display_name,
           native_name = EXCLUDED.native_name, language = EXCLUDED.language, locale = EXCLUDED.locale,
           audience = EXCLUDED.audience, niche = EXCLUDED.niche, age_min = EXCLUDED.age_min,
           age_max = EXCLUDED.age_max, made_for_kids = EXCLUDED.made_for_kids,
           daily_video_target = EXCLUDED.daily_video_target, publish_timezone = EXCLUDED.publish_timezone,
           config = EXCLUDED.config`,
        [
          b.id,
          b.brandNumber,
          b.displayName,
          b.nativeName ?? null,
          b.language,
          b.locale,
          b.audience,
          b.niche,
          b.ageRange?.min ?? null,
          b.ageRange?.max ?? null,
          b.madeForKids,
          b.dailyVideoTarget,
          b.publishTimezone,
          JSON.stringify(b),
        ],
      );
      for (const platform of b.platforms) {
        const res = await client.query(
          `INSERT INTO social_accounts (brand_id, platform, made_for_kids_default)
           VALUES ($1, $2, $3)
           ON CONFLICT (brand_id, platform) DO NOTHING`,
          [b.id, platform, b.madeForKids],
        );
        socialAccountsCreated += res.rowCount ?? 0;
      }
    }
    return { brands: brands.length, socialAccountsCreated };
  });
}
