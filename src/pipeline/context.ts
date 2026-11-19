import type { GeneratedScript, ScriptRequest, Storyboard } from '../ai/script-writer.js';
import type { StoryboardRequest } from '../ai/storyboard.js';
import type { Budget } from '../ai/pricing.js';
import type { BrandConfig } from '../brands/index.js';
import type { Db } from '../db/pool.js';
import type { RenderMode } from '../domain/constants.js';
import type { Logger } from '../logger.js';
import type { VoiceSelection } from '../media/demo/voice-select.js';
import type { FfmpegTools } from '../media/ffmpeg.js';
import type { Illustrator } from '../media/illustrator.js';
import type { ProduceVideoOptions } from '../media/pipeline.js';
import type { BlotatoClient } from '../publishing/blotato.js';

export interface PipelineSettings {
  /** Absolute directory for storyboards, images and renders. */
  dataDir: string;
  /** Time zone of the daily spend cap (APP_TIMEZONE). */
  timeZone: string;
  dailyMaxUsd: number;
  renderMode: RenderMode;
  /** Brand ids the automation runs for, or ["all"]. */
  automationBrands: readonly string[];
  maxAttempts: number;
  youtubePrivacy: 'private' | 'unlisted' | 'public';
}

/** Everything that costs money or touches the outside world; tests replace these with doubles. */
export interface PipelineProviders {
  textModel: string;
  imageConcurrency: number;
  /** Hard spend cap per job (USD). */
  caps: { storyboardUsd: number; scriptUsd: number; voiceUsd: number };
  generateStoryboard(req: StoryboardRequest, budget: Budget, signal?: AbortSignal): Promise<Storyboard>;
  generateScript(req: ScriptRequest, budget: Budget, signal?: AbortSignal): Promise<GeneratedScript>;
  illustrator(budget: Budget): Illustrator;
  selectVoice(brand: BrandConfig, budget: Budget, mode: RenderMode): Promise<VoiceSelection>;
  blotato(): BlotatoClient;
  tools: FfmpegTools;
  /** Status checks (10 s apart) per publish job run before trying again later. */
  publishStatusChecks: number;
  /** Test-only render overrides (smaller frames, faster preset). */
  renderOverrides?: Pick<ProduceVideoOptions, 'width' | 'height' | 'preset'>;
}

export interface PipelineContext {
  db: Db;
  logger: Logger;
  settings: PipelineSettings;
  providers: PipelineProviders;
  now(): Date;
}
