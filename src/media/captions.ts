import type { Language } from '../domain/constants.js';

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
  /** "emphasis" = larger warm text for the hook and the screenshot (metaphor) line. */
  style?: 'caption' | 'emphasis';
}

/**
 * "bold" = bold sans in the lower-middle area; "soft_handwritten" = the reference-reel look: centred,
 * small handwritten text, 2-4 words at a time, soft shadow and fades (creative direction v3).
 */
export type CaptionStyleName = 'bold' | 'soft_handwritten';

/** Bundled font family per script (assets/fonts). */
export const CAPTION_FONTS: Record<Language, string> = {
  en: 'Noto Sans',
  hi: 'Noto Sans Devanagari',
  te: 'Noto Sans Telugu',
};

/** Handwritten families for the soft style: Kalam (Latin + Devanagari) and Timmana (Telugu), OFL 1.1. */
export const SOFT_CAPTION_FONTS: Record<Language, string> = { en: 'Kalam', hi: 'Kalam', te: 'Timmana' };

interface ChunkLimits {
  chars: number;
  /** Word cap per caption; groups are balanced so no line is left with a lonely word. */
  words?: number;
}

/** Max characters (and words) per caption chunk. Indic scripts are wider per character on screen. */
const LIMITS: Record<CaptionStyleName, Record<Language, ChunkLimits>> = {
  bold: { en: { chars: 34 }, hi: { chars: 30 }, te: { chars: 26 } },
  soft_handwritten: {
    en: { chars: 26, words: 4 },
    hi: { chars: 24, words: 4 },
    te: { chars: 22, words: 3 },
  },
};

/** English words a caption should not end on ("never too | much" reads worse than "never | too much"). */
const WEAK_END =
  /^(a|an|the|to|too|of|for|and|or|but|so|in|on|at|my|your|our|their|his|her|not|that|with|from|by|as|if|than|very|just)$/i;

function sizesFor(n: number, k: number, extraFirst: boolean): number[] {
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, g) => base + ((extraFirst ? g < extra : g >= k - extra) ? 1 : 0));
}

/**
 * Splits words into the fewest near-equal groups that respect the word and character caps; when the
 * groups are uneven, the larger ones go first or last, whichever avoids ending a chunk on a weak word.
 */
