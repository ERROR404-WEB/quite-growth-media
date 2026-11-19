import { behtarBano } from './definitions/behtar-bano.js';
import { bhaktiKiShakti } from './definitions/bhakti-ki-shakti.js';
import { chinniLokam } from './definitions/chinni-lokam.js';
import { dailyFaithAndLight } from './definitions/daily-faith-and-light.js';
import { devuduManathoUnnadu } from './definitions/devudu-manatho-unnadu.js';
import { littleWonderWorld } from './definitions/little-wonder-world.js';
import { nanheSitare } from './definitions/nanhe-sitare.js';
import { ninnuNuvvuGeluvu } from './definitions/ninnu-nuvvu-geluvu.js';
import { quietGrowth } from './definitions/quiet-growth.js';
import { brandConfigSchema, type BrandConfig } from './types.js';

const RAW_BRANDS: BrandConfig[] = [
  quietGrowth,
  dailyFaithAndLight,
  bhaktiKiShakti,
  devuduManathoUnnadu,
  behtarBano,
  ninnuNuvvuGeluvu,
  littleWonderWorld,
  nanheSitare,
  chinniLokam,
];

/** Validates every brand and cross-brand uniqueness. Throws with all problems listed. */
export function validateBrands(brands: BrandConfig[]): BrandConfig[] {
  const errors: string[] = [];
  const parsed = brands.map((b) => {
    const result = brandConfigSchema.safeParse(b);
    if (!result.success) {
      errors.push(...result.error.issues.map((i) => `${b.id ?? '?'}: ${i.path.join('.')} ${i.message}`));
    }
    return result.data ?? b;
  });
  for (const key of ['id', 'brandNumber', 'displayName'] as const) {
    const seen = new Set<unknown>();
    for (const b of parsed) {
      if (seen.has(b[key])) errors.push(`duplicate ${key}: ${String(b[key])}`);
      seen.add(b[key]);
    }
  }
  // Every brand keeps its own recognisable narrator: no voice is shared between brands.
  const voiceOwner = new Map<string, string>();
  for (const b of parsed) {
    const id = b.voice?.elevenLabs?.voiceId;
    if (!id) continue;
    const other = voiceOwner.get(id);
    if (other) errors.push(`duplicate voice: ${b.id} and ${other} both use ${id}`);
    voiceOwner.set(id, b.id);
  }
  if (errors.length) throw new Error(`Invalid brand configuration:\n  ${errors.join('\n  ')}`);
  return [...parsed].sort((a, b) => a.brandNumber - b.brandNumber);
}

export const BRANDS: readonly BrandConfig[] = Object.freeze(validateBrands(RAW_BRANDS));

export function getBrand(id: string): BrandConfig | undefined {
  return BRANDS.find((b) => b.id === id);
}

export type { BrandConfig } from './types.js';
