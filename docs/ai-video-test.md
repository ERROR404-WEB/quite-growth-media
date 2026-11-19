# Testing AI video generation with OpenAI

This makes **one real test video**:

1. OpenAI writes the script for the chosen brand, following that brand's rules.
2. OpenAI draws the scene illustrations (`gpt-image-2.6-flare`).
3. FFmpeg renders the video locally, with captions, motion (a camera move chosen per scene) and licensed music/effects. If the [audio library](audio-library.md) has no approved track that fits, the video has no music.
4. Automated QA checks the result.

Next to `video.mp4`, the run saves `metadata.json`: the YouTube title, a short description, a caption per platform, hashtags and keywords, written fresh in the brand language.

Test videos carry an "AI TEST · not for publishing" label and are saved in `data\renders\ai-test\`. They are never published.

## Step 1 – Add your API key (you do this yourself)

**Why:** the key lets this app call OpenAI on your account. It lives only in `.env`, a file that is never committed. **Never paste the key into chat.**

1. Open https://platform.openai.com/api-keys → **Create new secret key**.
   - Name it `quiet-growth-local`.
   - Project: your project.
   - Permissions: **All** (simplest).
   - **Create secret key** → **Copy**.
2. In VS Code, open the file `.env` in the project folder. It's hidden from the agent, so open it yourself from the Explorer.
3. Add this line at the end, pasting your key after the `=` with no spaces or quotes:

   ```
   OPENAI_API_KEY=sk-...
   ```

4. Save (Ctrl+S).

**Check (shows only yes/no, never the key):**

```powershell
npm run video:ai -- --brand quiet-growth --dry-run
```

✅ The last line says `API key configured: yes`.

## Step 2 – Protect your wallet (recommended)

- https://platform.openai.com/settings/organization/limits: set a **monthly budget** and an email alert (e.g. $10 while testing).
- Our app also stops itself before any call that could push one run above **$2** (`OPENAI_MAX_USD_PER_RUN` in `.env`).
- GPT Image models can require **Organization Verification**. If the first image call fails with a message about verification, go to https://platform.openai.com/settings/organization/general → **Verify Organization**, follow the steps, then try again.

## Step 3 – Make a test video

```powershell
npm run video:ai -- --brand quiet-growth
```

It prints the script, generates 4–6 images (usually 1–3 minutes), renders and checks the video, then shows the **exact cost**, calculated from OpenAI's reported token usage.

✅ **Success:** `QA: PASSED` and a line like `cost: script $0.01 + images $0.2 = $0.21`. Open the `video.mp4` path it prints.

More examples:

```powershell
npm run video:ai -- --brand little-wonder-world --category rhyme_song --topic "colours of fruit"
npm run video:ai -- --brand behtar-bano --category habits_discipline
npm run video:ai -- --brand chinni-lokam --category learning_video --quality low   # cheaper test images
npm run video:ai -- --brand ninnu-nuvvu-geluvu --placeholder-images               # AI script only (cents)
```

**One topic for the 3 self-improvement brands** (owner rule):

1. One shared storyboard and **one image set** are made.
2. Each brand writes its own native script; nothing is translated.
3. Each brand gets its own voice, captions, music and metadata.

About $0.55 for all three videos (18 Nov 2026 run).

```powershell
npm run video:ai:shared -- --category habits_discipline --voice-ids <en-id>,<hi-id>,<te-id>
npm run video:ai:shared -- --resume data/renders/ai-test/shared/<run>   # finish brands that failed, reusing the images
```

## Cost (from OpenAI's official pricing, checked 18 Nov 2026)

| What         | Model                  | Price                                                                                                                                                           |
| ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script       | `gpt-6.2-sol`          | $2 per 1M input tokens, $10 per 1M output tokens. About **$0.005–0.02 per script**                                                                              |
| Illustration | `gpt-image-2.6-flare`  | $5 per 1M text input tokens, $30 per 1M image output tokens. Cost per image depends on size and quality, so the app measures it from the `usage` OpenAI returns |
| Voice        | ElevenLabs `eleven_v4` | $0.08 per 1,000 characters (checked 18 Nov 2026). About **$0.02 per video** (~250 characters); paid plans include a monthly allowance                           |

**Measured on 18 Nov 2026** (first real runs: 3 self-improvement videos in EN, HI and TE):

| Item                                                 | Measured cost                                       |
| ---------------------------------------------------- | --------------------------------------------------- |
| Script (`gpt-6.2-sol`)                               | $0.005–0.007                                        |
| One image (`gpt-image-2.6-flare`, medium, 1008×1792) | **$0.0331** (1,056 output tokens, about 7–9 s each) |
| Voice (ElevenLabs `eleven_v4`)                       | $0.017–0.025                                        |
| **One complete 19–30 s video (4–5 scenes)**          | **$0.16–0.20**                                      |

**At full scale** (27 videos/day ≈ 810/month), that's about **$130–160/month**, and the images are ~80% of it. Two ways to cut it:

- `--quality low` images;
- fewer scenes per video.

ElevenLabs Creator ($22/month) covers the voice.

## What is still a placeholder

- **Voice:** **ElevenLabs** (`eleven_v4`, EN/HI/TE) is integrated, with one fixed voice per brand. See [voices.md](voices.md). The account is on the **Free plan**, so the fixed Library voices are refused (402). Until you upgrade:
  - Use `--voice-id <Default voice>` for a temporary ElevenLabs voice.
  - After upgrading, run `npm run video:revoice -- --dir <run>` to swap in the fixed voice without new OpenAI cost.
  - Alternatively `--voice windows` or `--voice none`.
- **Scripture brands** (Daily Faith and Light, Bhakti Ki Shakti, Devudu Manatho Unnadu) are **refused on purpose** until the scripture-verification step exists (Phase 4). The spec says unverifiable claims must be rejected.
- **Character consistency:** the same character description goes into every scene, but OpenAI notes the model can still vary slightly between images.

## What the safeguards do

- **Script checks:**
  - Narration must be in the brand's language and script (Latin, Devanagari or Telugu).
  - Estimated length must be 7–45 s, or the brand's target (19–27 s for the self-improvement brands, [creative-direction.md](creative-direction.md)).
  - Self-improvement scripts must follow hook → message (2–4 parallel lines) → metaphor → conclusion. The hook must be a statement of ≤ 3.5 s, hook and quotability scores must be 8 or more, the quoted lines must be real narration lines, and they must avoid clichés ("never give up", "believe in yourself"…).
  - Every line carries a short voice direction (e.g. "calm, low") that ElevenLabs v4 voices as an audio tag. For the self-improvement brands, directions stay in a calm range; loud or dramatic ones are rejected.
  - Self-improvement scripts may not reuse any line of the owner's reference reel ([reference-reel-analysis.md](creative-sources/reference-reel-analysis.md)).
  - No engagement bait (like/follow/share/comment) for any brand; kids scripts may not contain any call to action.
  - No guaranteed-outcome, cure or get-rich claims.
  - Metadata: YouTube title ≤ 100 characters, X post ≤ 280 weighted characters, 3–8 valid hashtags, no hashtags inside captions, mainly in the brand language.
  - A failed check triggers one automatic regeneration.
- **Image prompts:**
  - Brand style, palette, mood and signature lighting.
  - A scroll-stopping opening frame and depth layers for camera motion.
  - No text, logos or look-alikes of existing characters.
  - Extra gentleness rules for kids brands.
  - OpenAI's standard moderation applies.
- **Audio:** only approved, licence-verified library assets. QA re-checks their rights and file checksums (`audio_rights`).
- **Records kept for every image:** provider, model, size, quality, token usage, cost and the licence note (the OpenAI Services Agreement says the customer owns all output). These go into `manifest.json` next to the video.
- **Cost records:** each run's spend is also written to the `cost_records` table when the local database is running.
