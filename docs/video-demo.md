# Testing video generation locally (free)

You can test the whole **render → QA** part of the pipeline on your laptop, at no cost and with no API keys:

```powershell
npm run video:demo
```

It makes three demo videos, each from a short original script written for that brand (never translated from another):

| Brand        | Language | Video                                      | Voice used locally                                              |
| ------------ | -------- | ------------------------------------------ | --------------------------------------------------------------- |
| Quiet Growth | English  | "The overthinking loop" (mindset)          | Windows' built-in offline voice (Microsoft David/Zira)          |
| Behtar Bano  | Hindi    | "दो मिनट का नियम" (habits)                 | none: music bed only, captions timed to a natural speaking pace |
| Chinni Lokam | Telugu   | "చిట్టి మామిడి పండ్లు లెక్కపెడుతుంది" (kids counting) | none: music bed only                                            |

✅ **Success:** each video ends with `QA: PASSED`. The files are in `data\renders\demo\<brand>\<time>\`:

- `video.mp4`: double-click to watch (1080×1920, 9:16, H.264/AAC, 30 fps)
- `thumbnail.jpg`, `captions.ass`, `scene-*.png`, `narration-*.wav`
- `manifest.json`: timeline, captions, providers and QA results

Options:

- `npm run video:demo -- --brand behtar-bano` renders one brand only.
- `--fast` encodes faster at slightly lower quality.
- `--no-voice` skips the Windows voice.

## What is real and what is a placeholder

| Step               | Today (free, local)                                                                                                                 | Production (Phase 4–5, after you approve providers and cost)                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Script             | Hand-written demo scripts                                                                                                           | OpenAI, per brand, with originality, fact, scripture and child-safety checks                                    |
| Illustrations      | **Placeholder** storybook scenes drawn in code from each brand's palette                                                            | **OpenAI `gpt-image-2.6-flare`**, already integrated: `npm run video:ai` ([ai-video-test.md](ai-video-test.md)) |
| Voice              | Windows test voice (English only) or none                                                                                           | Chosen multilingual voice provider (EN/HI/TE, pronunciation-tested)                                             |
| Captions           | ✅ Real: timed, word-wrapped, safe margins, Noto fonts for Latin/Devanagari/Telugu                                                  | Same, timed from the voice provider's word timestamps                                                           |
| Motion and editing | ✅ Real: Ken Burns zoom/pan, crossfades, soft synthesized music bed, loudness normalisation (−16 LUFS)                              | Same, plus brand-specific styles                                                                                |
| Rendering          | ✅ Real FFmpeg pipeline (`src/media/render.ts`)                                                                                     | Same code, run by the job worker on the VPS                                                                     |
| Automated QA       | ✅ Real: MP4 integrity (full decode), codec, 1080×1920, 9:16, fps, duration bucket (7–45 s), audio present, not silent, no clipping | Same, plus image, audio and subtitle checks (Phase 6)                                                           |

The "DEMO · placeholder art & voice" label at the top of each video marks it as a test render. Demo videos must not be published.

## How it works

`src/media/pipeline.ts` → `produceVideo()`:

1. **Narration** for each scene, from a `VoiceProvider`, or an estimated speaking time when none exists.
2. **Timeline:** each scene lasts as long as its narration plus 0.7 s, with 0.5 s crossfades (brands with `visualIdentity.motion` set their own, e.g. 0.35 s for the calm self-improvement look).
3. **Illustrations:** today `renderPlaceholderScene()`; later the illustration provider.
4. **Captions:** the narration is split into short chunks and written to an ASS file with a font for the right script. The style comes from `visualIdentity.captionStyle`: `bold` (Noto Sans, lower-middle) or `soft_handwritten` (Kalam/Timmana, centred, 2–4 words).
5. **FFmpeg render**, then a thumbnail.
6. **QA** with ffprobe and a full decode, then `manifest.json`.

Providers are pluggable, so Phases 4–5 add real script, image and voice providers without changing the renderer.

Tests: `tests/unit/media.test.ts` covers captions, timing, render arguments, QA rules and the PNG encoder. `tests/integration/media.test.ts` renders a real small Telugu video with narration and checks that QA passes.
