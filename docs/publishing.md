# Publishing – Blotato + n8n (Phase 7)

This is how finished videos get to Instagram, Facebook, YouTube and X automatically, and the exact steps you (the owner) take to switch it on. Facts were checked on **18 Nov 2026** against Blotato's official docs ([pricing](https://www.blotato.com/pricing), [API](https://help.blotato.com/start-with-an-ai-agent/start), [social accounts](https://help.blotato.com/settings/social-accounts)).

## How it fits together

```
n8n (schedule only)  ──►  our API / CLI (TypeScript)  ──►  Blotato REST API  ──►  Instagram · Facebook · YouTube · X
                           │ publishing gate (QA, no test label, brand voice, licensed audio)
                           │ per-platform post (Reel / Short / title / made-for-kids / AI disclosure)
                           └ at-most-once ledger (CLI: publications.json · automation: the publications table)
```

- **n8n only triggers** ("every day at …"). All rules live in tested TypeScript (AGENTS.md rule 7), so a broken n8n node can never publish a failed video.
- **Blotato** posts to the platforms for us: one login, one API, official platform integrations. We call its REST API directly from `src/publishing/`. We don't need the Blotato n8n node.
- **Never twice:** Blotato's create-post has no idempotency key, and its docs warn that repeating it "risks a duplicate".
  - We send each post **once**.
  - Before sending, we save the intent (`publications.json` for the CLI, the `publications` row for the automation).
  - If the answer is lost, the next run says **needs-check** instead of posting again.

## What it costs (checked 18 Nov 2026)

| Item                              | Price                                | Notes                                                                                                                                 |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Blotato **Starter**               | **$29/month**                        | 20 connected accounts. Enough for the pilot (1 brand = 4 accounts) and up to 5 brands. YouTube: 10 posts/channel/day                  |
| Blotato **Creator**               | **$97/month**                        | 40 accounts. Needed for all **36** destinations (9 brands × 4). YouTube: 25 posts/channel/day                                         |
| Free trial                        | 7 days, card required                | **The trial has no API.** Generating an API key **ends the trial and starts billing immediately**, so plan to subscribe, not trial    |
| Yearly billing                    | ~17 % cheaper                        | Billing portal → Update subscription                                                                                                  |
| n8n                               | Free (self-hosted Community Edition) | Already installed locally; runs on the VPS later                                                                                      |
| Platform posting limits (Blotato) | –                                    | Instagram 50/day per account; Facebook 25/day per Page (Meta suggests ≤ 5 for reach); YouTube as above. We post 3/day per destination |
| ElevenLabs paid plan              | Starter $6/month (first month $1)    | Needed **before publishing**: Free-plan audio has no commercial licence ([voices.md](voices.md))                                      |

There are no per-post fees. Blotato credits are only for its own AI images and videos, which we don't use.

## Rules the code enforces

- **Publishing gate** (`src/publishing/gate.ts`). A render is refused unless:
  - QA passed;
  - it has **no on-screen "AI TEST" label** (render it with `--final`);
  - its voice is the **brand's own ElevenLabs voice** (not temporary, not Windows);
  - the audio is commercially licensed (paid ElevenLabs plan);
  - the images are real (not placeholders);
  - every music file is licensed for that platform;
  - metadata exists for that platform.
- **`--final`** (`video:ai`, `video:ai:shared`, `video:revoice`) drops the label. It only works with the brand's own ElevenLabs voice on a paid plan.
- **YouTube:**
  - `containsSyntheticMedia: true`, because our images and voice are AI-generated;
  - `isMadeForKids` = the brand's setting (true only for the 3 kids brands);
  - **private by default** (`BLOTATO_YOUTUBE_PRIVACY`), until you've checked the first uploads.
- **Instagram and Facebook** get Reels. Facebook needs the Page ID.
- **X** text stays within 280 weighted characters; hashtags are dropped if needed.
- **Captions and hashtags** come from each video's validated `metadata.json`, written per platform in the brand language.

