# Licensed music & sound-effect library

Videos may only use music and sound effects whose rights were **verified by a person and recorded**. The library lives in the database (`audio_library_assets`, migration `0002`), and the audio files live in `data/audio/` (never committed to git). Creative rules: [creative-direction.md](creative-direction.md) §14.

**Until you add verified tracks, every video is narration-only.** This is safe and intended (fallback §14 H): the pipeline never substitutes an unverified track and never uses the old synthesized pad in AI videos.

## How it works

1. The script model picks a **music mood** (or `none`), an optional **ambience** (rain, city…) and at most two **one-shot effects** (soft impact, transition…).
2. `planSoundDesign()` ([audio-library.ts](../src/media/audio-library.ts)) looks for **approved** assets cleared for **all of the brand's platforms**:
   - It tries the closest mood first (e.g. `sad` → `heartbreak` → `emotional`).
   - It penalises tracks this brand used in the last 30 days, and tracks shorter than the video (which would be looped).
   - Kids brands only get `playful`, `lullaby` or `calm` music.
   - It never repeats the identical effect in one video.
3. The render ([render.ts](../src/media/render.ts)) loops beds to the video length, fades them in and out, **ducks** music and ambience under the narration (sidechain compression), places effects at scene starts (a gentle volume on the hook) and loudness-normalises the mix.
4. QA check `audio_rights`:
   - It re-checks every used asset against the rights gate.
   - It compares each file's SHA-256 with the licensed file. A swapped or edited file fails QA, and the video is not published.
   - `manifest.json` stores the licence record of every file used.

### Rights gate (enforced in code **and** by a database CHECK)

An asset can only be `approved` when **all** of these are true:

- Commercial use, monetised social-media use and modification (fades, ducking, trimming) are each explicitly `allowed`. `unknown` blocks approval.
- `contentIdStatus` is `not_registered`. A Content ID claim would block automated publishing.
- At least one platform is listed in `allowedPlatforms`. The video's platforms must all be listed.
- `licenceCheckedOn` (date) and `licenceEvidence` are recorded. Evidence is a saved licence page or, by owner decision, the official licence URL (as for Mixkit).
- If attribution is required, the attribution text is recorded. These assets are **not selected yet**, because the publisher (Phase 7) does not add credits yet.
- YouTube Audio Library assets may list **only `youtube`**.

## Licence facts (checked 18 Nov 2026 — always re-check the page for each asset)

