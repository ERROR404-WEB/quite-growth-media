// Licensed audio library CLI (docs/audio-library.md).
//   npm run audio:init                                  creates data/audio/{files,evidence}/ and an example catalog.json
//   npm run audio:import [-- --file <catalog.json>]     validates, checksums and saves every entry in the database
//   npm run audio:list                                  shows every asset and whether production may use it
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { PLATFORMS } from '../domain/constants.js';
import { buildAsset, catalogEntrySchema, EXAMPLE_CATALOG } from './audio-catalog.js';
import { rightsDecision } from './audio-library.js';
import { loadAudioLibrary, upsertAudioAsset } from './audio-library-store.js';
import { mediaDuration, resolveFfmpeg } from './ffmpeg.js';
import { REPO_ROOT } from './pipeline.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const rel = (p: string) => relative(REPO_ROOT, p).split(sep).join('/');

function init(): void {
  const dir = join(REPO_ROOT, 'data', 'audio');
  mkdirSync(join(dir, 'files'), { recursive: true });
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  const catalog = join(dir, 'catalog.json');
  if (existsSync(catalog)) {
    out(`Already exists: ${rel(catalog)} (not changed)`);
  } else {
    writeFileSync(catalog, `${JSON.stringify(EXAMPLE_CATALOG, null, 2)}\n`, 'utf8');
    out(`Created ${rel(catalog)} with one example entry.`);
  }
  out('Put audio files in data/audio/files/ and licence evidence in data/audio/evidence/.');
}

async function importCatalog(): Promise<void> {
  const catalogPath = resolve(arg('--file') ?? join(REPO_ROOT, 'data', 'audio', 'catalog.json'));
  if (!existsSync(catalogPath)) throw new Error(`Catalog not found: ${catalogPath} (run npm run audio:init)`);
  const entries = z.array(z.unknown()).parse(JSON.parse(readFileSync(catalogPath, 'utf8')));
  const tools = resolveFfmpeg();
  const db = createPool(getEnv().DATABASE_URL, 1);
  let imported = 0;
  let failed = 0;
  try {
    for (const [i, item] of entries.entries()) {
      const label = (item as { assetCode?: string } | null)?.assetCode ?? `entry ${i + 1}`;
      const entry = catalogEntrySchema.safeParse(item);
      if (!entry.success) {
        failed++;
        out(`✖ ${label}: ${entry.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
        continue;
      }
      const { asset, problems } = await buildAsset(entry.data, {
        catalogDir: dirname(catalogPath),
        root: REPO_ROOT,
        measureDuration: (f) => mediaDuration(f, tools),
      });
      if (!asset) {
        failed++;
        out(`✖ ${label}: ${problems.join('; ')}`);
        continue;
      }
      const { created } = await upsertAudioAsset(db, asset);
      imported++;
      out(`✔ ${label}: ${created ? 'added' : 'updated'} (${asset.kind}/${asset.category}, ${asset.status})`);
    }
  } finally {
    await db.end();
  }
  out(`\n${imported} imported, ${failed} with problems.`);
  if (failed) process.exitCode = 1;
}

async function list(): Promise<void> {
  const db = createPool(getEnv().DATABASE_URL, 1);
  try {
    const assets = await loadAudioLibrary(db);
    if (assets.length === 0) {
      out('The audio library is empty: videos use narration without music (copyright-safe).');
      return;
    }
    for (const a of assets) {
      const all = rightsDecision(a, PLATFORMS);
      const usable = all.approved
        ? 'usable on all 4 platforms'
        : `${a.status === 'approved' ? 'limited' : 'not usable'}: ${all.reasons.join('; ')}`;
      const kind = `${a.kind}/${a.category}`;
      out(`${a.status === 'approved' ? '✔' : '·'} ${a.assetCode.padEnd(28)} ${kind.padEnd(26)} ${usable}`);
    }
  } finally {
    await db.end();
  }
}

async function main(): Promise<void> {
  switch (process.argv[2]) {
    case 'init':
      return init();
    case 'import':
      return importCatalog();
    case 'list':
      return list();
    default:
      throw new Error('Usage: tsx src/media/audio-cli.ts <init|import|list> [--file catalog.json]');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
