import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandConfig } from '../brands/index.js';
import type { PaletteMood, ShotType } from '../domain/constants.js';
import { renderPlaceholderScene } from './placeholder-art.js';

export interface IllustrationRequest {
  brand: BrandConfig;
  sceneIndex: number;
  sceneCount: number;
  /** Visual direction from the script (English). */
  visual: string;
  /** Shot type and colour mood chosen by the script for this line. */
  shot?: ShotType;
  palette?: PaletteMood;
  /** Recurring character description, repeated in every scene for consistency. */
  characterDescription?: string;
  /** Deterministic seed for placeholder art. */
  seed: string;
  props?: number;
  /** Size the renderer wants (images of another aspect ratio are cover-cropped). */
  width: number;
  height: number;
  workDir: string;
  signal?: AbortSignal;
}

export interface Illustration {
  /** File name inside workDir. */
  file: string;
  provider: string;
  model?: string;
  prompt?: string;
  costUsd: number;
  /** Provider-specific provenance (size, quality, token usage, request time). */
  provenance: Record<string, unknown>;
}

/** An illustration provider. Placeholder today; OpenAI images when configured. */
export interface Illustrator {
  readonly name: string;
  generate(req: IllustrationRequest): Promise<Illustration>;
}

export class PlaceholderIllustrator implements Illustrator {
  readonly name = 'placeholder (local, free)';

  async generate(req: IllustrationRequest): Promise<Illustration> {
    const file = `scene-${req.sceneIndex + 1}.png`;
    writeFileSync(
      join(req.workDir, file),
      renderPlaceholderScene({
        width: req.width,
        height: req.height,
        palette: req.brand.visualIdentity.palette,
        sceneIndex: req.sceneIndex,
        sceneCount: req.sceneCount,
        seed: req.seed,
        props: req.props,
      }),
    );
    return {
      file,
      provider: 'placeholder',
      costUsd: 0,
      provenance: { generator: 'src/media/placeholder-art.ts' },
    };
  }
}

/** Reuses illustrations from an earlier render (for re-voicing): copies the files, costs nothing. */
export class ExistingImagesIllustrator implements Illustrator {
  readonly name: string;

  constructor(
    private readonly sourceDir: string,
    private readonly files: readonly string[],
  ) {
    this.name = `reused images from ${sourceDir}`;
  }

  async generate(req: IllustrationRequest): Promise<Illustration> {
    const file = this.files[req.sceneIndex];
    if (!file) throw new Error(`No existing image for scene ${req.sceneIndex + 1}`);
    copyFileSync(join(this.sourceDir, file), join(req.workDir, file));
    return { file, provider: 'reused', costUsd: 0, provenance: { reusedFrom: join(this.sourceDir, file) } };
  }
}

/** Runs async tasks with a concurrency limit, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
