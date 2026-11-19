import { describe, expect, it } from 'vitest';
import { BRANDS, getBrand, validateBrands } from '../../src/brands/index.js';
import type { BrandConfig } from '../../src/brands/types.js';
import { CONTENT_CATEGORIES } from '../../src/domain/constants.js';

const clone = (b: BrandConfig): BrandConfig => structuredClone(b);

describe('brand registry', () => {
  it('defines exactly nine brands with 27 daily videos', () => {
    expect(BRANDS).toHaveLength(9);
    expect(BRANDS.map((b) => b.brandNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(BRANDS.reduce((sum, b) => sum + b.dailyVideoTarget, 0)).toBe(27);
  });

  it('targets all four platforms for every brand (36 destinations)', () => {
    expect(BRANDS.flatMap((b) => b.platforms)).toHaveLength(36);
  });

  it('covers three languages x three niches groups', () => {
    const byLang = (lang: string) => BRANDS.filter((b) => b.language === lang).length;
    expect([byLang('en'), byLang('hi'), byLang('te')]).toEqual([3, 3, 3]);
  });

  it('marks only kids brands as made for kids, each with an age range and child-safety checks', () => {
    for (const b of BRANDS) {
      expect(b.madeForKids).toBe(b.niche === 'kids');
      if (b.niche === 'kids') {
        expect(b.ageRange).toEqual({ min: 2, max: 6 });
        expect(b.validation.childSafety).toBe(true);
      }
    }
  });

  it('keeps Daily Faith and Light general and Hindu devotional brands scripture-validated', () => {
    expect(getBrand('daily-faith-and-light')?.tradition).toBe('general');
    for (const id of ['bhakti-ki-shakti', 'devudu-manatho-unnadu']) {
      const b = getBrand(id)!;
      expect(b.tradition).toBe('hindu');
      expect(b.validation.scriptureCheck).toBe(true);
    }
  });

  it('uses the niche-specific daily content structure', () => {
    for (const b of BRANDS) {
      expect(b.contentSlots.map((s) => s.category)).toEqual([...CONTENT_CATEGORIES[b.niche]]);
    }
  });

  it('forbids cross-brand translation in every brand rule set', () => {
    for (const b of BRANDS) expect(b.contentRules.join(' ')).toMatch(/never translate/i);
  });

  it('gives the three self-improvement brands the final creative formula with distinct identities', () => {
    const trio = BRANDS.filter((b) => b.niche === 'self_improvement');
    expect(trio.map((b) => b.id)).toEqual(['quiet-growth', 'behtar-bano', 'ninnu-nuvvu-geluvu']);
    for (const b of trio) {
      expect(b.durationTarget, b.id).toEqual({ minSec: 19, maxSec: 27, idealMinSec: 22, idealMaxSec: 25 });
      expect(b.visualIdentity.style, b.id).toMatch(
        /Premium hand-painted anime-style illustration with a warm vintage lo-fi film look/,
      );
      expect(b.visualIdentity.lighting, b.id).toMatch(/Soft, warm natural light/);
      expect(b.visualIdentity.composition, b.id).toMatch(/Calm, cinematic framing/);
      expect(Object.keys(b.visualIdentity.moodPalettes ?? {}), b.id).toEqual([
        'contemplative',
        'intimate',
        'peaceful',
        'night',
      ]);
      // Reference-reel finish: muted warm colour, faded blacks, grain, dust and a strong vignette.
      expect(b.visualIdentity.grade, b.id).toEqual({
        saturation: 0.92,
        contrast: 1.04,
        grain: 7,
        vignette: true,
        vignetteAngle: 0.8,
        temperature: 5600,
        fade: 0.05,
        dust: true,
      });
      expect(b.visualIdentity.captionStyle, b.id).toBe('soft_handwritten');
      expect(b.visualIdentity.motion, b.id).toEqual({ strength: 0.45, transition: 0.35 });
      expect(b.visualIdentity.environments?.length, b.id).toBeGreaterThan(3);
      // Deep, calm, slightly slow narrator (same emotion for all three, a different voice each).
      expect(b.voice.settings, b.id).toEqual({ stability: 0.5, speed: 0.92 });
      expect(b.voice.direction, b.id).toMatch(/Deep, calm .*male narrator/);
      expect(b.voice.audioTags, b.id).toBe(true);
      expect(b.tone, b.id).toBeTruthy();
      expect(b.contentRules.join(' '), b.id).toMatch(/IDENTITY SIGNAL.*PERMISSION.*EMOTIONAL SWING/);
      expect(b.contentRules.join(' '), b.id).toMatch(
        /ONE clear message and follow the 4 steps: 1 THE HOOK.*4 THE CONCLUSION - don't end, loop/,
      );
      expect(b.contentRules.join(' '), b.id).toMatch(/never romanticise clinical anxiety/);
    }
    // Brand accents stay distinct even though the mood palettes are shared.
    const colours = trio.flatMap((b) => b.visualIdentity.palette.map((c) => c.toUpperCase()));
    expect(new Set(colours).size).toBe(colours.length);
    expect(getBrand('behtar-bano')!.contentRules.join(' ')).toMatch(
      /pure, modern, everyday Hindi.*No Hinglish/,
    );
    expect(getBrand('ninnu-nuvvu-geluvu')!.contentRules.join(' ')).toMatch(
      /pure, modern, everyday Telugu.*No English words.*no old literary/,
    );
    // Kids and devotional brands keep their own look and default voice settings.
    expect(getBrand('chinni-lokam')!.visualIdentity.moodPalettes).toBeUndefined();
    expect(getBrand('chinni-lokam')!.voice.audioTags).toBeUndefined();
  });

  it('rejects a duration target outside 7-45 s or in the wrong order', () => {
    const bad = clone(getBrand('quiet-growth')!);
    bad.durationTarget = { minSec: 23, maxSec: 28, idealMinSec: 18, idealMaxSec: 25 };
    expect(() => validateBrands([bad])).toThrow(/minSec <= idealMinSec/);
    bad.durationTarget = { minSec: 5, maxSec: 28, idealMinSec: 18, idealMaxSec: 25 };
    expect(() => validateBrands([bad])).toThrow(/durationTarget/);
  });

  it('rejects a kids brand without an age range', () => {
    const bad = clone(getBrand('little-wonder-world')!);
    delete bad.ageRange;
    expect(() => validateBrands([bad])).toThrow(/ageRange/);
  });

  it('rejects tying the general spirituality brand to a specific religion', () => {
    const bad = clone(getBrand('daily-faith-and-light')!);
    bad.tradition = 'hindu';
    expect(() => validateBrands([bad])).toThrow(/specific religion/);
  });

  it('rejects a content category that does not belong to the niche', () => {
    const bad = clone(getBrand('quiet-growth')!);
    bad.contentSlots = bad.contentSlots.map((s, i) => (i === 0 ? { ...s, category: 'rhyme_song' } : s));
    expect(() => validateBrands([bad])).toThrow(/not valid for niche/);
  });

  it('rejects duplicate brand ids', () => {
    const a = clone(getBrand('quiet-growth')!);
    const b = { ...clone(a), brandNumber: 50, displayName: 'Other' };
    expect(() => validateBrands([a, b])).toThrow(/duplicate id/);
  });

  it('gives every adult brand its own fixed voice, never shared between brands', () => {
    const adult = BRANDS.filter((b) => b.niche !== 'kids');
    for (const b of adult) expect(b.voice.elevenLabs?.voiceId, b.id).toBeTruthy();
    const ids = BRANDS.flatMap((b) => (b.voice.elevenLabs ? [b.voice.elevenLabs.voiceId] : []));
    expect(new Set(ids).size).toBe(ids.length);
    const a = clone(getBrand('quiet-growth')!);
    const b = {
      ...clone(getBrand('behtar-bano')!),
      voice: { ...clone(getBrand('behtar-bano')!).voice, elevenLabs: a.voice.elevenLabs },
    };
    expect(() => validateBrands([a, b])).toThrow(/duplicate voice/);
  });

  it('requires kids brands to use an original designed voice with an in-language preview', () => {
    for (const b of BRANDS.filter((x) => x.niche === 'kids')) {
      expect(b.voice.designPrompt, b.id).toMatch(/original animated cartoon character/);
      expect(b.voice.previewText!.length, b.id).toBeGreaterThanOrEqual(100);
    }
    const kids = clone(getBrand('little-wonder-world')!);
    kids.voice.elevenLabs = { voiceId: 'Nggzl2QAXh3OijoXD116', name: 'Library voice', source: 'library' };
    expect(() => validateBrands([kids])).toThrow(/designed \(original\) voice/);
  });
});
