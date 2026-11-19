import { copyFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { Language } from '../domain/constants.js';
import type { FfmpegTools } from './ffmpeg.js';
import { mediaDuration, resolveFfmpeg, run } from './ffmpeg.js';

/** Character-level timing of the spoken text, relative to the start of the clip. */
export interface SpeechAlignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface NarrationClip {
  file: string;
  durationSec: number;
  /** When the provider returns timings, captions are synced to the actual speech. */
  alignment?: SpeechAlignment;
  /** Spend for this clip in USD (0 for local voices). */
  costUsd?: number;
  provenance?: Record<string, unknown>;
}

export interface SpeechContext {
  brandId: string;
  /** Neighbouring narration, so the provider keeps intonation continuous across scenes. */
  previousText?: string;
  nextText?: string;
  /** Short delivery direction ("soft, aching"); providers that support audio tags voice it, others ignore it. */
  direction?: string;
  signal?: AbortSignal;
}

/** A text-to-speech provider (local test voice, or ElevenLabs in production). */
export interface VoiceProvider {
  readonly name: string;
  supports(language: Language, brandId?: string): boolean;
  synthesize(
    text: string,
    language: Language,
    outFile: string,
    context?: SpeechContext,
  ): Promise<NarrationClip>;
}

/**
 * Reuses the narration of an earlier render (same script) - e.g. for a platform-specific version
 * with different music. Costs nothing; timings are kept so captions stay synced.
 */
export class ReusedNarration implements VoiceProvider {
  readonly name: string;

  constructor(
    sourceName: string,
    private readonly clips: readonly (NarrationClip | undefined)[],
  ) {
    this.name = `${sourceName} (reused narration)`;
  }

  supports(): boolean {
    return this.clips.some(Boolean);
  }

  async synthesize(_text: string, _language: Language, outFile: string): Promise<NarrationClip> {
    const index = Number(/narration-(\d+)\.[a-z0-9]+$/i.exec(outFile)?.[1]) - 1;
    const clip = this.clips[index];
    if (!clip) throw new Error(`No reusable narration for ${outFile}`);
    const file = outFile.replace(/\.[a-z0-9]+$/i, extname(clip.file));
    copyFileSync(clip.file, file);
    return { ...clip, file, costUsd: 0 };
  }
}

// Text and paths are passed through environment variables, never interpolated into the script.
const SAPI_LIST = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { [pscustomobject]@{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name } } | ConvertTo-Json -Compress
$s.Dispose()`;

const SAPI_SPEAK = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($env:QGM_VOICE)
$s.Rate = 0
$s.SetOutputToWaveFile($env:QGM_OUT)
$s.Speak([IO.File]::ReadAllText($env:QGM_TEXT, [Text.Encoding]::UTF8))
$s.Dispose()`;

interface SapiVoice {
  name: string;
  culture: string;
}

/**
 * Windows' built-in offline speech (System.Speech). Free and local - for testing timing and audio
 * mixing only. It is NOT a production voice: quality is basic and usually only English is installed.
 */
export class WindowsSapiVoice implements VoiceProvider {
  readonly name = 'windows-sapi (local test voice)';

  private constructor(
    private readonly voices: SapiVoice[],
    private readonly tools: FfmpegTools,
  ) {}

  static async detect(tools: FfmpegTools = resolveFfmpeg()): Promise<WindowsSapiVoice | null> {
    if (process.platform !== 'win32') return null;
    try {
      const { stdout } = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', SAPI_LIST],
        {
          timeoutMs: 30_000,
        },
      );
      const parsed = JSON.parse(stdout.trim() || '[]') as SapiVoice | SapiVoice[];
      const voices = Array.isArray(parsed) ? parsed : [parsed];
      return voices.length ? new WindowsSapiVoice(voices, tools) : null;
    } catch {
      return null;
    }
  }

  private voiceFor(language: Language): SapiVoice | undefined {
    return this.voices.find((v) => v.culture.toLowerCase().startsWith(`${language}-`));
  }

  supports(language: Language): boolean {
    return this.voiceFor(language) !== undefined;
  }

  async synthesize(text: string, language: Language, outFile: string): Promise<NarrationClip> {
    const voice = this.voiceFor(language);
    if (!voice) throw new Error(`No local voice installed for language "${language}"`);
    const textFile = `${outFile}.txt`;
    writeFileSync(textFile, text, 'utf8');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SAPI_SPEAK], {
      env: { QGM_VOICE: voice.name, QGM_OUT: outFile, QGM_TEXT: textFile },
      timeoutMs: 60_000,
    });
    return { file: outFile, durationSec: await mediaDuration(outFile, this.tools) };
  }
}