## Owner steps (one at a time; each one waits for the previous)

### Step 1 – Log in to n8n (free, today)

- **What:** Create your local n8n owner login.
- **Why:** n8n is the scheduler that will run the daily pipeline.
- **Where:** http://localhost:5678. If it doesn't open, run `npm run n8n:start` in a PowerShell window in the project folder and keep it open.
- **Clicks:** **Set up owner account** → your name, email, a strong password → skip the survey. Then **Overview** → open **QGM - Daily content scheduler** → look at the nodes. **Don't activate it yet.**
- **Success:** you see the workflow with "Every day 06:00 → Config → Plan the daily videos", and **Credentials** lists **QGM Admin Token**. (After `npm run n8n:bootstrap`, there is also **QGM - Publish due videos**.)

### Step 2 – Create the pilot brand's 4 social accounts (free)

- **What:** Create Quiet Growth on YouTube, Instagram, Facebook and X, using a **personal** email (never the work account).
- **Where:**
  - **YouTube:** https://www.youtube.com → profile → **Create a channel**.
  - **Instagram:** create the account, then **Settings → Account type and tools → Switch to professional → Creator**. Blotato needs a professional account.
  - **Facebook:** **Pages → Create new Page**. You must be the Page's full Admin.
  - **X:** https://x.com/i/flow/signup.
- **Success:** you can log in to all 4. Tell me the **handles only** (never passwords).

### Step 3 – Warm the accounts up by hand (1–2 weeks, free)

Blotato warns that connecting brand-new accounts to automation is "the fastest way to get shadowbanned".

- **What:** For 1–2 weeks, use each account like a person does: log in daily, scroll, like, follow a few related accounts, and post **1 video a day by hand**. Use the AI test videos only after they have been re-rendered with `--final`, never the "AI TEST" ones.
- **Why:** New accounts that automate immediately get flagged as bots.

### Step 4 – Upgrade ElevenLabs and make a final video

- **What:** Upgrade to a paid plan (your decision), then re-voice with the brand voice, without the test label: `npm run video:revoice -- --dir <run> --final`.
- **Success:** `QA: PASSED`, no label in the video, and `npm run publish:video -- --dir <new run>` shows no "voice"/"label" problems.

### Step 5 – Subscribe to Blotato and add the API key (paid, needs your OK)

- **What:** Subscribe to **Starter ($29/month)** for the pilot.
- **Where:** https://my.blotato.com → subscribe → **Settings → API → Generate API Key**. This ends any trial and starts billing.
- **Then:** open `.env` in VS Code and set `BLOTATO_API_KEY=` to the key. Save. Never paste it into chat.
- **Success:** `npm run blotato:accounts` prints "No social accounts are connected in Blotato yet" (no error).

### Step 6 – Connect the 4 warmed-up accounts in Blotato

- **Where:** https://my.blotato.com/accounts → **Connect account** → pick the platform → sign in to the brand's account. For Facebook, tick the Quiet Growth **Page**.
- **Then:** `npm run blotato:accounts` lists them with their IDs (and the Page ID under Facebook).
- **Link each one to the brand** (IDs are not secrets):

  ```powershell
  npm run blotato:link -- --brand quiet-growth --platform youtube --account-id <id>
  ```

  Repeat for `instagram`, `x`, and `facebook` (with `--page-id <page id>`).

### Step 7 – First live post: YouTube, private

```powershell
npm run publish:video -- --dir <final run> --platforms youtube --live
```

- **Success:** `✔ youtube published: https://…`. The video is **private** on the channel. Check it in YouTube Studio (title, description, "Altered or synthetic content: Yes").
- **Then** publish the same video to Instagram, Facebook and X: `--platforms instagram,facebook,x --live`. Running a command again never double-posts.

### Step 8 – Full automation (built; switch it on after the pilot works)

