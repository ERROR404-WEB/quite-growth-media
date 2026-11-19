# Brand voices (ElevenLabs)

**Rule: every brand has one fixed narrator voice, and no two brands share a voice.**

Each brand's voice is set in `src/brands/definitions/<brand>.ts` → `voice.elevenLabs`. The brand schema checks that:

- every brand has its own voice;
- no two brands use the same voice;
- kids brands use an original designed voice.

Everything was researched on 18 Nov 2026 from ElevenLabs' official docs and the live Voice Library API.

## What you need (in order)

| #   | Item                                                                    | Why                                                                                                                                                                                                               | Cost                                                                                                                              |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **ElevenLabs paid plan** – Starter for the pilot, Creator at full scale | Your account is on **Free** today. Free has **no commercial licence** (you can't publish), **can't use Voice Library voices through the API**, and **can't design voices through the API** (we tested: error 403) | Starter $6/mo (first month $1): 75k Eleven v4 chars ≈ 250 videos/mo. Creator $22/mo (first month $11): 275k chars ≈ 900 videos/mo |
| 2   | API key in `.env` as `ELEVENLABS_API_KEY`                               | ✅ Already done                                                                                                                                                                                                   | –                                                                                                                                 |
| 3   | Model `eleven_v4`                                                       | The only current models with **Telugu**: v4, v4 Turbo, v3. Multilingual v2 and Flash v2.5 have none                                                                                                               | $0.08 per 1,000 characters (v4 Turbo: $0.04)                                                                                      |
| 4   | One voice per brand                                                     | Consistency (below)                                                                                                                                                                                               | Library voices use no voice slot. Each designed voice uses 1 (Starter 10, Creator 30)                                             |
| 5   | Pronunciation check                                                     | Spec requirement for EN/HI/TE: listen to one test video per brand before scaling                                                                                                                                  | ~$0.02 per test video                                                                                                             |

**Volume:**

- A ~25-second video is about 250 characters of narration.
- 27 videos/day is about 200–245k characters/month, roughly **$16–20/month** of Eleven v4. That fits inside **Creator**.

**Avoid ElevenLabs "Default" voices.** They **expire on 31 Dec 2026**.

**Prefer Library voices with a 730-day notice period** (the maximum). If the owner removes the voice, you keep access for 2 years.

## Casting (one voice per brand)

| Brand                         | Casting brief                                                | Fixed voice (Voice Library)                                         | Why                                                                                                                                                                              | Backups                                                                                    |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Quiet Growth (EN)             | Deep, calm American male narrator, slow and intimate (v3)    | **Cal – Deep, Soothing and Calming** `Fxt4GZnlXkUGMtWSYIcm`         | Closest match to the owner's reference reel: deep (~92 Hz preview pitch), narrow, calm range; made for storytelling and meditation (137M chars/yr)                               | Tucker `2Dn9vl2stwtaHkhE8iIb`, Jon `MFZUKuGQUsGJPQjTS4wC` (the v2 voice)                   |
| Daily Faith and Light (EN)    | Warm, reassuring woman, non-denominational                   | **Ms. Walker – Warm, Reassuring, and Round** `DLsHlh26Ugcm6ELvS0qi` | Comforting "feels like home" voice; female, so it's clearly different from Quiet Growth                                                                                          | Rhythm `7AvtJrjTNyBhBxEvNPIZ`                                                              |
| Bhakti Ki Shakti (HI)         | Calm, reverent Hindi storyteller                             | **Taksh – Calm, Serious and Smooth** `qDuRKMlYmrm8trt5QyBn`         | Described as "ideal for divine storytelling, historical epics and philosophical reflections"                                                                                     | Shardul K – Hindu Mythology `6EphsklDopDQ6eRkwNHT`, Yatin – Sacred `zlREppBW1FE7WsYs43Sz`  |
| Behtar Bano (HI)              | Deep, calm young Hindi male, late-night intimate (v3)        | **Taksh – Deep, Calm and Late-Night** `jjObdSBxCdXSCA8AtQ8j`        | Closest Hindi match to the reference: ~99 Hz, narrow range, long pauses. A different voice from Bhakti Ki Shakti's "Taksh – Calm, Serious and Smooth" (same owner, different ID) | Shubh `y0IUmXZMBt1M9uXCVcPL`, Ashwat `xbpwjFFJpcRThvL5EyVi`, Raghav `4BoDaQ6aygOP6fpsUmJe` |
| Devudu Manatho Unnadu (TE)    | Mature, wise Telugu elder                                    | **Srirama V – Interactive, Warm Professor** `EohubqvAiTiSkWCp1vu7`  | "Mature, expressive, wise, unhurried"; verified Telugu                                                                                                                           | Bharadwaj – Telugu Mythology `RoLT1qx7XJRXxWSIG5hS`, Seeta `QKyvRuehpb8zB3cRkzIn`          |
| Ninnu Nuvvu Geluvu (TE)       | Deep, calm Telugu male, slow and immersive (v3)              | **Vagmin – Immersive Telugu Narrator** `ZoV3Y9cqdke2p8nzz7XP`       | Closest Telugu match to the reference: ~110 Hz with the longest pauses of the Telugu male voices. Not Devudu's voices (Srirama V, Bharadwaj)                                     | Jayesh M `VFbICGvBSvKmHwlI9rzA`, Sai Datta – Warm-Toned Professor `g2tKE8zoQNVS5flc4PQY`   |
| Little Wonder World (EN kids) | **Pip**, an original cartoon bunny: funny, bouncy, sing-song | **Designed voice** (after upgrading)                                | See "Kids voices" below                                                                                                                                                          | –                                                                                          |
| Nanhe Sitare (HI kids)        | **Chamku**, an original cartoon little star                  | **Designed voice**                                                  | Same                                                                                                                                                                             | –                                                                                          |
| Chinni Lokam (TE kids)        | **Chitti**, an original cartoon green parrot                 | **Designed voice**                                                  | The Library has **no Telugu kids or cartoon voices** (we searched)                                                                                                               | –                                                                                          |

