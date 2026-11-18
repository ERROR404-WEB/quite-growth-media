---
name: content-compliance-check
description: Checklist and rules for originality, children's content safety, Hindu devotional scripture accuracy, licensing and platform policy for generated scripts, illustrations, audio and videos. Use when writing prompts, generators, validators or QA checks, or when reviewing any generated content.
---

# Content compliance and quality gate

Production is fully automated (there is no routine human approval), so these checks **are** the safety net. A failed check means: record it in `compliance_results` → regenerate the affected component → retry within limits → quarantine → notify the operator. **Never publish failed content.**

## 1. Originality (all brands)

- Each brand researches, plans and writes independently. **No translation** of scripts, rhymes or stories between brands or languages (EN↔HI↔TE), and no minor variations of an existing script.
- Run duplicate detection against **all nine brands**: normalised text fingerprint (exact), then embedding similarity (pgvector, Phase 4) on concept, script and scene descriptions.
- A shared broad theme (e.g. "gratitude") is **not** a duplicate. Judge the angle, story, examples and execution.
- Store `similarity_score` and `duplicate_of_id` on `content_ideas`.

## 2. Children's content (Little Wonder World, Nanhe Sitare, Chinni Lokam)

- Language and concepts fit the brand's age range (default 2–6). Facts must be correct (counting, letters, colours, animals).
- Reject: frightening/violent imagery, dangerous behaviour, inappropriate characters or themes, flashing visuals, manipulative CTAs ("like and subscribe!"), any request for personal info.
- Use only original characters, and never look-alikes of famous kids' IP.
- Music must be original or properly licensed. For nursery rhymes, record the rights status of **lyrics, composition, recording and arrangement separately** in `asset_licences` (public-domain lyrics ≠ a free recording or arrangement).
- YouTube: set **made for kids = true**. Accept the feature limits (no comments or personalised ads). Never try to evade the classification. No behavioural advertising or profiling of children.

## 3. Devotional and spiritual content

- Hindu devotional (Bhakti Ki Shakti, Devudu Manatho Unnadu): every scripture claim stores book, chapter, verse and translation, and `quote_type` (direct | paraphrase | interpretation). Reject fabricated or misattributed verses. If a claim can't be verified, rewrite or drop it.
- Daily Faith and Light: **general spirituality**, not tied to any specific religion.
- All brands: no fake miracles, and no promises of health, wealth or guaranteed success.

## 4. Self-improvement

- Psychology claims must be accurate and must not be medical, therapeutic or financial advice. No shaming or get-rich-quick framing.

## 5. Assets and licensing

- Every asset records its provider, model, request id and prompt (`assets.provenance`), and a `licence_status`.
- Confirm that the provider's terms allow commercial use **before** integrating it, and record those terms in `asset_licences`.
- Never imitate copyrighted characters or specific creators' styles.

## 6. Technical QA (before any publish)

- Script: language/grammar quality, brand relevance, duration bucket (7–12 / 13–20 / 21–30 / 31–45 s chosen by content).
- Illustration: not corrupt, correct subject, consistent characters, no inappropriate content, no duplicate scenes.
- Audio: voice present, no clipping or long silence, in sync, rights recorded.
- Subtitles: timing, no overflow, readable, correct script (Latin, Devanagari or Telugu).
- Video: valid MP4 (ffprobe), 1080×1920 9:16 where practical, duration within its bucket, audio stream present.

## 7. Platforms

- Use platform-specific adapters. Verify each platform's current API limits and rules (and X automation/monetisation rules) from official docs before relying on them.
- Apply AI-content disclosure where required. Use an idempotency key per publication.
