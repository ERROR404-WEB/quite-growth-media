import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/pool.js';
import { linkBlotatoAccount, loadBlotatoTargets } from '../../src/publishing/accounts.js';
import { createFreshTestDb, testDatabaseUrl } from '../helpers/db.js';

describe.skipIf(!testDatabaseUrl())('Blotato account links (integration)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createFreshTestDb();
  });
  afterAll(async () => {
    await db?.end();
  });

  it('starts with no connected destinations', async () => {
    expect(await loadBlotatoTargets(db, 'quiet-growth')).toEqual({});
  });

  it('links Blotato accounts to the seeded brand slots (Facebook needs its Page)', async () => {
    await linkBlotatoAccount(db, {
      brandId: 'quiet-growth',
      platform: 'youtube',
      accountId: '13',
      handle: 'quietgrowth',
    });
    await expect(
      linkBlotatoAccount(db, { brandId: 'quiet-growth', platform: 'facebook', accountId: '12' }),
    ).rejects.toThrow(/page-id/);
    await linkBlotatoAccount(db, {
      brandId: 'quiet-growth',
      platform: 'facebook',
      accountId: '12',
      pageId: '900',
    });
    expect(await loadBlotatoTargets(db, 'quiet-growth')).toEqual({
      youtube: { platform: 'youtube', accountId: '13', pageId: undefined },
      facebook: { platform: 'facebook', accountId: '12', pageId: '900' },
    });
    const row = await db.query(
      `SELECT status, handle, publishing_provider FROM social_accounts WHERE brand_id = 'quiet-growth' AND platform = 'youtube'`,
    );
    expect(row.rows[0]).toEqual({
      status: 'connected',
      handle: 'quietgrowth',
      publishing_provider: 'blotato',
    });
    // Other brands are untouched.
    expect(await loadBlotatoTargets(db, 'behtar-bano')).toEqual({});
  });

  it('re-linking replaces the account and clears a stale Page ID', async () => {
    await linkBlotatoAccount(db, { brandId: 'quiet-growth', platform: 'youtube', accountId: '99' });
    expect((await loadBlotatoTargets(db, 'quiet-growth')).youtube?.accountId).toBe('99');
  });
});