All the Library picks above:

- have a **730-day notice period**;
- have **no live moderation**;
- use **standard pricing** (custom-rate voices were excluded);
- are proven, frequently used voices in their language.

**Self-improvement voices (v3, 18 Nov 2026):** the owner asked for the same voice emotion as a reference reel: a deep, calm, slow male narrator. The three voices above were shortlisted by measuring each Voice Library preview clip (median pitch, pitch range, pause share) against the reference narrator, which measures ~110 Hz with a narrow range ([reference-reel-analysis.md](creative-sources/reference-reel-analysis.md)). They use `CALM_NARRATION`: stability 0.5 and speed 0.92 (the official range is 0.7–1.2).

**This list is our shortlist, not the final choice.** Listen before you approve. Search by name in the [Voice Library](https://elevenlabs.io/app/voice-library), or run `npm run voices:search -- --search "Taksh"` to get preview links. To swap a voice, change `voice.elevenLabs` in the brand file (the backups are listed there).

### Kids voices: why designed, not taken from the Library

- **Originality and IP:**
  - Several popular Library kids voices say they are "inspired by" famous characters (e.g. Minnie Mouse, "popular kids' characters"), or carry names of existing characters.
  - Our spec forbids imitating copyrighted characters.
  - A designed voice is new and belongs to the brand mascot.
- **Consistency:** a designed voice is yours permanently. It has no notice period and can't be removed by someone else.
- **Telugu:** there is no Telugu cartoon or kids voice in the Library at all.
- **Safety:** ElevenLabs forbids using the likeness of a real child. Our prompts describe fictional cartoon animals, which is allowed. ElevenLabs' own Voice Design examples include "a cute little squeaky mouse".

The prompts and the original preview lines (in each brand's language) are in each kids brand's `voice.designPrompt` and `voice.previewText`.

## Testing on the Free plan: temporary voice, then re-voice

ElevenLabs answers **402 "Free users cannot use library voices via the API"** for the voices above. Until you upgrade, use a Default voice (allowed on Free) as a **temporary** stand-in:

```powershell
npm run video:ai -- --brand quiet-growth --voice-id nPczCjzI2devNBz1zQrb        # Brian (stands in for Cal)
npm run video:ai -- --brand behtar-bano --voice-id TX3LPaxmHKxFdv7VOQHJ         # Liam (stands in for Taksh)
npm run video:ai -- --brand ninnu-nuvvu-geluvu --voice-id TX3LPaxmHKxFdv7VOQHJ  # Liam (stands in for Vagmin)
```

These videos are labelled "temporary voice". After upgrading, swap in the brand's fixed voice. This **reuses the same script and images**, so there's no OpenAI cost and only about $0.02 of voice:

```powershell
npm run video:revoice -- --dir data\renders\ai-test\<brand>\<time>
```

## Steps after upgrading to a paid plan

1. **Design the kids voices.** This uses about 700 credits in total.

   ```powershell
   npm run voices:design -- --brand chinni-lokam
   npm run voices:design -- --brand nanhe-sitare
   npm run voices:design -- --brand little-wonder-world
   ```

   Each run saves 3 previews in `data\voice-design\<brand>\<time>\`. Listen to them and keep the best:

   ```powershell
   npm run voices:design -- --brand chinni-lokam --save <generated_voice_id>
   ```

   Then paste the printed line into that brand file's `voice.elevenLabs` (or ask me to). Not happy with any of the three? Run it again for three new ones.

2. **Check all nine brands have a voice:**

   ```powershell
   npm run voices:list
   ```

3. **Make one test video per brand** and listen for pronunciation, especially Hindi and Telugu:

   ```powershell
   npm run video:ai -- --brand devudu-manatho-unnadu --placeholder-images
   ```

   ✅ The output shows `voice: elevenlabs eleven_v4` and `captions: synced to speech timings in N/N scenes`.

## How consistency is enforced in code

- `ElevenLabsVoice` picks the voice in this order:
  1. `ELEVENLABS_VOICE_<BRAND>` in `.env` (temporary override);
  2. the brand's `voice.elevenLabs`;
  3. the `ELEVENLABS_VOICE_<LANG>` fallback.
- `validateBrands()` fails if two brands share a voice. Kids brands must use a designed voice.
- The same voice settings apply on every request for a brand: its `voice.settings` (stability, and speed when set) or the `.env` default (stability 0.5), similarity 0.75, `eleven_v4`, and `language_code`.
- Each scene also passes the neighbouring narration (`previous_text` / `next_text`), so intonation flows from scene to scene.
- Captions use ElevenLabs' character timestamps, so they appear exactly when each phrase is spoken.

## Useful commands

| Command                                                             | What it does                                                     | Cost                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `npm run voices:search -- --language te --use-case narrative_story` | Search the Voice Library                                         | free                           |
| `npm run voices:list`                                               | The voice each brand will use, plus voices saved in your account | free                           |
| `npm run voices:design -- --brand <id>`                             | 3 original voice previews for a brand                            | about 200–250 credits          |
| `npm run video:ai -- --brand <id> --voice elevenlabs`               | Full AI test video with ElevenLabs narration                     | script + images + ~$0.02 voice |
