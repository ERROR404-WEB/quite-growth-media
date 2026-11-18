// Placeholder illustrations for local/demo rendering. Real scenes come from the illustration
// provider chosen in Phase 5; these exist so the render + QA pipeline can be tested for free.
// Pure TypeScript rasteriser (signed-distance shapes, anti-aliased) -> PNG, no native deps.
import { encodePng } from './png.js';

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Invalid colour: ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c: Rgb) => Math.max(...c) - Math.min(...c);
const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [40, 36, 48];
const SKIN: Rgb = [232, 180, 138];

/** Deterministic PRNG so the same brand + scene always produces the same picture. */
function rng(seedText: string): () => number {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  readonly px: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = new Uint8Array(width * height * 3);
  }

  verticalGradient(top: Rgb, bottom: Rgb): void {
    for (let y = 0; y < this.height; y++) {
      const c = mix(top, bottom, y / (this.height - 1));
      for (let x = 0; x < this.width; x++) this.px.set(c.map(Math.round), (y * this.width + x) * 3);
    }
  }

  /** Paints a shape given its signed distance function (negative = inside), limited to a bounding box. */
  shape(sdf: (x: number, y: number) => number, box: readonly number[], color: Rgb, alpha = 1): void {
    const [bx0 = 0, by0 = 0, bx1 = this.width, by1 = this.height] = box;
    const x0 = Math.max(0, Math.floor(bx0) - 1);
    const y0 = Math.max(0, Math.floor(by0) - 1);
    const x1 = Math.min(this.width, Math.ceil(bx1) + 1);
    const y1 = Math.min(this.height, Math.ceil(by1) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const cover = Math.min(1, Math.max(0, 0.5 - sdf(x + 0.5, y + 0.5))) * alpha;
        if (cover <= 0) continue;
        const i = (y * this.width + x) * 3;
        for (let k = 0; k < 3; k++)
          this.px[i + k] = Math.round(this.px[i + k]! + (color[k]! - this.px[i + k]!) * cover);
      }
    }
  }

  circle(cx: number, cy: number, r: number, color: Rgb, alpha = 1): void {
    this.shape((x, y) => Math.hypot(x - cx, y - cy) - r, [cx - r, cy - r, cx + r, cy + r], color, alpha);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: Rgb, alpha = 1): void {
    const m = Math.min(rx, ry);
    this.shape(
      (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * m,
      [cx - rx, cy - ry, cx + rx, cy + ry],
      color,
      alpha,
    );
  }

  roundedRect(cx: number, cy: number, hw: number, hh: number, r: number, color: Rgb): void {
    this.shape(
      (x, y) => {
        const qx = Math.abs(x - cx) - hw + r;
        const qy = Math.abs(y - cy) - hh + r;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      },
      [cx - hw, cy - hh, cx + hw, cy + hh],
      color,
    );
  }

  /** Fills everything below the curve y = top(x). */
  hill(top: (x: number) => number, color: Rgb): void {
    let minY = this.height;
    for (let x = 0; x < this.width; x += 8) minY = Math.min(minY, top(x));
    this.shape((x, y) => top(x) - y, [0, minY, this.width, this.height], color);
  }

  /** Lower half of a ring - used for smiles. */
  smile(cx: number, cy: number, r: number, thickness: number, color: Rgb): void {
    this.shape(
      (x, y) => Math.max(Math.abs(Math.hypot(x - cx, y - cy) - r) - thickness, cy - y),
      [cx - r - thickness, cy, cx + r + thickness, cy + r + thickness],
      color,
    );
  }
}

export interface PlaceholderSceneOptions {
  width: number;
  height: number;
  /** Brand palette (#RRGGBB). */
  palette: readonly string[];
  sceneIndex: number;
  sceneCount: number;
  /** Changes the composition per brand/video while staying deterministic. */
  seed: string;
  /** Number of floating props (0–8); defaults to a per-scene variation. */
  props?: number;
}

