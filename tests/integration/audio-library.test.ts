import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/pool.js';
import type { AudioAsset } from '../../src/media/audio-library.js';
import {
  loadAudioLibrary,
  loadAudioUsage,
  recordAudioUsage,
  upsertAudioAsset,
} from '../../src/media/audio-library-store.js';
import { createFreshTestDb, testDatabaseUrl } from '../helpers/db.js';

const verified: AudioAsset = {
  assetCode: 'mixkit-test-piano',
  kind: 'music',
  title: 'Test piano',
  creator: 'Artist',
  fileName: 'piano.mp3',
  storageUri: 'data/audio/files/piano.mp3',
  checksumSha256: 'c'.repeat(64),
  durationSec: 92.5,
  bpm: 70,
  category: 'reflective',
  moods: ['calm'],
  source: 'mixkit',
  sourceUrl: 'https://mixkit.co/free-stock-music/',
  licenceType: 'mixkit_music_free',
  licenceVersion: 'Mixkit Stock Music Free License',
  licenceUrl: 'https://mixkit.co/license/#musicFree',
  commercialUse: 'allowed',
  monetizedSocialUse: 'allowed',
  modification: 'allowed',
  allowedPlatforms: ['instagram', 'facebook', 'youtube', 'x'],
  attributionRequired: false,
  attributionText: null,
  prohibitedUses: null,
  contentIdStatus: 'not_registered',
  licenceCheckedOn: '2026-11-18',
  licenceEvidenceUri: 'data/audio/evidence/piano.pdf',
  status: 'approved',
  reviewNotes: null,
};

describe.skipIf(!testDatabaseUrl())('audio library (integration)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createFreshTestDb();
  });
  afterAll(async () => {
    await db?.end();
  });

  it('round-trips an approved asset and updates it by asset code', async () => {
    expect(await upsertAudioAsset(db, verified)).toEqual({ created: true });
    expect(await upsertAudioAsset(db, { ...verified, title: 'Renamed' })).toEqual({ created: false });
    const [loaded] = await loadAudioLibrary(db, ['approved']);
    expect(loaded).toEqual({ ...verified, title: 'Renamed' });
  });

  it.each([
    ['unknown Content ID status', { contentIdStatus: 'unknown' as const }],
    ['no licence evidence', { licenceEvidenceUri: null }],
    ['no cleared platforms', { allowedPlatforms: [] }],
    ['commercial use not confirmed', { commercialUse: 'unknown' as const }],
    ['attribution without text', { attributionRequired: true, attributionText: null }],
  ])('refuses to approve an asset with %s', async (_name, overrides) => {
    await expect(
      upsertAudioAsset(db, {
        ...verified,
        assetCode: 'bad-asset',
        checksumSha256: 'd'.repeat(64),
        ...overrides,
      }),
    ).rejects.toThrow(/audio_library_assets_approval_requires_rights/);
  });

  it('stores unverified assets as pending review only', async () => {
    await upsertAudioAsset(db, {
      ...verified,
      assetCode: 'pending-asset',
      checksumSha256: 'e'.repeat(64),
      contentIdStatus: 'unknown',
      status: 'pending_review',
    });
    expect((await loadAudioLibrary(db, ['approved'])).map((a) => a.assetCode)).toEqual(['mixkit-test-piano']);
    expect(await loadAudioLibrary(db)).toHaveLength(2);
  });

  it('rejects a category that does not fit the kind and unknown platforms', async () => {
    await expect(
      db.query(`UPDATE audio_library_assets SET category = 'whoosh' WHERE asset_code = 'mixkit-test-piano'`),
    ).rejects.toThrow(/category_matches_kind/);
    await expect(
      db.query(
        `UPDATE audio_library_assets SET allowed_platforms = '{tiktok}' WHERE asset_code = 'pending-asset'`,
      ),
    ).rejects.toThrow(/allowed_platforms_check/);
  });

  it('records usage idempotently per key and reports per-brand rotation stats', async () => {
    const use = {
      assetCode: 'mixkit-test-piano',
      brandId: 'quiet-growth',
      role: 'music' as const,
      platforms: ['youtube' as const],
      idempotencyKey: 'video-1:music',
    };
    expect(await recordAudioUsage(db, use)).toBe(true);
    expect(await recordAudioUsage(db, use)).toBe(false);
    await recordAudioUsage(db, { ...use, brandId: 'behtar-bano', idempotencyKey: 'video-2:music' });
    const usage = await loadAudioUsage(db, 'quiet-growth');
    expect(usage.get('mixkit-test-piano')).toMatchObject({ uses: 2, brandUses: 1 });
    expect(usage.get('mixkit-test-piano')!.lastBrandUseAt).toBeInstanceOf(Date);
    const { rows } = await db.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM audio_library_assets WHERE asset_code = 'mixkit-test-piano'`,
    );
    expect(rows[0]!.last_used_at).toBeInstanceOf(Date);
  });

  it('refuses to delete an asset that has been used', async () => {
    await expect(
      db.query(`DELETE FROM audio_library_assets WHERE asset_code = 'mixkit-test-piano'`),
    ).rejects.toThrow(/foreign key/);
  });
});
