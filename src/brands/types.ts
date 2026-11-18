import { z } from 'zod';
import { CONTENT_CATEGORIES, LANGUAGES, NICHES, PLATFORMS } from '../domain/constants.js';

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB colour');

export const contentSlotSchema = z.object({
  slot: z.number().int().min(1).max(20),
  category: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
});

export const brandConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a kebab-case slug'),
    brandNumber: z.number().int().min(1).max(99),
    displayName: z.string().min(1),
    nativeName: z.string().min(1).optional(),
    language: z.enum(LANGUAGES),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
    audience: z.string().min(1),
    niche: z.enum(NICHES),
    tradition: z.enum(['none', 'general', 'hindu']),
    ageRange: z
      .object({ min: z.number().int().min(0).max(17), max: z.number().int().min(0).max(17) })
      .optional(),
    madeForKids: z.boolean(),
    dailyVideoTarget: z.number().int().min(0).max(20),
    publishTimezone: z.string().min(1),
    platforms: z.array(z.enum(PLATFORMS)).min(1),
    contentSlots: z.array(contentSlotSchema).min(1),
    topics: z.array(z.string().min(1)).min(5),
    validation: z.object({
      factCheck: z.boolean(),
      scriptureCheck: z.boolean(),
      childSafety: z.boolean(),
    }),
    contentRules: z.array(z.string().min(1)),
    visualIdentity: z.object({
      style: z.string().min(1),
      palette: z.array(hexColour).min(3),
      typography: z.string().min(1),
      characterNotes: z.string().min(1),
      pacing: z.string().min(1),
      avoid: z.array(z.string().min(1)),
    }),
  })
  .superRefine((brand, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });

    if (brand.contentSlots.length !== brand.dailyVideoTarget) {
      issue(`needs exactly ${brand.dailyVideoTarget} content slots`, ['contentSlots']);
    }
    const slotNumbers = brand.contentSlots.map((s) => s.slot);
    if (new Set(slotNumbers).size !== slotNumbers.length)
      issue('slot numbers must be unique', ['contentSlots']);

    const allowed: readonly string[] = CONTENT_CATEGORIES[brand.niche];
    brand.contentSlots.forEach((s, i) => {
      if (!allowed.includes(s.category)) {
        issue(`category "${s.category}" is not valid for niche ${brand.niche}`, [
          'contentSlots',
          i,
          'category',
        ]);
      }
    });

    if (!brand.locale.startsWith(`${brand.language}-`)) issue('locale must match language', ['locale']);

    if (brand.niche === 'kids') {
      if (!brand.ageRange) issue('kids brands require an ageRange', ['ageRange']);
      if (!brand.madeForKids) issue('kids brands must be madeForKids', ['madeForKids']);
      if (!brand.validation.childSafety) issue('kids brands require child-safety validation', ['validation']);
    } else if (brand.madeForKids) {
      issue('only kids brands may be madeForKids', ['madeForKids']);
    }
    if (brand.ageRange && brand.ageRange.min > brand.ageRange.max) issue('ageRange.min > max', ['ageRange']);

    if (brand.niche === 'hindu_devotional') {
      if (brand.tradition !== 'hindu') issue('hindu_devotional brands use tradition "hindu"', ['tradition']);
      if (!brand.validation.scriptureCheck)
        issue('devotional brands require scripture validation', ['validation']);
    }
    if (brand.niche === 'spirituality' && brand.tradition !== 'general') {
      issue('general spirituality brands must not be tied to a specific religion', ['tradition']);
    }
  });

export type BrandConfig = z.infer<typeof brandConfigSchema>;
export type ContentSlot = z.infer<typeof contentSlotSchema>;
