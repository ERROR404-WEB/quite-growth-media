# Reference reel analysis (18 Nov 2026)

The owner shared a screen recording of a YouTube tutorial (an "emmiescalm" CapCut walkthrough) that plays one example faceless self-improvement reel. The owner asked for "same type of content" and "same voice emotions" for **Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu**. This file records what was measured, so the creative direction ([creative-direction.md](../creative-direction.md), v3) can be checked against it.

The recording is kept locally in `data/reference/` (git-ignored). It is someone else's video: **we copy only its format and feeling**, never its lines, characters, metaphors or exact scenes. The script validator rejects any narration that reuses its lines (`REFERENCE_REEL_LINES` in `src/ai/script-writer.ts`).

## Format

| Property    | Reference reel                                                       |
| ----------- | -------------------------------------------------------------------- |
| Length      | ~27 s, 9:16, loops (the last line flows back into the first)         |
| Words       | ~65 spoken words                                                     |
| Images      | 7 still illustrations, ~3–5 s each; a reframe pair shares one image  |
| Motion      | Near-still: a very slow push-in; plain cuts or very short fades      |
| Music       | Soft, warm piano / ambient bed under the voice                       |
| Text on top | Captions only; no titles, stickers, emojis, logos or calls to action |

## Script structure

It is our Hook → Message → Metaphor → Conclusion formula, with **reframe pairs** as the message engine:

1. **Hook:** a short imperative statement that names a guilt.
2. **Message:** three or four short reframes: "it's not X, it's Y", "you didn't X, you simply Y", "some people were X, you're Y".
3. **Metaphor:** one nature image (a tree and its branches), with two short follow-up clauses.
4. **Conclusion:** "that's not X, that's Y" plus an identity close, which loops back to the hook.

Clauses are very short (2–6 words) and land one at a time. The tone is reassuring permission, not hype.

## Visuals

- **Style:** premium hand-painted anime look with a warm vintage lo-fi finish. Colour is muted and slightly faded, with amber/honey light, sepia-cream highlights, dusty teal skies and lifted blacks.
- **Finish:** heavy fine grain, floating dust specks and a strong dark vignette.
- **Subjects:** one quiet, solitary young adult per image:
  - seen from behind on a meadow path;
  - sitting by a window with books and a lamp;
  - a soft three-quarter portrait in golden window light;
  - looking over a misty valley;
  - in front of night-time city lights;
  - a lone tree shedding leaves;
  - wind-blown hair at sunset.
- **Emotion:** calm and understated, never dramatic.

## Captions

- Small white handwritten-style italic text in lowercase, with a soft dark shadow.
- **Centred in the middle of the frame.**
- 2–4 words at a time, changing with the voice, with no punctuation.
- No coloured keyword highlights.

## Voice (measured from the audio)

| Measure              | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| Pitch (F0) median    | ~110 Hz (IQR 102–138 Hz): a deep male baritone                        |
| Pitch range          | Narrow: steady and calm, no dramatic rises                            |
| Gaps between phrases | 0.2–2.0 s, mean ~0.8 s; long breathing pauses after key lines         |
| Character            | Slow, intimate, reassuring, like a wise friend speaking late at night |

Library voices were measured the same way from their public preview clips (free) to shortlist the closest matches:

| Brand              | Chosen voice (F0 median)                     | Backups                                              |
| ------------------ | -------------------------------------------- | ---------------------------------------------------- |
| Quiet Growth       | Cal – Deep, Soothing and Calming (~92 Hz)    | Tucker (~115 Hz), Jon (previous voice)               |
| Behtar Bano        | Taksh – Deep, Calm and Late-Night (~99 Hz)   | Shubh (~117 Hz), Ashwat (~115 Hz), Raghav            |
| Ninnu Nuvvu Geluvu | Vagmin – Immersive Telugu Narrator (~110 Hz) | Jayesh M (~148 Hz), Sai Datta – Warm-Toned Professor |

Telugu voices already used by Devudu Manatho Unnadu (Srirama V, Bharadwaj) were excluded, because no voice is shared between brands.

## What we changed because of it

See [creative-direction.md](../creative-direction.md) v3:

- premium warm lo-fi anime style;
- the FFmpeg finish (warmth, faded blacks, grain, dust, strong vignette);
- near-still motion;
- soft handwritten centred captions;
- calm, deep male narrators at stability 0.5 and speed 0.92;
- longer beats and pauses (0.7 s / 1.2 s);
- calm-only delivery tags;
- reframe pairs in the message.