The worker now makes and publishes videos from the database by itself ([architecture.md](architecture.md#daily-pipeline-srcpipeline)):

1. **06:00 (Asia/Kolkata), n8n "QGM - Daily content scheduler"** → `POST /api/schedule/daily` plans **tomorrow's** 3 slots for each brand in `AUTOMATION_BRANDS` (default: Quiet Growth, Behtar Bano, Ninnu Nuvvu Geluvu).
2. The worker writes one shared storyboard and image set per slot, then each brand's own native script, then renders and checks each video. Every video that passes QA gets one **scheduled publication per platform** at the slot time: 08:00, 13:00 and 20:00 in the brand's own time zone.
3. **Every 10 minutes, n8n "QGM - Publish due videos"** → `POST /api/publish/due` queues every due publication whose account is linked. The worker runs the publishing gate and posts each one exactly once.

Safety switches (in `.env`, or `deploy/.env` on the server):

| Setting                | Default                                       | Meaning                                                                                                                                                                             |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTOMATION_BRANDS`    | `quiet-growth,behtar-bano,ninnu-nuvvu-geluvu` | Brands that get videos (`all` = every brand; the devotional brands stay blocked until scripture checks exist)                                                                       |
| `SCHEDULE_LEAD_DAYS`   | `1`                                           | Videos are made a day ahead, so retries have time                                                                                                                                   |
| `DAILY_MAX_USD`        | `3`                                           | AI spend cap per day for all brands together; paid steps wait until tomorrow once it is reached                                                                                     |
| `PIPELINE_RENDER_MODE` | `final`                                       | `final` needs the brand voices on a **paid** ElevenLabs plan (otherwise the render job is quarantined with that reason). `test` makes labelled test videos that are never published |
| `PUBLISHING_ENABLED`   | `false`                                       | Nothing is posted until this is `true` **and** `BLOTATO_API_KEY` is set                                                                                                             |

To switch it on (each step after the previous one works):

1. Upgrade ElevenLabs (Step 4), then restart `npm run dev`.
2. In n8n, activate **QGM - Daily content scheduler**. The next morning, check the dashboard: 9 videos passed QA and 36 publications are `scheduled`.
3. After Steps 5–7 (Blotato key, accounts linked, first manual post checked), set `PUBLISHING_ENABLED=true`, restart, and activate **QGM - Publish due videos**.
4. Move to the VPS (Phase 2) so it runs 24/7 without your laptop.

If a post shows **needs_check** on the dashboard, look at https://my.blotato.com/posts. If it is **not** there, retry it with `POST /api/publications/<id>/retry` (admin token). If a post shows **failed** or **skipped**, the reason is in its last error; fix the cause, then use the same retry.

## Commands

| Command                                                                                  | What it does                                                              | Cost            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------- |
| `npm run publish:video -- --dir <run>`                                                   | **Dry run:** gate + exact payload per platform. Sends nothing             | free            |
| `npm run publish:video -- --dir <run> --live [--platforms youtube]`                      | Uploads the video once and posts to each platform, then checks the status | Blotato plan    |
| `… --privacy unlisted` · `… --schedule 2026-12-01T14:00:00Z` · `… --schedule next`       | YouTube visibility; schedule for later or Blotato's next free slot        | –               |
| `… --retry-failed`                                                                       | Resubmit platforms whose last attempt failed (after fixing the cause)     | –               |
| `npm run blotato:accounts`                                                               | Lists connected Blotato accounts and Facebook Pages                       | free (API call) |
| `npm run blotato:link -- --brand <id> --platform <p> --account-id <id> [--page-id <id>]` | Saves the destination on the brand's `social_accounts` row                | free            |

## Troubleshooting

- **`needs-check`:** a submit may have reached Blotato without a reply. Look at https://my.blotato.com/posts. If the post is **not** there, delete that platform's entry from `publications.json` in the run folder and run again.
- **`failed`:** the reason comes from Blotato (`errorMessage`). Fix it, then run again with `--retry-failed`. Logs: https://my.blotato.com/logs.
- **`in-progress` after the checks:** not a failure. Run the same command later and it checks the status again (no new post).
