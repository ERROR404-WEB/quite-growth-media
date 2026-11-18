import { writeFileSync } from 'node:fs';
import type { Language } from '../domain/constants.js';
import type { FfmpegTools } from './ffmpeg.js';
import { mediaDuration, resolveFfmpeg, run } from './ffmpeg.js';

export interface NarrationClip {
  file: string;
  durationSec: number;
}

/** A text-to-speech provider. The production provider (EN/HI/TE) is chosen in Phase 5. */
export interface VoiceProvider {
  readonly name: string;
  supports(language: Language): boolean;
  synthesize(text: string, language: Language, outFile: string): Promise<NarrationClip>;
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
