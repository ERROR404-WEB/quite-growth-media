// Publishing through Blotato (docs/publishing.md). Dry run by default: nothing is sent without --live.
//   npm run blotato:accounts                         list connected Blotato accounts + Facebook Pages (needs BLOTATO_API_KEY)
//   npm run blotato:link -- --brand quiet-growth --platform facebook --account-id 123 --page-id 456 [--handle name]
//   npm run publish:video -- --dir data/renders/<...>/<run>            dry run: publishing gate + payload preview
//   npm run publish:video -- --dir <run> --live [--platforms youtube] [--privacy private|unlisted|public]
//                                              [--schedule 2026-12-01T14:00:00Z | --schedule next] [--retry-failed]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getBrand } from '../brands/index.js';
import { getEnv } from '../config/env.js';
import type { Platform } from '../domain/constants.js';
import { PLATFORMS } from '../domain/constants.js';
import { createPool } from '../db/pool.js';
import { linkBlotatoAccount, loadBlotatoTargets } from './accounts.js';
import { BlotatoClient } from './blotato.js';
import { getBlotatoConfig, requireBlotatoKey } from './config.js';
import type { RenderManifest } from './gate.js';
import { publishRender } from './publisher.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(name);

function client(): BlotatoClient {
  const cfg = getBlotatoConfig();
  return new BlotatoClient({ apiKey: requireBlotatoKey(cfg), baseUrl: cfg.BLOTATO_BASE_URL });
}

async function accounts(): Promise<void> {
  const c = client();
  const items = await c.listAccounts();
  if (items.length === 0) {
    out('No social accounts are connected in Blotato yet: https://my.blotato.com/accounts');
    return;
  }
  for (const a of items) {
    out(
      `${a.platform.padEnd(10)} account ${a.id}  ${a.username ?? ''} ${a.fullname ? `(${a.fullname})` : ''}`,
    );
    if (a.platform === 'facebook') {
      for (const p of await c.listSubaccounts(a.id)) out(`           page    ${p.id}  ${p.name ?? ''}`);
    }
  }
  out(
    '\nLink each one to its brand: npm run blotato:link -- --brand <id> --platform <instagram|facebook|youtube|x> --account-id <id> [--page-id <id>]',
  );
}

async function link(): Promise<void> {
  const brandId = arg('--brand');
  const platform = arg('--platform') as Platform | undefined;
  const accountId = arg('--account-id');
  if (!brandId || !getBrand(brandId)) throw new Error('Pass --brand <brand id>');
  if (!platform || !PLATFORMS.includes(platform)) throw new Error(`Pass --platform ${PLATFORMS.join('|')}`);
  if (!accountId || !/^[A-Za-z0-9_-]{1,64}$/.test(accountId))
    throw new Error('Pass --account-id <Blotato account id>');
  const db = createPool(getEnv().DATABASE_URL, 1);
  try {
    await linkBlotatoAccount(db, {
      brandId,
      platform,
      accountId,
      pageId: arg('--page-id'),
      handle: arg('--handle'),
    });
    out(
      `✔ ${brandId}/${platform} → Blotato account ${accountId}${arg('--page-id') ? ` (page ${arg('--page-id')})` : ''}`,
    );
  } finally {
    await db.end();
  }
}

async function publish(): Promise<void> {
  const dirArg = arg('--dir');
  if (!dirArg) throw new Error('Pass --dir <render folder>');
  const dir = resolve(dirArg);
  const manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`No manifest.json in ${dir}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as RenderManifest;
  const brand = getBrand(manifest.brandId);
  if (!brand) throw new Error(`Unknown brand ${manifest.brandId}`);
  const platforms = (arg('--platforms')
    ?.split(',')
    .map((p) => p.trim()) ?? brand.platforms) as Platform[];
  if (platforms.some((p) => !PLATFORMS.includes(p)))
    throw new Error(`Invalid --platforms ${platforms.join(',')}`);
  const cfg = getBlotatoConfig();
  const privacy = (arg('--privacy') ?? cfg.BLOTATO_YOUTUBE_PRIVACY) as 'private' | 'unlisted' | 'public';
  if (!['private', 'unlisted', 'public'].includes(privacy)) throw new Error(`Invalid --privacy ${privacy}`);
  const live = flag('--live');

  const db = createPool(getEnv().DATABASE_URL, 1);
  let targets;
  try {
    targets = await loadBlotatoTargets(db, brand.id);
  } finally {
    await db.end();
  }

  out(
    `▶ ${live ? 'PUBLISHING' : 'Dry run (nothing is sent; add --live to publish)'}: "${manifest.title}" · ${brand.displayName} → ${platforms.join(', ')}`,
  );
  const outcomes = await publishRender({
    dir,
    brand,
    manifest,
    platforms,
    targets,
    client: live ? client() : null,
    youtubePrivacy: privacy,
    schedule: arg('--schedule'),
    retryFailed: flag('--retry-failed'),
    log: out,
  });
  const icon = {
    blocked: '✖',
    'dry-run': '○',
    skipped: '=',
    published: '✔',
    scheduled: '⏱',
    'in-progress': '…',
    failed: '✖',
    'needs-check': '!',
  };
  for (const o of outcomes) {
    out(`  ${icon[o.result]} ${o.platform.padEnd(9)} ${o.result}: ${o.detail}`);
    if (!live && o.request) out(`    payload: ${JSON.stringify(o.request)}`);
  }
  if (outcomes.some((o) => ['blocked', 'failed', 'needs-check'].includes(o.result))) process.exitCode = 1;
}

const commands: Record<string, () => Promise<void>> = { accounts, link, publish };
const command = process.argv[2] ?? '';
const run = commands[command];
if (!run) {
  console.error(`Usage: tsx src/publishing/cli.ts <${Object.keys(commands).join('|')}> [options]`);
  process.exitCode = 1;
} else {
  run().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
