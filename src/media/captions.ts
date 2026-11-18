import type { Language } from '../domain/constants.js';

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

/** Bundled font family per script (assets/fonts). */
export const CAPTION_FONTS: Record<Language, string> = {
  en: 'Noto Sans',
  hi: 'Noto Sans Devanagari',
  te: 'Noto Sans Telugu',
};

/** Max characters per caption chunk. Indic scripts are wider per character on screen. */
const MAX_CHARS: Record<Language, number> = { en: 34, hi: 30, te: 26 };

/**
 * Splits a scene's narration into short on-screen captions, timed in proportion to their length.
 * Breaks prefer sentence/clause punctuation, then whole words.
 */
export function splitIntoCues(
  text: string,
  start: number,
  duration: number,
  language: Language,
): CaptionCue[] {
  const max = MAX_CHARS[language];
  const clauses = text
    .trim()
    .split(/(?<=[.!?।,;:])\s+/u)
    .filter(Boolean);
  const chunks: string[] = [];
  for (const clause of clauses) {
    let current = '';
    for (const word of clause.split(/\s+/)) {
      if (current && (current + ' ' + word).length > max) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) chunks.push(current);
  }
  const weights = chunks.map((c) => Math.max(c.length, 6));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return chunks.map((chunk, i) => {
    const length = (duration * weights[i]!) / totalWeight;
    const cue = { start: round(t), end: round(t + length), text: chunk };
    t += length;
    return cue;
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

/** ASS timestamp: H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Removes characters that ASS would interpret as override codes or line breaks. */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '/')
    .replace(/[{}]/g, (b) => (b === '{' ? '(' : ')'))
    .replace(/\r?\n/g, ' ')
    .trim();
}

export interface AssOptions {
  width: number;
  height: number;
  language: Language;
  cues: readonly CaptionCue[];
  /** Small fixed label at the top (e.g. "DEMO"), always in the Latin font. */
  label?: string;
}

/**
 * Builds an ASS subtitle file. Captions sit in the lower-middle area, above the zone covered by
 * platform UI (likes/comments/description) on Reels, Shorts and TikTok-style players.
 */
export function buildAss(opts: AssOptions): string {
  const { width: W, height: H } = opts;
  const fontSize = Math.round(W * 0.064);
  const marginH = Math.round(W * 0.09);
  const marginBottom = Math.round(H * 0.24);
  const outline = Math.max(2, Math.round(W * 0.005));
  const labelSize = Math.round(W * 0.03);
  const styles = [
    // Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, Underline, StrikeOut,
    // ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    `Style: Caption,${CAPTION_FONTS[opts.language]},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00201820,&H96000000,-1,0,0,0,100,100,0,0,1,${outline},${Math.round(outline / 2)},2,${marginH},${marginH},${marginBottom},1`,
    `Style: Label,${CAPTION_FONTS.en},${labelSize},&H40FFFFFF,&H40FFFFFF,&H80000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,8,20,20,${Math.round(H * 0.04)},1`,
  ];
  const events = opts.cues.map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${escapeAssText(c.text)}`,
  );
  if (opts.label) {
    const end = Math.max(...opts.cues.map((c) => c.end), 1);
    events.unshift(`Dialogue: 1,${assTime(0)},${assTime(end)},Label,,0,0,0,,${escapeAssText(opts.label)}`);
  }
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
