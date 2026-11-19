import type { Platform } from '../domain/constants.js';
import type { Queryable } from '../db/pool.js';
import type { PublishTarget } from './post-builder.js';

/**
 * Blotato destinations live on the seeded social_accounts rows (one per brand and platform):
 * provider_account_ref = Blotato account ID, capabilities.pageId = Facebook Page ID.
 * These are identifiers, not credentials; the Blotato API key stays in .env only.
 */
export async function linkBlotatoAccount(
  db: Queryable,
  link: { brandId: string; platform: Platform; accountId: string; pageId?: string; handle?: string },
): Promise<void> {
  if (link.platform === 'facebook' && !link.pageId)
    throw new Error('Facebook needs --page-id (the Page to post to)');
  const res = await db.query(
    `UPDATE social_accounts
        SET publishing_provider = 'blotato',
            provider_account_ref = $3,
            capabilities = CASE WHEN $4::text IS NULL THEN capabilities - 'pageId'
                                ELSE capabilities || jsonb_build_object('pageId', $4::text) END,
            handle = COALESCE($5, handle),
            status = 'connected'
      WHERE brand_id = $1 AND platform = $2`,
    [link.brandId, link.platform, link.accountId, link.pageId ?? null, link.handle ?? null],
  );
  if (res.rowCount !== 1)
    throw new Error(`No social account slot for ${link.brandId}/${link.platform} (run npm run db:seed)`);
}

/** Connected Blotato destinations of one brand. */
export async function loadBlotatoTargets(
  db: Queryable,
  brandId: string,
): Promise<Partial<Record<Platform, PublishTarget>>> {
  const res = await db.query<{ platform: Platform; account_id: string; page_id: string | null }>(
    `SELECT platform, provider_account_ref AS account_id, capabilities->>'pageId' AS page_id
       FROM social_accounts
      WHERE brand_id = $1 AND publishing_provider = 'blotato' AND status = 'connected'
        AND provider_account_ref IS NOT NULL`,
    [brandId],
  );
  const targets: Partial<Record<Platform, PublishTarget>> = {};
  for (const r of res.rows) {
    targets[r.platform] = { platform: r.platform, accountId: r.account_id, pageId: r.page_id ?? undefined };
  }
  return targets;
}
