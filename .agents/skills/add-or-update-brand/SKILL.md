---
name: add-or-update-brand
description: Adds a new brand or changes an existing brand's configuration (language, topics, content slots, visual identity, rules, age range) in the nine-brand registry. Use when editing anything under src/brands or when asked about brand settings.
---

# Add or update a brand

Brand configs are typed TypeScript objects validated by zod (`src/brands/types.ts`). There is one file per brand in `src/brands/definitions/`, and they are registered in `src/brands/index.ts`. The DB `brands` table is a projection that `npm run db:seed` upserts.

## Invariants (enforced by the schema and tests; do not weaken them)

- `id` is a kebab-case slug and **never changes** once content exists (it is the `brand_id` FK everywhere).
- `contentSlots.length === dailyVideoTarget`, and the slot categories must belong to the niche (`CONTENT_CATEGORIES` in `src/domain/constants.ts`):
  - self_improvement: mindset_growth, relationships_eq, habits_discipline
  - spirituality / hindu_devotional: stories_teachings, goodness, god_centred_motivation
  - kids: rhyme_song, illustrated_story, learning_video
- Kids brands: `madeForKids: true`, an `ageRange` (default 2-6) and `validation.childSafety: true`.
- `daily-faith-and-light` stays **general spirituality** (`tradition: 'general'`) and is never tied to a specific religion.
- Hindu devotional brands: `tradition: 'hindu'` and `validation.scriptureCheck: true`.
- Every brand's `contentRules` must include the global rules (`GLOBAL_CONTENT_RULES`), especially the rule against translating across brands.
- `visualIdentity` must be distinct per brand. Never reuse another brand's characters or palette verbatim.
  - Optional look settings: `grade` (saturation, contrast, grain, vignette, `vignetteAngle`, `temperature`, `fade`, `dust`), `captionStyle` (`bold` default, or `soft_handwritten` for the centred Kalam/Timmana reference look) and `motion` (`strength`, `transition`).
  - The 3 self-improvement brands share `VINTAGE_FILM_GRADE`, `CALM_MOTION` and `soft_handwritten` captions (creative direction v3). Keep them in sync with docs/creative-direction.md.
- `voice` gives each brand one fixed narrator: a casting `direction`, `elevenLabs` (voice ID, name, `source`), reviewed `alternatives` and optional `settings` (`stability`, `speed` 0.7–1.2).
  - No two brands may share a voice (`validateBrands` enforces this).
  - Kids brands use an original **designed** mascot voice, with `designPrompt` + `previewText` in the brand language (`npm run voices:design`).
  - Never use Library voices "inspired by" existing characters.
  - See docs/voices.md.

## Steps

1. Edit or create `src/brands/definitions/<id>.ts` (copy the closest existing brand as a template).
2. If it's new, import it and add it to `RAW_BRANDS` in `src/brands/index.ts`. Use the next `brandNumber`.
3. Update the brand-count expectations in `tests/unit/brands.test.ts` and the docs if the total changes (currently 9 brands and 27 videos/day).
4. Run `npm run test:unit`, then `npm run db:seed` to sync the DB.
5. If the brand's language is new, add it to `LANGUAGES` and to the `language` CHECK constraints (new migration; see the `add-migration` skill).

Never set `madeForKids` on non-kids brands, and never drop kids safety rules to "increase reach".
