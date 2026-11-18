# Phase 1 – Local setup on Windows (beginner guide)

Do these steps **one at a time**. Each step says what success looks like, so check it before moving on.
Steps marked ✅ were already done for you on this laptop.

Your laptop is a **work** computer: you have no admin rights, and git and GitHub are set up for your work (Zoetis) account. This project must stay **separate** from that account, so these steps never change your global git settings.

---

## Step 1 – Create a personal GitHub account

**What:** a free GitHub account in your own name.
**Why:** the code will live in a private repository you own, separate from your work account.
**Where:** https://github.com/signup. Open it in a **private/incognito window** (`Ctrl+Shift+N` in Edge or Chrome) so your work GitHub login isn't used.
**Clicks:**

1. Enter a personal email address → **Continue**.
2. Create a password (save it in a password manager) → **Continue**.
3. Choose a username → **Continue** → solve the puzzle → **Create account**.
4. Enter the code GitHub emails you.
5. Choose the **Free** plan.
6. Recommended: **Settings → Password and authentication → Enable two-factor authentication**.
7. Recommended: **Settings → Emails** → tick **Keep my email addresses private**, then copy the `…@users.noreply.github.com` address shown there.

**Success:** you see your GitHub dashboard, and your username appears in the top-right avatar menu.

> The repo is currently configured with `user.email = unabletofindmail@gmail.com` (repo-local only). Once you have the no-reply address, update it in the project folder:
>
> ```powershell
> git config --local user.email "YOUR_ID+USERNAME@users.noreply.github.com"
> ```

---

## Step 2 – Code editor: VS Code + GitHub Copilot ✅

Already installed and in use. Copilot automatically reads this project's `AGENTS.md`, the skills in `.agents/skills/` and the hooks in `.github/hooks/`.
**Check:** **File → Open Folder** → choose this project folder.
**Success:** you see `AGENTS.md`, `src/` and `package.json` in the Explorer sidebar.

---

## Step 3 – Git ✅

Already installed (`git --version` → 2.55). The project has a **repo-local** identity:

```powershell
git config --local --list
```

**Success:** you see `user.name=Arjun` and `user.email=…`. Your global (work) settings are untouched.

## Step 4 – Node.js ✅

Already installed (`node -v` → v26). n8n uses a separate portable Node 24 inside `.tools/` (see [local-stack.md](local-stack.md)).

## Step 5 – Project folder ✅

The project currently lives at `C:\Users\beraa\Downloads\New folder`. Optional but recommended: move it somewhere permanent with no spaces, e.g. `C:\Users\beraa\Projects\quiet-growth-media`:

1. Stop everything (`Ctrl+C` in the terminals, then `npm run pg:stop`).
2. Close the editor, move the folder in File Explorer, then reopen it.
3. `npm run pg:start`, then `npm run dev`.

---

## Step 6 – Create the GitHub repository and push

> Do this **only when you decide to make the first commit.** Nothing has been committed yet.

### 6a. Log the GitHub CLI into your _personal_ account

GitHub CLI is installed for your user (`%LOCALAPPDATA%\Programs\gh\bin`). **Open a new terminal** so it's on your PATH, then:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

A one-time code is shown. Press Enter → the browser opens → **make sure you're signed in to your personal account** (use the incognito window from Step 1 if needed) → paste the code → **Authorize**.
**Success:** `✓ Logged in to github.com account <your-personal-username>`. Check with `gh auth status`.

### 6b. Make this repo (only) use the personal login for pushes

Your work credentials might be cached for github.com. These commands change **only this repository's** settings:

```powershell
git config --local credential.https://github.com.helper ""
git config --local --add credential.https://github.com.helper "!gh auth git-credential"
```

**Success:** `git config --local --get-all credential.https://github.com.helper` prints an empty line, then `!gh auth git-credential`.

### 6c. First commit (when you're ready)

```powershell
git add -A
git status
```

Check the list: `.env`, `data/`, `.tools/` and `node_modules/` must **not** appear. Then:

```powershell
git commit -m "Phase 1: scaffold nine-brand media platform core"
```

### 6d. Create the private repository and push

```powershell
gh repo create quiet-growth-media --private --source . --remote origin --push
```

**Success:** the command prints `https://github.com/<you>/quiet-growth-media`, and the page shows your files and **Private** next to the name.

---

## Step 7 – TypeScript application ✅

Scaffolded: TypeScript (strict), Fastify API, PostgreSQL migrations, nine brands, job queue, tests.

## Step 8 – Run the first local application ✅

```powershell
npm run pg:start
npm run dev
```

**Success:** http://127.0.0.1:3000 shows the **Quiet Growth Media Network** control room with 9 brands, and http://127.0.0.1:3000/health/ready shows `"status":"ready"`.

Next: [local-stack.md](local-stack.md) for n8n, and [roadmap.md](roadmap.md) for Phase 2 (VPS).
