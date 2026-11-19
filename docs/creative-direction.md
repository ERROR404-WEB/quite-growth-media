# Creative direction – final video formula (v3, 18 Nov 2026)

These are the final instructions for **Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu**. They merge the owner's two briefs and one reference reel, all kept in [creative-sources/](creative-sources):

- the master prompt (v1);
- the viral framework (v2), which wins over v1 where the two conflict;
- the **reference reel** ([reference-reel-analysis.md](creative-sources/reference-reel-analysis.md)), which sets the **look, captions, pacing and voice** (v3). It wins over v1 and v2 on those points.

The pipeline applies all of this automatically (`npm run video:ai`). [AGENTS.md](../AGENTS.md) still applies on top: originality per brand, no translation across brands, safety, secrets and costs.

**Why v2:** the first samples were calm and descriptive, and nothing in them moved you. v2 makes every video an **emotional swing** (pain → relief/pride), delivered as **quotable lines**.

**Why v3:** the owner shared a reference reel and asked for the same type of content and the same voice emotion. v3 keeps v2's idea and script formula and changes how it feels:

- **Voice:** a **deep, calm, slow male narrator** with long breathing pauses.
- **Images:** **premium warm lo-fi anime**, near-still.
- **Captions:** small **handwritten captions in the centre**, 2–4 words at a time.
- **Originality:** we copy the format and feeling only. The reference's own lines are rejected by the validator.

---

## 1. Topic & idea – every idea must activate all three triggers

> **One topic, three native scripts (owner rule, 18 Nov 2026).** Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu can share one topic and **one image set** (`npm run video:ai:shared`).
>
> 1. A storyboard plans the idea, the beats, each line's _meaning_ ("intent", never wording) and the images.
> 2. The images are generated once, with universal characters (warm brown skin, dark hair) and places with no country-specific signs.
> 3. Each brand then writes its own narration from scratch, in its own language and idiom. Scripts are **never translated**, and a writer never sees another language's lines.
> 4. Voice, captions, music and metadata are per brand.
>
> Images are about 80 % of the cost, so this cuts it roughly 3×.

| Trigger             | The viewer feels…                                                     | Example                                                                                                            |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Identity signal** | "Sharing this says I'm deep, ambitious or emotionally intelligent."   | "I choose hard truths over comfortable lies."                                                                      |
| **Permission**      | "The thing I feel guilty about is secretly wise, brave or strategic." | Quitting → self-awareness · alone → selective · overthinking → depth · slowing down → strategy · no → self-respect |
| **Emotional swing** | Tension or pain at the start → relief, pride or quiet confidence      | The bigger the _honest_ swing, the more shareable                                                                  |

**Topic categories** (mapped onto the 3 daily slots):

