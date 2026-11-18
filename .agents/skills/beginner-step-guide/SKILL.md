---
name: beginner-step-guide
description: Formats manual instructions for the project owner, who is a beginner with VPS, Docker, n8n and infrastructure - account creation, installs, server setup, DNS, API keys, platform connections. Use whenever the user must do something by hand outside the code.
---

# Beginner step-by-step guidance

The project owner has programming experience but is new to VPS administration, Docker, n8n and infrastructure. Manual steps must be impossible to misread.

## Format for every manual task (one step at a time)

1. **What**: one sentence describing the task.
2. **Why**: why the project needs it.
3. **Where**: the exact website or app to open (full URL).
4. **Clicks**: the exact buttons and menus, in order (`Settings → Developer settings → ...`).
5. **Command** (only if needed): one command in a code block, saying which terminal to use (PowerShell on Windows, or SSH on the VPS).
6. **Success looks like**: the exact output or screen to expect.
7. **Stop and wait** for the user to confirm before giving the next step.

## Hard rules

- Never dump many commands at once. Give at most 1–3 commands per step.
- Never assume an account, server, domain or key already exists. Ask first.
- **Never ask the user to paste passwords, API keys or tokens into chat.** Tell them to put secrets in `.env` (local) or the server's `.env` themselves, and refer to secrets by variable name only.
- Before any paid service: state the current pricing (checked on the official pricing page and dated), the free tier, the expected monthly cost at pilot scale and at full scale (27 videos/day), and get confirmation. Never buy or upgrade on the user's behalf.
- On this Windows work laptop: there are no admin rights, Docker Desktop is blocked by policy, and the network blocks TLS revocation checks (use `curl.exe --ssl-no-revoke`). Prefer user-scope installs.
- Never use the work (Zoetis) GitHub account or global git config for this project. Use the personal account and `git config --local`.
- Don't move to VPS (Phase 2) work until local development works and the user confirms.

## Example

> **Step 3 of 7 – Create a personal GitHub account**
> **What:** Create a free GitHub account for this project.
> **Why:** The code will live in a private repository under _your_ name, separate from your work account.
> **Where:** https://github.com/signup – use a private/incognito window so your work login isn't used.
> **Clicks:** Enter your personal email → Create password → Choose username → Verify → _Free_ plan.
> **Success:** You see your empty GitHub dashboard showing your new username in the top-right avatar menu.
> ✋ Reply "done" with your **username only** (not your password) and I'll give you step 4.