function balancedGroups(words: readonly string[], limits: ChunkLimits, language: Language): string[] {
  const n = words.length;
  const weak = (group: string) =>
    language === 'en' &&
    WEAK_END.test(
      group
        .split(' ')
        .at(-1)!
        .replace(/[^\p{L}']/gu, ''),
    );
  for (let k = Math.max(1, Math.ceil(n / (limits.words ?? n))); k <= n; k++) {
    const options = [true, false].map((extraFirst) => {
      let at = 0;
      return sizesFor(n, k, extraFirst).map((size) => {
        const group = words.slice(at, at + size).join(' ');
        at += size;
        return group;
      });
    });
    const fits = options.filter((groups) =>
      groups.every((g) => g.length <= limits.chars || !g.includes(' ')),
    );
    if (fits.length === 0) continue;
    const weakEnds = (groups: string[]) => groups.slice(0, -1).filter(weak).length;
    return fits.reduce((best, groups) => (weakEnds(groups) < weakEnds(best) ? groups : best));
  }
  return [...words];
}

/** Splits narration into short caption chunks: breaks prefer clause punctuation, then whole words. */
export function chunkCaptionText(
  text: string,
  language: Language,
  style: CaptionStyleName = 'bold',
): string[] {
  const limits = LIMITS[style][language];
  const max = limits.chars;
  const clauses = text
    .trim()
    .split(/(?<=[.!?।,;:…])\s+/u)
    .filter(Boolean);
  const chunks: string[] = [];
  for (const clause of clauses) {
    if (limits.words) {
      chunks.push(...balancedGroups(clause.split(/\s+/), limits, language));
      continue;
    }
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
  return chunks;
}

/**
 * On-screen form of a soft caption (reference look): English in lowercase, no trailing punctuation or
 * ellipses; question marks stay because they change the meaning.
 */
export function softCaptionText(text: string, language: Language): string {
  const plain = text
    .replace(/\.{2,}|…/g, ' ')
    .replace(/["“”]/g, '')
    .replace(/[.,;:!।]+(?=\s|$)/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return language === 'en' ? plain.toLocaleLowerCase('en-US') : plain;
}

/** Splits a scene's narration into captions, timed in proportion to their length. */
export function splitIntoCues(
  text: string,
  start: number,
  duration: number,
  language: Language,
  style: CaptionStyleName = 'bold',
): CaptionCue[] {
  const chunks = chunkCaptionText(text, language, style);
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

export interface CharacterTimings {
  characters: readonly string[];
  starts: readonly number[];
  ends: readonly number[];
}

/**
 * Times captions from the voice provider's character alignment, so each caption appears exactly
 * while it is spoken. Returns null when the alignment doesn't match the text (caller falls back).
 */
export function cuesFromAlignment(
  text: string,
  alignment: CharacterTimings,
  offset: number,
  language: Language,
  style: CaptionStyleName = 'bold',
): CaptionCue[] | null {
  const { characters, starts, ends } = alignment;
  if (characters.length === 0 || starts.length !== characters.length || ends.length !== characters.length) {
    return null;
  }
  // Map every UTF-16 position of the joined alignment string back to its character entry.
  const owner: number[] = [];
  characters.forEach((c, i) => {
    for (let k = 0; k < c.length; k++) owner.push(i);
  });
  const spoken = characters.join('');
  const source = text.trim();
  if (spoken !== source) return null;

  const cues: CaptionCue[] = [];
  let cursor = 0;
  for (const chunk of chunkCaptionText(source, language, style)) {
    const at = spoken.indexOf(chunk, cursor);
    if (at < 0) return null;
    const first = owner[at]!;
    const last = owner[at + chunk.length - 1]!;
    cues.push({ start: round(offset + starts[first]!), end: round(offset + ends[last]!), text: chunk });
    cursor = at + chunk.length;
  }
  // Keep each caption on screen until the next one starts (no flicker between words).
  for (let i = 0; i < cues.length - 1; i++) cues[i]!.end = Math.max(cues[i]!.end, cues[i + 1]!.start);
  return cues;
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
  /** Caption look (default "bold"). */
  style?: CaptionStyleName;
}

// Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, Underline, StrikeOut,
// ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
const ASS_STYLE_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

/** Bold captions: lower-middle area, above the platform UI (likes/comments/description). */
function boldStyles(W: number, H: number, language: Language): string[] {
  const fontSize = Math.round(W * 0.064);
  const marginH = Math.round(W * 0.09);
  const marginBottom = Math.round(H * 0.24);
  const outline = Math.max(2, Math.round(W * 0.005));
  return [
    `Style: Caption,${CAPTION_FONTS[language]},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00201820,&H96000000,-1,0,0,0,100,100,0,0,1,${outline},${Math.round(outline / 2)},2,${marginH},${marginH},${marginBottom},1`,
    // Warm lamp-yellow (#F0C475 → BGR 75C4F0), 20% larger: readable as a quote without sound.
    `Style: Emphasis,${CAPTION_FONTS[language]},${Math.round(fontSize * 1.2)},&H0075C4F0,&H0075C4F0,&H00201820,&H96000000,-1,0,0,0,100,100,0,0,1,${outline},${Math.round(outline / 2)},2,${marginH},${marginH},${marginBottom},1`,
  ];
}

/**
 * Soft handwritten captions (reference reel): centred in the frame (far above the platform UI), white
 * with a blurred translucent shadow instead of a hard outline; English is slanted like handwriting.
 */
function softStyles(W: number, language: Language): string[] {
  // Devanagari and especially Timmana's Telugu have a smaller visual body than Latin at the same size,
  // so they are scaled up to match the English lettering on screen.
  const scale: Record<Language, number> = { en: 0.062, hi: 0.066, te: 0.072 };
  const fontSize = Math.round(W * scale[language]);
  const marginH = Math.round(W * 0.1);
  const font = SOFT_CAPTION_FONTS[language];
  // Kalam ships a real Bold face; Timmana has one weight, so it is not synthetically emboldened.
  const bold = font === 'Kalam' ? -1 : 0;
  const italic = language === 'en' ? -1 : 0;
  const outline = Math.max(2, Math.round(W * 0.0025));
  const shadow = Math.max(1, Math.round(W * 0.002));
  const line = (name: string, size: number, colour: string) =>
    `Style: ${name},${font},${size},${colour},${colour},&H50000000,&H80000000,${bold},${italic},0,0,100,100,0,0,1,${outline},${shadow},5,${marginH},${marginH},0,1`;
  return [
    line('Caption', fontSize, '&H00FFFFFF'),
    // Warm cream (#F6E7C8 → BGR C8E7F6), 15% larger: a subtle lift for the hook and the screenshot line.
    line('Emphasis', Math.round(fontSize * 1.15), '&H00C8E7F6'),
  ];
}

/** Builds an ASS subtitle file for the chosen caption style. */
export function buildAss(opts: AssOptions): string {
  const { width: W, height: H } = opts;
  const soft = opts.style === 'soft_handwritten';
  const labelSize = Math.round(W * 0.03);
  const styles = [
    ...(soft ? softStyles(W, opts.language) : boldStyles(W, H, opts.language)),
    `Style: Label,${CAPTION_FONTS.en},${labelSize},&H40FFFFFF,&H40FFFFFF,&H80000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,8,20,20,${Math.round(H * 0.04)},1`,
  ];
  // Soft captions get a blurred shadow and a short fade in/out between chunks.
  const prefix = soft ? '{\\blur3\\fad(120,120)}' : '';
  const events = opts.cues.map(
    (c) =>
      `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${c.style === 'emphasis' ? 'Emphasis' : 'Caption'},,0,0,0,,${prefix}${escapeAssText(soft ? softCaptionText(c.text, opts.language) : c.text)}`,
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
    ASS_STYLE_FORMAT,
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
