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
});