| Slot                  | Categories                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `mindset_growth`    | Mental-health reframes, personal evolution (outgrowing people, identity shifts), contrarian wisdom (popular advice that's wrong)        |
| 2 `relationships_eq`  | Relationships & boundaries (letting go, choosing yourself, toxic patterns), social dynamics (the power of silence, being misunderstood) |
| 3 `habits_discipline` | Ambition & redefining success (strategic rest, unconventional paths, discipline without burnout)                                        |

Each brand has its own localised topic list in `src/brands/definitions/*.ts`.

**Reject** an idea if:

- it is a cliché;
- it needs context;
- the reframe is forced or dishonest;
- it reads as toxic positivity;
- someone would be embarrassed to share it.

**Required:**

- it passes the _screenshot test_ (the key line works alone as an image);
- it creates an "I needed to hear this" reaction.

**Guardrails (ours, on top of the framework):**

- Never romanticise clinical anxiety, depression or self-harm, and never discourage professional help.
- Don't glorify cutting everyone off.
- No rage-bait. The framework's "comment war" bonus is deliberately not used.

## 2. Script – Hook → Message → Metaphor → Conclusion (19–27 s, sweet spot 22–25 s)

**Every video must hold one clear message and follow these 4 steps** (owner's reference slide):

1. **The hook.** The first 3 seconds must stop the scroll instantly. Think of it like a Netflix thumbnail: bold, intriguing and impossible to ignore.
2. **The message.** Once you've stopped them, keep them. This is where you deliver the core value: the reason they came, the insight they needed.
3. **The metaphor.** Make the concept sticky and visual. This "Aha!" moment triggers screenshots, saves and rewatches, and makes the idea unforgettable.
4. **The conclusion.** Don't end, loop. The conclusion creates a cycle that pulls viewers back to the beginning, keeping the video alive.

| Part           | Length                   | Job                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hook**       | 1 line, 3–9 words, ≤ 3 s | Stops the scroll **as on-screen text without audio**. A statement, never a question: a pattern interrupt, provocative claim, direct address or counter-narrative. → _[BEAT]_                                                                                                                                                                                       |
| **Message**    | 2–4 lines, 20–45 words   | One **parallel structure** (A "It's not about X. It's about Y." · B contrasting pairs · C escalating list · D "You don't need X. You need Y."). A line may be a short **reframe pair** ("It's not X. It's Y.") that shares one image; this is the reference reel's signature rhythm. Each line quotable and stronger than the last. → _[BEAT]_ after the last line |
| **Metaphor**   | 1 line, 8–15 words       | A fresh **visual** image (nature, an object, a journey, a transformation): the screenshot / bio line. → _[PAUSE]_                                                                                                                                                                                                                                                  |
| **Conclusion** | 1 line, 5–12 words       | The mic drop (call to identity, empowerment close, permission stamp or challenge close). It resolves the hook **and loops back to it**, so the video replays seamlessly                                                                                                                                                                                            |

- **One line = one scene = one image**, usually 6–7 lines per video. [BEAT] = 0.7 s and [PAUSE] = 1.2 s of silence, inserted automatically (the reference leaves 0.5–2 s between lines).
- **Rhythm (reference):** short, simple clauses of 2–6 words that land one at a time. The tone is a calm, wise friend speaking softly late at night: gentle permission, never preachy or hype.
- **Originality:** never reuse the reference reel's lines, metaphors or exact framing, or any other creator's. The validator rejects its known lines.
- The model also returns the idea card:
  - core message, identity signal, permission, emotional arc (start → mid → peak → landing), audience and share trigger;
  - the parallel pattern and the **3 quotes** (strongest, screenshot, share), checked against the narration;
  - the loop link;
  - **hook and quotability scores, which must each be 8/10 or more**.
- **Language (owner rule):**
  - **Hindi:** pure, modern, everyday Hindi in Devanagari that every Hindi speaker understands. No Hinglish or English words (आराम, काम, ज़्यादा सोचना – not रिलैक्स, ऑफिस, ओवरथिंकिंग), and no heavy Sanskritised words.
  - **Telugu:** pure, modern, everyday Telugu that every Telugu speaker understands. No English-mixed words (ఒత్తిడి, పని, అలసట – not టెన్షన్, ఆఫీస్), and no old literary (గ్రాంథిక) Telugu.
  - Narration must be at least 97 % native script, and Hindi/Telugu keep the same _timing_ per part.

## 3. Voice – deep, calm and slow (reference reel)

- **Narrator:** a **deep, calm male voice for all three brands**, with a different voice per brand and the same emotion. The reference narrator measures ~110 Hz median pitch with a narrow range: steady, intimate and reassuring, never dramatic.
  - **Quiet Growth:** Cal.
  - **Behtar Bano:** Taksh.
  - **Ninnu Nuvvu Geluvu:** Vagmin.
  - These were picked by measuring the public preview clips against the reference; see [voices.md](voices.md) and [reference-reel-analysis.md](creative-sources/reference-reel-analysis.md).
- **Per-line delivery tag:** the script gives each line a short English direction in a **calm range only** ("calm, low", "soft, reassuring", "slow, gentle", "almost a whisper", "quiet, certain", "warm, steady").
  - It is sent to ElevenLabs **Eleven v4** as an inline audio tag, e.g. `[calm, low]`. Official docs (checked 18 Nov 2026) confirm that v4 supports audio tags, and that ellipses add pauses and weight.
  - Loud or dramatic directions (excited, shouting, dramatic, crying, …) are rejected by the validator.
  - The tag is removed from the timing data, so captions stay synced.
- **Voice settings (`CALM_NARRATION`):**
  - **Stability 0.5:** steadier than v2's 0.35. The official API reference says lower stability = broader emotional range and higher = more stable.
  - **Speed 0.92:** slightly slower. The official help centre gives a 0.7–1.2 range for all voices and models.
  - The duration estimate allows for the slower pace.
- Ellipses (…) mark where a breath belongs. No ALL-CAPS: captions would shout.
- The fixed brand voices need the paid ElevenLabs plan. Test runs use temporary Default voices.

## 4. Visual style – premium warm lo-fi anime (v3, 18 Nov 2026)

v2 chose "vivid cinematic anime" because the first muted samples, mostly "a woman sitting indoors", did not stop the scroll. The owner's reference reel shows that the muted look **does** work when it is premium: it needs better art, a real film finish, quiet but striking compositions and the right captions and voice. The owner asked for "premium and professional", so v3 is:

- **Style:** premium hand-painted anime-style illustration with a warm vintage lo-fi film look.
  - Soft painterly brushwork with fine, clean detail and delicate line art, and gentle realistic proportions.
  - Calm, understated faces with emotion readable in the eyes.
  - Never glossy, 3D, neon or over-saturated.
- **Colour:** muted, warm and slightly faded: amber and honey sunlight, sepia-cream highlights, dusty teal and slate-blue skies, softly lifted blacks. FFmpeg adds the same finish to every video (`visualIdentity.grade`):
  - −8 % saturation, +4 % contrast;
  - warm colour temperature (5600 K) and lifted blacks (fade 0.05);
  - visible fine grain;
  - **procedural dust specks** (generated in FFmpeg, so no licence is needed);
  - a **strong vignette**.
- **Lighting:** soft, warm natural light: low golden sun, late-afternoon window light, lamp glow, distant amber city lights, gentle rim light and hazy air. Shadows are warm-brown or muted teal, never pure black.
- **Composition:**
  - One solitary subject (or one symbolic object), often seen from behind or in three-quarter profile, or a soft close portrait in window light.
  - Generous sky and negative space.
  - Only gentle motion: wind in hair, drifting leaves, slow clouds, soft rain.
  - **The band across the vertical centre stays calm**, because the caption sits there. Faces go above it or to one side.
  - **No text in images.**
- **Motion:** near-still. Ken Burns moves run at 45 % strength (`visualIdentity.motion`): mostly very slow push-ins, with an occasional gentle pan. Crossfades last 0.35 s.
- **Hook image = the thumbnail.** It is rendered at **high** quality (`OPENAI_IMAGE_HOOK_QUALITY`); the other images use medium. It must stop the scroll **quietly**: a lone figure small against a huge soft sky, a tender close portrait in warm window light, or a simple poetic metaphor. Calm, premium and beautiful rather than loud. A window scene may open the video.
- **Per line, the script chooses:**
  - a **shot**: `vast_landscape` (a tiny figure, often from behind, under a huge sky), `close_up_portrait`, `two_people`, `symbolic_object` (e.g. a lone tree shedding leaves), `night_urban` or `indoor_reflection` (by a big window with books and a lamp);
  - a **mood palette** (muted hex lists in [shared.ts](../src/brands/shared.ts)): contemplative = faded blue hour, intimate = warm golden hour, peaceful = soft dawn, night = amber-lit night;
  - a camera move.
- **Visual rules checked in code:**
  - at least 3 shot types, never the same shot twice in a row, and at most 2 close-ups;
  - at least one wide shot (`vast_landscape` or `night_urban`).
- **Image descriptions** follow a director's recipe: framing → understated expression or gesture → setting and time of day → soft light and the amber/teal contrast → one gentle motion → symbolic detail. Each video uses at least 3 settings or times of day.
- **Brand distinction** comes from:
  - each brand's settings: US hills, coasts and rooftops / Indian terraces, monsoon streets and village trees / Deccan hills, paddy fields and Hyderabad-inspired lights;
  - its characters and skin tones;
  - its muted accent colours.

## 5. Captions – soft handwritten, centred (reference reel)

- Caption style **`soft_handwritten`** (`visualIdentity.captionStyle`):
  - small white text **centred in the frame**, far above the platform UI;
  - a blurred translucent shadow instead of a hard outline;
  - a soft 120 ms fade in and out.
- **Fonts** (bundled, OFL 1.1, [assets/fonts](../assets/fonts/README.md)):
  - **Kalam Bold** for English (slanted like handwriting) and Hindi;
  - **Timmana** for Telugu, chosen from 14 Telugu Google Fonts after test renders as the most legible at caption size with a handwritten feel.
- **2–4 words at a time** (2–3 for Telugu), split into balanced chunks so no word is left alone. In English, a chunk never ends on a small word like "too" or "to".
- English is shown in **lowercase**. Trailing punctuation, quotes and ellipses are dropped on screen; question marks stay.
- The **hook** and the **metaphor** get a subtle lift: the same font, 15 % larger, in warm cream (`Emphasis`). They still work without sound and invite screenshots.
- Other brands (devotional, kids) keep the `bold` style: Noto Sans in the lower-middle area, above the bottom 24 %.

## 6. Sound

- Music mood follows the arc (soft piano for pain → hope). Licensed tracks come only from the verified [audio library](audio-library.md), ducked under the voice.
- **The reference reel uses a soft, warm piano/ambient bed.** From the Mixkit shortlist, the closest fit is "Skyline" (reflective), "Forest Mist Whispers" and "We'll Be Okay" (healing), and "Silent Descent" (sad). Prefer these moods over cinematic or motivational ones.
- **Add 3–5 verified emotional piano/ambient tracks.** Music is the single biggest emotional lift still missing: with an empty library, videos are voice-only.
- At most 2 sound effects per video; none is often best.

## 7. Metadata & QA

- Metadata is written fresh per video in the brand language: YouTube title ≤ 100 characters, captions per platform (leading with the screenshot line), X ≤ 280 weighted characters, 3–8 hashtags, keywords. No engagement bait.
- Automatic gates before rendering (failure → regenerate once):
  - language;
  - 19–27 s estimate (including pauses);
  - beat order and counts;
  - a statement hook of ≤ 3.5 s;
  - scores ≥ 8;
  - quotes really in the narration;
  - shot variety;
  - delivery tags, calm only (no loud or dramatic directions);
  - no line reused from the reference reel;
  - clichés and engagement bait;
  - metadata limits.
- After rendering, technical QA runs (MP4, 9:16, duration, audio, rights), plus a brand duration-target warning.

---

## Copy-paste prompt (for manual use in ChatGPT)

The app builds this prompt automatically from the brand config; see it with `npm run video:ai -- --brand quiet-growth --dry-run`. To brainstorm by hand:

```text
You are a world-class viral short-form scriptwriter for the self-improvement brand [BRAND] ([LANGUAGE], audience: [AUDIENCE]).

STEP 1 – IDEA. Silently consider several ideas and keep one that scores 9/10+. It must activate:
1) IDENTITY SIGNAL – sharing it says "I'm deep / ambitious / emotionally intelligent";
2) PERMISSION – "[thing the viewer feels guilty about] is actually [honest positive reframe]";
3) EMOTIONAL SWING – tension or pain → relief, pride or quiet confidence.
Topic area: [relationships & boundaries | ambition & redefining success | mental-health reframes | social dynamics | personal evolution | contrarian wisdom].
Reject clichés, ideas that need context, forced or dishonest reframes, toxic positivity, anything embarrassing to share.
Never romanticise clinical anxiety or depression or discourage professional help. No rage-bait.

STEP 2 – SCRIPT (19–27 s, sweet spot 22–25 s; one line = one image). The video holds ONE clear message and follows 4 steps:
HOOK (1 line, 3–9 words, a statement; the first 3 seconds stop the scroll like a Netflix thumbnail – bold, intriguing, impossible to ignore; works as silent text) [BEAT]
MESSAGE (2–4 lines, 20–45 words – keep them: deliver the core value, the insight they needed; ONE parallel structure: "It's not about X. It's about Y." / contrasting pairs / escalating list / "You don't need X. You need Y."; a line may be a short reframe pair "It's not X. It's Y."; every line quotable and stronger than the last) [BEAT]
METAPHOR (1 line, 8–15 words – the sticky, visual "Aha!" that triggers screenshots, saves and rewatches) [PAUSE]
CONCLUSION (1 line, 5–12 words – don't end, loop: the mic drop that resolves the hook and pulls viewers back to the beginning)
Short, simple clauses of 2–6 words that land one at a time, like a calm, wise friend speaking softly late at night. Never reuse lines from reference videos or other creators.
Hindi: pure, modern, everyday Hindi in Devanagari (no Hinglish/English words, no heavy Sanskrit). Telugu: pure, modern, everyday Telugu (no English words, no old literary Telugu).
The narrator is a deep, calm, slow male voice. For each line add a calm voice direction in brackets, e.g. [calm, low], [soft, reassuring], [quiet, certain], [warm, steady] – never dramatic or loud. Use ellipses for weight. No questions in the hook, no CAPS, no calls to like/follow/share.

Then give: core message, identity signal, permission, emotional arc (start → mid → peak → landing), strongest quote, screenshot line, share line, hook score and quotability score (both must be 8+).

STEP 3 – IMAGES (one per line, 1080×1920, no text): premium hand-painted anime-style illustration with a warm vintage lo-fi film look – soft painterly brushwork with fine detail, gentle realistic proportions, calm understated faces; muted, warm, slightly faded colour (amber and honey sunlight, sepia-cream highlights, dusty teal skies, softly lifted blacks); soft natural light (low golden sun, window light, lamp glow, distant city lights), hazy air; one solitary subject, often seen from behind or in three-quarter profile, with generous sky; only gentle motion (wind in hair, drifting leaves, slow clouds, soft rain); keep the middle band of the frame calm for a centred caption; never glossy, 3D, neon or over-saturated. The first image is the thumbnail: quiet but striking – a lone figure small against a huge soft sky, a tender close portrait in warm window light, or a simple poetic metaphor. For each line choose a shot (vast landscape / close-up portrait / two people / symbolic object / night urban / indoor reflection – never the same twice in a row, at least one wide shot) and a mood palette (faded blue hour / warm golden hour / soft dawn / amber-lit night) that follows the emotional arc. Interpret each line through visual metaphor, not literally.
```