/** Draws a simple storybook landscape with a recurring character, coloured with the brand palette. */
export function renderPlaceholderScene(opts: PlaceholderSceneOptions): Buffer {
  const { width: W, height: H, sceneIndex, sceneCount } = opts;
  const random = rng(`${opts.seed}:${sceneIndex}`);
  const layout = rng(opts.seed); // shared by all scenes -> consistent character + hills
  const colours = opts.palette.map(hexToRgb);
  if (colours.length < 3) throw new Error('palette needs at least 3 colours');
  const byLight = [...colours].sort((a, b) => luminance(b) - luminance(a));
  const accent = [...colours].sort((a, b) => chroma(b) - chroma(a))[0]!;
  const lightest = byLight[0]!;
  const mid = byLight[Math.floor(byLight.length / 2)]!;
  const darkest = byLight[byLight.length - 1]!;
  const progress = sceneCount > 1 ? sceneIndex / (sceneCount - 1) : 0.5;

  const c = new Canvas(W, H);
  c.verticalGradient(mix(lightest, WHITE, 0.35), mix(byLight[1] ?? lightest, lightest, 0.4));

  // Sun travels across the sky as the story progresses.
  const sunX = W * (0.2 + 0.6 * progress);
  const sunY = H * (0.15 + 0.05 * Math.sin(progress * Math.PI));
  c.circle(sunX, sunY, W * 0.16, mix(accent, WHITE, 0.6), 0.35);
  c.circle(sunX, sunY, W * 0.1, mix(accent, WHITE, 0.15));

  for (let i = 0; i < 3; i++) {
    const cx = W * (0.1 + random() * 0.8);
    const cy = H * (0.08 + random() * 0.25);
    const s = W * (0.06 + random() * 0.05);
    for (const [dx, dy, k] of [
      [-1.1, 0.2, 0.8],
      [0, 0, 1.1],
      [1.1, 0.25, 0.75],
    ] as const) {
      c.ellipse(cx + dx * s, cy + dy * s, s * k * 1.2, s * k, WHITE, 0.9);
    }
  }

  const hillLayers = [
    { base: 0.5, amp: 0.035, colour: mix(mid, lightest, 0.45) },
    { base: 0.6, amp: 0.03, colour: mid },
    { base: 0.72, amp: 0.025, colour: mix(darkest, mid, 0.35) },
  ];
  const freqs = hillLayers.map(() => 1.5 + layout() * 2);
  const phases = hillLayers.map(() => layout() * Math.PI * 2);
  const hillTop = (layer: number) => (x: number) =>
    H * hillLayers[layer]!.base +
    H *
      hillLayers[layer]!.amp *
      Math.sin((x / W) * Math.PI * freqs[layer]! + phases[layer]! + progress * 1.2);
  hillLayers.forEach((layer, i) => c.hill(hillTop(i), layer.colour));

  // Recurring character standing on the middle hill, kept above the lower third where captions go.
  // Body colour = the vivid palette colour that contrasts most with the hill behind it.
  const body = [...colours]
    .sort((a, b) => chroma(b) - chroma(a))
    .slice(0, 3)
    .sort((a, b) => Math.abs(luminance(b) - luminance(mid)) - Math.abs(luminance(a) - luminance(mid)))[0]!;
  const ink = W * 0.006;
  const charX = W * (0.38 + 0.24 * layout()) + W * 0.06 * Math.sin(progress * Math.PI * 2);
  const feetY = hillTop(1)(charX) + H * 0.015;
  const bodyH = H * 0.055;
  const bodyW = W * 0.07;
  const headR = W * 0.065;
  const bodyCy = feetY - bodyH;
  const headCy = bodyCy - bodyH - headR * 0.8;
  c.roundedRect(charX, bodyCy, bodyW + ink, bodyH + ink, bodyW * 0.6 + ink, INK);
  c.roundedRect(charX, bodyCy, bodyW, bodyH, bodyW * 0.6, body);
  c.circle(charX, headCy, headR + ink, INK);
  c.circle(charX, headCy, headR, SKIN);
  c.circle(charX - headR * 0.35, headCy - headR * 0.1, headR * 0.1, INK);
  c.circle(charX + headR * 0.35, headCy - headR * 0.1, headR * 0.1, INK);
  c.smile(charX, headCy + headR * 0.15, headR * 0.35, headR * 0.05, INK);

  // A few floating props (fruit/stars); the count changes per scene, handy for counting stories.
  const props = Math.max(0, Math.min(8, opts.props ?? (sceneIndex % 5) + 1));
  const propR = W * 0.04;
  const rowY = H * 0.33;
  for (let i = 0; i < props; i++) {
    const px = W / 2 + (i - (props - 1) / 2) * propR * 2.8;
    const py = rowY + Math.sin(i + progress * 3) * propR * 0.5;
    c.circle(px, py, propR + ink * 0.7, INK);
    c.circle(px, py, propR, accent);
    c.circle(px - propR * 0.3, py - propR * 0.3, propR * 0.25, WHITE, 0.6);
    c.ellipse(px + propR * 0.35, py - propR * 1.05, propR * 0.35, propR * 0.18, mid);
  }

  return encodePng(W, H, c.px);
}
