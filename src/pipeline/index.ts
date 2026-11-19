import { resolve } from 'node:path';
import { BRANDS } from '../brands/index.js';
import type { AppEnv } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { JOB_TYPES } from '../domain/constants.js';
import type { JobWorker } from '../jobs/worker.js';
import type { Logger } from '../logger.js';
import { getBlotatoConfig } from '../publishing/config.js';
import type { PipelineContext, PipelineProviders, PipelineSettings } from './context.js';
import { contentPlanHandler } from './plan.js';
import { defaultProviders } from './providers.js';
import { publishHandler } from './publish.js';
import { renderHandler } from './render.js';
import { scriptHandler } from './script.js';
import { storyboardHandler } from './storyboard.js';

export type { PipelineContext, PipelineProviders, PipelineSettings } from './context.js';

export function pipelineSettings(env: AppEnv): PipelineSettings {
  return {
    dataDir: resolve(env.PIPELINE_DATA_DIR),
    timeZone: env.APP_TIMEZONE,
    dailyMaxUsd: env.DAILY_MAX_USD,
    renderMode: env.PIPELINE_RENDER_MODE,
    automationBrands: env.AUTOMATION_BRANDS,
    maxAttempts: env.JOB_MAX_ATTEMPTS,
    youtubePrivacy: getBlotatoConfig().BLOTATO_YOUTUBE_PRIVACY,
  };
}

export function createPipelineContext(
  db: Db,
  logger: Logger,
  settings: PipelineSettings,
  providers: PipelineProviders = defaultProviders(),
): PipelineContext {
  return { db, logger, settings, providers, now: () => new Date() };
}

/** Registers every production step on the worker (content.plan → … → video.publish). */
export function registerPipeline(worker: JobWorker, ctx: PipelineContext): JobWorker {
  return worker
    .register(JOB_TYPES.contentPlan, contentPlanHandler(ctx, BRANDS))
    .register(JOB_TYPES.storyboardGenerate, storyboardHandler(ctx))
    .register(JOB_TYPES.scriptGenerate, scriptHandler(ctx))
    .register(JOB_TYPES.videoRender, renderHandler(ctx))
    .register(JOB_TYPES.videoPublish, publishHandler(ctx));
}