| Library                                                                                                                    | What the official terms say                                                                                                                                                                                                                                                                                                                                                                                                                                                | How to record it                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mixkit – Stock Music Free License** ([mixkit.co/license](https://mixkit.co/license/#musicFree))                          | Free for commercial and non-commercial projects. You may download, copy, **modify**, distribute and publicly perform the music "on any web or social media platform, including internet-based video on demand services, podcasts and advertisements". **Not allowed:** CDs/DVDs, video games, TV/radio broadcast, remixing into a music-only track, claiming it as your own, or registering it on any rights-management service. If you get a claim, email team@mixkit.co. | `licenceType: mixkit_music_free`; commercial, monetised and modification `allowed`; all 4 platforms; `contentIdStatus: not_registered` only if the track page shows no Content ID notice. |
| **Mixkit – Sound Effects Free License**                                                                                    | Free for commercial use in YouTube videos, social media posts, ads, films and more. **Not allowed:** redistributing the item on its own, as stock, in a tool or template, or with source files; claiming it as your own; registering it on rights-management services.                                                                                                                                                                                                     | `licenceType: mixkit_sfx_free`; same rights; all 4 platforms.                                                                                                                             |
| **Pixabay Content License** ([pixabay.com/service/license-summary](https://pixabay.com/service/license-summary/))          | The official page blocked automated reading, so open it yourself and save it as evidence. Published summaries say: commercial use and modification are allowed without attribution; no standalone redistribution; **some music is registered with Content ID** (shown on the track page).                                                                                                                                                                                  | `licenceType: pixabay_content_license`. Use only tracks **without** a Content ID notice, and record `contentIdStatus` from the track page.                                                |
| **YouTube Audio Library** ([support.google.com/youtube/answer/3376882](https://support.google.com/youtube/answer/3376882)) | Copyright-safe **on YouTube** and monetisable in the YouTube Partner Program. Creative Commons tracks need attribution in the description. YouTube "can't give legal guidance … on issues with music that can occur off the platform".                                                                                                                                                                                                                                     | `allowedPlatforms: ["youtube"]` only. Every brand publishes to 4 platforms, so these tracks are **not selected today**.                                                                   |

Do **not** use tracks from random YouTube/Instagram/TikTok/Telegram uploads or "no copyright" sites, or tracks an AI says are free.

**Library status (18 Nov 2026):**

- **Approved:** `mixkit-driving-ambition-32`, "Driving Ambition" by Ahjay Stelino. Category `motivational`, also tagged `confidence`, `hopeful` and `cinematic`. The owner downloaded it from Mixkit; evidence is the Mixkit licence URL.
- **Approved (calm reference-reel sound, 18 Nov 2026):**
  - `mixkit-skyline-601` (reflective);
  - `mixkit-forest-mist-whispers-148` (healing);
  - `mixkit-silent-descent-614` (sad);
  - `mixkit-miss-you-592` (emotional).

  The owner downloaded them from Mixkit. Each file is byte-identical in size to `assets.mixkit.co/music/<id>/<id>.mp3`, and evidence is the Mixkit licence URL. The "Miss You" artist name (Eugenio Mininni) comes from secondary sources; confirm it on mixkit.co.

- **Approved, YouTube only, credit required:** `mx-audio-library-broken`, "Broken" by MX Audio Library. Category `sad`, also tagged `emotional`, `heartbreak` and `reflective`.
  - The creator's terms, captured 18 Nov 2026 and saved in `data/audio/evidence/mx-audio-library-broken-terms.txt`, say:
    - "Free to use this music in any of your YouTube videos";
    - full credits must be in the video description;
    - you may not claim the music as your own or sell it.
  - Instagram, Facebook and X are not granted. Content ID status is not stated; the owner accepted that claim risk.
  - Credit line: `♪ Broken (Prod. by MX Audio Library)` / `Link : https://youtu.be/BuMgXdPcwT4`.

### Platform-specific versions

When a platform-only track (like "Broken") fits a video's mood better than any cross-platform track, `video:ai` and `video:ai:shared` render **two versions**:

- The **cross-platform** version (Instagram, Facebook, X) uses only tracks cleared everywhere, or no music. It is saved in the brand folder.
- The **YouTube** version uses the YouTube-only track. It is saved in a `youtube/` subfolder, and its `metadata.json` has the credit appended to `youtubeDescription`.

The second version reuses the first one's narration and images, so it costs nothing extra. Platform-restricted music is never used in a cross-platform export. An existing video can get a YouTube version too: `npm run video:revoice -- --dir <run> --replan-audio --platforms youtube`.

Scripts and storyboards are told which music moods have approved tracks, so they pick one of those moods or `none`. They never pick a mood the library can't play.

Downloaded audio is **not committed to git**. `data/` is git-ignored, and the Mixkit/Pixabay terms forbid redistributing files on their own; a public repository would count.

## Quick start: the pre-filled emotional shortlist (18 Nov 2026)

`data/audio/catalog.json` already lists 8 emotional Mixkit tracks, all `pending_review`. Download them by hand: Mixkit's terms forbid "scripts or bots to mass download Items", and you should listen to each one anyway.

| Mixkit # | Title                    | Artist                   | Mood in catalog | Find it on                                                        | Save as                                         |
| -------- | ------------------------ | ------------------------ | --------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| 614      | Silent Descent           | Eugenio Mininni          | sad             | [Sad](https://mixkit.co/free-stock-music/mood/sad/)               | `files/mixkit-silent-descent-614.mp3`           |
| 601      | Skyline                  | Eugenio Mininni          | reflective      | [Reflective](https://mixkit.co/free-stock-music/mood/reflective/) | `files/mixkit-skyline-601.mp3`                  |
| 714      | Classical 7              | Jonny S.                 | emotional       | [Sad](https://mixkit.co/free-stock-music/mood/sad/)               | `files/mixkit-classical-7-714.mp3`              |
| 168      | Staring at the Night Sky | Alejandro Magaña (A. M.) | heartbreak      | [Sad](https://mixkit.co/free-stock-music/mood/sad/)               | `files/mixkit-staring-at-the-night-sky-168.mp3` |
| 148      | Forest Mist Whispers     | Alejandro Magaña (A. M.) | healing         | [Hopeful](https://mixkit.co/free-stock-music/mood/hopeful/)       | `files/mixkit-forest-mist-whispers-148.mp3`     |
| 322      | Life's a Movie           | Arulo                    | hopeful         | [Hopeful](https://mixkit.co/free-stock-music/mood/hopeful/)       | `files/mixkit-lifes-a-movie-322.mp3`            |
| 1081     | We'll Be Okay            | Michael Ramir C.         | healing         | [Reflective](https://mixkit.co/free-stock-music/mood/reflective/) | `files/mixkit-well-be-okay-1081.mp3`            |
| 32       | Driving Ambition         | Ahjay Stelino            | motivational    | [Piano](https://mixkit.co/free-stock-music/instrument/piano/)     | `files/mixkit-driving-ambition-32.mp3`          |

**Best fit for the reference-reel sound (creative direction v3):** the reference uses a soft, warm piano/ambient bed under a deep, calm voice. Start with **Skyline** (reflective), **Forest Mist Whispers** and **We'll Be Okay** (healing), and **Silent Descent** (sad). "Driving Ambition" and "Life's a Movie" are more energetic, so keep them for other moods. Listen first: pick tracks with no drums, no vocals and a slow tempo, so the voice stays in front.

For each track you keep:

1. Play it on the page and download it.
2. Save it into `data/audio/files/` under the name in the table (rename it if needed).
3. In `catalog.json`, set `"contentIdStatus": "not_registered"` and `"status": "approved"`.
4. Delete the entries of tracks you don't want, or leave them as `pending_review`; they are never used.

Save the licence evidence once for all of them: open https://mixkit.co/license/#musicFree → **Stock Music – Free License** → browser **Print → Save as PDF** → `data/audio/evidence/mixkit-music-free-license.pdf`. Then run `npm run audio:import` and `npm run audio:list`.

To add music to an existing sample without new script or image cost (voice only, ~$0.03):

```powershell
npm run video:revoice -- --dir data/renders/ai-test/<brand>/<run> --voice-id <voice> --replan-audio
```

## Adding tracks (owner steps)

### Step 1 of 5 – Create the library folders

**What:** Create `data/audio/files/`, `data/audio/evidence/` and a starter `data/audio/catalog.json`.
**Why:** The importer reads the catalog and the files from there.
**Where:** VS Code terminal (PowerShell) in the project folder.
**Command:**

```powershell
npm run audio:init
```

**Success:** `Created data/audio/catalog.json with one example entry.`

### Step 2 of 5 – Download one track and save its licence evidence

**What:** Download a track and keep proof of its licence.
**Why:** We must be able to show the exact licence that applied on the day we checked it.
**Where:** For example https://mixkit.co/free-stock-music/ (or https://mixkit.co/free-sound-effects/).
**Clicks:**

1. Open a track → **Download** → save it to `data/audio/files/`. Use a short name such as `mixkit-soft-piano.mp3`.
2. On the **track page**, use the browser menu → **Print** → **Save as PDF**. Save it to `data/audio/evidence/mixkit-soft-piano-track.pdf`.
3. Open the **licence page** linked from the track (e.g. https://mixkit.co/license/#musicFree) → **Print** → **Save as PDF** → `data/audio/evidence/mixkit-soft-piano-licence.pdf`.

**Success:** One audio file in `files/` and its PDFs in `evidence/`.

### Step 3 of 5 – Describe the track in `data/audio/catalog.json`

**What:** Replace the example entry with the real track's details.
**Why:** Production only uses assets whose rights are written down and approved.
**Where:** VS Code → `data/audio/catalog.json`.

| Field                                                 | What to write                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetCode`                                           | Unique, lowercase-with-dashes, e.g. `mixkit-soft-piano`                                                                                                                                                                                                                                                                                                                                                                                   |
| `kind`                                                | `music` or `sound_effect`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `title`, `creator`                                    | Exactly as shown on the track page                                                                                                                                                                                                                                                                                                                                                                                                        |
| `file`                                                | `files/<your file name>`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `category`                                            | Music: `calm`, `emotional`, `sad`, `heartbreak`, `healing`, `hopeful`, `motivational`, `cinematic`, `suspense`, `curiosity`, `confidence`, `reflective`, `ambient`, `playful`, `lullaby`, `devotional`. Effects: `whoosh`, `soft_impact`, `cinematic_hit`, `transition`, `suspense`, `footsteps`, `paper`, `clock`, `soft_texture`, `emotional_transition`. Ambience: `rain`, `wind`, `room_ambience`, `city_ambience`, `nature_ambience` |
| `moods`                                               | Optional extra mood tags, e.g. `["calm", "healing"]`                                                                                                                                                                                                                                                                                                                                                                                      |
| `source`, `sourceUrl`                                 | `mixkit` / `pixabay` / `youtube_audio_library` / `original` / `other`, plus the track page URL                                                                                                                                                                                                                                                                                                                                            |
| `licenceType`, `licenceVersion`, `licenceUrl`         | See the table above                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `commercialUse`, `monetizedSocialUse`, `modification` | `allowed` only if the licence page says so, otherwise `unknown` or `prohibited`                                                                                                                                                                                                                                                                                                                                                           |
| `allowedPlatforms`                                    | e.g. `["instagram", "facebook", "youtube", "x"]`                                                                                                                                                                                                                                                                                                                                                                                          |
| `attributionRequired`, `attributionText`              | `false`, or `true` plus the exact credit line                                                                                                                                                                                                                                                                                                                                                                                             |
| `prohibitedUses`                                      | Short summary of the "not allowed" list                                                                                                                                                                                                                                                                                                                                                                                                   |
| `contentIdStatus`                                     | `not_registered` only if the track page shows no Content ID notice; otherwise `registered` / `unknown`                                                                                                                                                                                                                                                                                                                                    |
| `licenceCheckedOn`                                    | Today's date, `YYYY-MM-DD`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `licenceEvidence`                                     | `evidence/<licence pdf>`, or the official licence URL                                                                                                                                                                                                                                                                                                                                                                                     |
| `status`                                              | `approved` when everything above is verified; otherwise `pending_review`                                                                                                                                                                                                                                                                                                                                                                  |

**Success:** The file saves without red JSON errors in VS Code.

### Step 4 of 5 – Import the catalog

**What:** Check the entries, measure each file and save them in the database.
**Why:** The importer refuses to approve anything with missing or unverified rights.
**Where:** VS Code terminal (Postgres must be running: `npm run pg:start`).
**Command:**

```powershell
npm run audio:import
```

**Success:** `✔ mixkit-soft-piano: added (music/reflective, approved)` and `1 imported, 0 with problems.` A `✖` line lists exactly what is missing; fix it and run the command again.

### Step 5 of 5 – Confirm what production may use

**Command:**

```powershell
npm run audio:list
```

**Success:** `✔ mixkit-soft-piano   music/reflective   usable on all 4 platforms`. The next `npm run video:ai` prints `music: mixkit-soft-piano (reflective)…` instead of the narration-only fallback.

## Maintenance

- Re-check licences periodically. If terms change or a claim arrives, set `status` to `retired` (or `rejected`) in the catalog and run `npm run audio:import` again. Re-voiced videos re-check rights and drop retired assets automatically.
- A used asset cannot be deleted (usage history is kept); retire it instead.
- Usage per brand is stored in `audio_library_usages` (`recordAudioUsage`, written by the production job once publishing exists) and drives rotation.
- VPS: copy `data/audio/` to the server's media volume and import it there. This is done as part of the Phase 2/5 deployment (see the `vps-operations` skill).
