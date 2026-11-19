# Phase 2 – Server (VPS) setup, step by step

Do these steps **one at a time** and check the "Success" line before moving on.
The scripts referenced here live in [`deploy/`](../deploy) and have been checked locally:
compose config, Caddy config, shellcheck, and a test run of the production build.
They haven't run on a real server yet.

What you'll end up with:

```
Internet ──HTTPS──▶ Caddy (auto Let's Encrypt certificates)
                     ├── https://APP_DOMAIN  → dashboard + API (password protected)
                     └── https://N8N_DOMAIN  → n8n editor (n8n login)
                    private Docker network: API + job worker · n8n · PostgreSQL (not reachable from the internet)
```

---

## Step 1 – Choose a VPS provider (you decide; nothing is bought yet)

Prices were checked on the providers' official pricing pages on **18 Nov 2026**. They exclude VAT/taxes and change often, so re-check before buying.

| Provider / plan                                   | vCPU            | RAM   | Disk        | Traffic   | Price                                                                    | Billing                                |
| ------------------------------------------------- | --------------- | ----- | ----------- | --------- | ------------------------------------------------------------------------ | -------------------------------------- |
| **Hetzner Cloud CPX22** (Regular Performance, EU) | 2 (AMD, shared) | 4 GB  | 80 GB NVMe  | 20 TB     | **€16.99/mo** (up to €19.99 by EU location; €26.99 in Singapore)         | Hourly, capped monthly, cancel anytime |
| Hetzner Cloud CPX32 (EU)                          | 4 (shared)      | 8 GB  | 160 GB NVMe | 20 TB     | €30.49/mo (up to €35.99; €49.49 Singapore)                               | Hourly                                 |
| DigitalOcean Basic Droplet                        | 2 (shared)      | 4 GiB | 80 GiB SSD  | 4,000 GiB | $24/mo                                                                   | Per second                             |
| DigitalOcean Basic Droplet                        | 4 (shared)      | 8 GiB | 160 GiB SSD | 5,000 GiB | $48/mo                                                                   | Per second                             |
| **Hostinger KVM 2** (India site, sale price)      | 2               | 8 GB  | 100 GB NVMe | 8 TB      | **₹779/mo**, but ₹18,696 paid upfront for 24 months; renews at ₹1,199/mo | Prepaid; 30-day money-back             |
| Hostinger KVM 4 (sale price)                      | 4               | 16 GB | 200 GB NVMe | 16 TB     | ₹1,099/mo (₹26,376 upfront for 24 months); renews at ₹2,399/mo           | Prepaid                                |

Sources: hetzner.com/cloud/regular-performance · digitalocean.com/pricing/droplets · hostinger.com/in/vps-hosting

**What size do we need?**

- **Now (Phases 2–4):** API, n8n and Postgres, with no video rendering. 2 vCPU / 4 GB is enough.
- **From Phase 5 (rendering 27 short videos/day):** 4 vCPU / 8 GB recommended. Hetzner and DigitalOcean let you resize later with a few clicks.

**Recommendation:** **Hetzner CPX22 in an EU location (Nuremberg, Falkenstein or Helsinki)**.

- It's cheap, billed by the hour with no lock-in, and has generous traffic.
- You can upgrade to CPX32 in Phase 5.
- Latency from India to Europe doesn't matter for an automated pipeline.
- If you'd rather pay in rupees and are happy to commit for two years, **Hostinger KVM 2** is cheaper per month and has more RAM, but you pay 24 months upfront.

Note that Hetzner sometimes asks new customers for ID verification. Some server types are temporarily "unavailable" in a location; if so, pick another EU location.

**Expected Phase 2 cost:**

- Server: about €17/month (Hetzner CPX22), or ₹18,696 upfront (Hostinger, 2 years).
- Domain: optional. You can start with the free `sslip.io` addresses.
- Everything else is free: n8n Community Edition, Caddy, Let's Encrypt, PostgreSQL.

✋ **Stop:** tell me which provider and plan you choose before buying anything.

---

## Step 2 – Create an SSH key for the server (on your laptop)

**What:** a key pair that lets you log in to the server without a password.
**Why:** it's more secure than passwords, and the setup script turns password login off.
**Where:** a PowerShell terminal in VS Code (**Terminal → New Terminal**).

We use a **separate file name** (`qgm_vps`) so we never touch any SSH key you use for work:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\qgm_vps" -C "qgm-vps"
```

When asked for a passphrase, type one and save it in your password manager. (You can leave it empty, but a passphrase protects the key if your laptop is lost.)

**Success:** you see `Your public key has been saved in ...\.ssh\qgm_vps.pub`. Show the **public** key, which is safe to share:

```powershell
Get-Content "$env:USERPROFILE\.ssh\qgm_vps.pub"
```

It's one line starting with `ssh-ed25519`. Copy it for the next step. Never share the file **without** `.pub`.

---

## Step 3 – Create the server (Hetzner example)

**Where:** https://console.hetzner.com (sign up first at https://accounts.hetzner.com/signUp).
**Clicks:**

1. **New project** → name it `quiet-growth-media` → open it.
2. **Add Server** (or **Create Resource → Servers**).
3. **Location:** Nuremberg, Falkenstein or Helsinki.
4. **Image:** **Ubuntu 24.04**.
5. **Type:** Shared vCPU → **Regular Performance** → **CPX22**.
6. **Networking:** keep **Public IPv4** and IPv6 ticked. (The IPv4 address may cost a little extra; the console shows the total.)
7. **SSH keys:** **Add SSH key** → paste the `ssh-ed25519 ...` line → name it `qgm-vps`.
8. **Name:** `qgm-prod-1` → check the monthly price shown → **Create & Buy now**.

**Success:** after about 30 seconds the server shows **Running** and an **IPv4 address** like `203.0.113.10`. Write it down. Below it's called `SERVER_IP`.

---

## Step 4 – Log in for the first time

```powershell
ssh -i "$env:USERPROFILE\.ssh\qgm_vps" root@SERVER_IP
```

It asks `Are you sure you want to continue connecting?`. Type `yes`.
**Success:** the prompt changes to `root@qgm-prod-1:~#`. Type `exit` to go back to your laptop.

---

## Step 5 – Run the server setup script

From the **project folder on your laptop**, copy the two setup scripts to the server:

```powershell
scp -i "$env:USERPROFILE\.ssh\qgm_vps" deploy\scripts\server-setup.sh deploy\scripts\harden-ssh.sh root@SERVER_IP:/root/
```

Then log in again (Step 4) and run:

```bash
bash /root/server-setup.sh
```

It installs updates, creates the user `qgm`, sets up the firewall (only SSH, HTTP and HTTPS open), fail2ban, automatic security updates, a swap file and Docker.

- It asks you to **choose a password for `qgm`**. You'll need it for `sudo`, so save it in your password manager.
- It takes about 3–5 minutes.

**Success:** the last lines show `✅ Server setup complete.` with the Docker and Compose versions.

---

## Step 6 – Switch off root and password logins

**Keep the root window open.** In a **new** PowerShell terminal, test that the new user works:

```powershell
ssh -i "$env:USERPROFILE\.ssh\qgm_vps" qgm@SERVER_IP
```

✅ If you see `qgm@qgm-prod-1:~$`, go back to the **root** window and run:

```bash
bash /root/harden-ssh.sh
```

**Success:** it prints `permitrootlogin no` and `passwordauthentication no`. Open one more new terminal and log in as `qgm` again to confirm. From now on, always log in as `qgm`.

Optional shortcut: so you can just type `ssh qgm`, open your SSH config with `code "$env:USERPROFILE\.ssh\config"` and **add** these lines at the end (don't remove anything that's already there):

```
Host qgm
  HostName SERVER_IP
  User qgm
  IdentityFile ~/.ssh/qgm_vps
  IdentitiesOnly yes
```

---

## Step 7 – Put the code on the server

> Needs the private GitHub repository from [Phase 1 Step 6](phase-1-setup-windows.md#step-6--create-the-github-repository-and-push).

On the server, as `qgm`, create a read-only **deploy key** that can only read this one repository:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "qgm-prod-1 deploy key" && cat ~/.ssh/github_deploy.pub
```

On GitHub: your repo → **Settings → Deploy keys → Add deploy key**.

- Title: `qgm-prod-1`.
- Paste the line that was printed.
- Leave **Allow write access** **unticked**.
- **Add key**.

Then, on the server (replace `YOUR_USERNAME`):

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
git clone git@github.com:YOUR_USERNAME/quiet-growth-media.git ~/quiet-growth-media && cd ~/quiet-growth-media
```

**Success:** `ls` shows `AGENTS.md  deploy  src ...`.

---

## Step 8 – Create the server settings (`deploy/.env`)

```bash
bash deploy/scripts/init-env.sh
```

It asks for two web addresses and an email address:

- **No domain yet?** Press Enter twice. You get free test addresses such as `app.203-0-113-10.sslip.io` and `n8n.203-0-113-10.sslip.io`. They work immediately, with real HTTPS.
- **Own a domain?** First create two DNS **A records** at your domain provider, `app` and `n8n`, both pointing to `SERVER_IP`. Then type `app.yourdomain.com` and `n8n.yourdomain.com`.

**Success:** `OK: deploy/.env created (dashboard: https://..., n8n: https://...)`. All secrets were generated for you and are never shown.

---

## Step 9 – Set the dashboard password

```bash
bash deploy/scripts/set-dashboard-password.sh
```

Choose a username (default `admin`) and a strong password (12+ characters). Save it in your password manager.
**Success:** `OK: Dashboard login saved for user 'admin'.`

---

## Step 10 – Deploy

```bash
bash deploy/scripts/deploy.sh
```

The first run downloads and builds everything, which takes about 3–6 minutes.
**Success:** `✅ Deployed.` followed by your two URLs.

Open the dashboard URL in your browser and log in. You should see the **Quiet Growth Media Network** control room with 9 brands. The first visit can take up to a minute while the HTTPS certificate is issued.

---

## Step 11 – Set up n8n

1. Open the n8n URL. Create the **owner account**, using a different password from the dashboard.
2. On the server, run:

   ```bash
   bash deploy/scripts/n8n-bootstrap.sh
   ```

   **Success:** `Successfully imported 1 credential.`, then `Successfully imported 2 workflows.`

3. In n8n, open **QGM - Daily content scheduler** and click **Execute workflow**.
   **Success:** the last node shows `"brands": 3, "created": 9` (tomorrow's videos for the brands in `AUTOMATION_BRANDS`), or `"existing": 9` if they were already planned. The worker starts making them right away (AI costs, capped by `DAILY_MAX_USD`).
4. Switch the workflow to **Active**. It now runs every day at 06:00 (Asia/Kolkata).
5. Leave **QGM - Publish due videos** inactive until publishing is set up ([publishing.md](publishing.md), Step 8). Then set `PUBLISHING_ENABLED=true` in `deploy/.env` (`nano deploy/.env`), run `bash deploy/scripts/deploy.sh`, and switch that workflow to **Active**.

---

## Step 12 – Backups

Run a backup now, then test that it restores:

```bash
bash deploy/scripts/backup.sh
bash deploy/scripts/restore.sh --verify /var/backups/qgm/$(ls /var/backups/qgm | grep Z$ | tail -n1)
```

**Success:** `✅ Backup complete` and `✅ Restore test passed`. Then schedule it nightly (02:17 server time; the last 14 days are kept):

```bash
bash deploy/scripts/backup.sh --install-cron
```

**Off-site copy:** backups on the same server don't help if the server is lost. Until we choose paid off-site storage, copy the latest backup to your laptop about once a week (in PowerShell, using the `ssh qgm` shortcut from Step 6):

```powershell
scp -r qgm:/var/backups/qgm/LATEST_FOLDER_NAME "$env:USERPROFILE\Documents\qgm-backups\"
```

Backups contain `deploy/.env`, which holds secrets, so keep them private.

---

## Phase 2 checklist

- [ ] HTTPS works on both addresses (padlock in the browser)
- [ ] The dashboard asks for a password; n8n asks for its own login
- [ ] `https://APP_DOMAIN/health/ready` shows `"status":"ready"` (after logging in)
- [ ] n8n daily workflow executed (9 videos planned) and set to Active; publish workflow imported
- [ ] Backup and restore test passed; nightly backup scheduled
- [ ] `ssh root@SERVER_IP` is refused; `ssh qgm@SERVER_IP` works

## Everyday commands (on the server, in `~/quiet-growth-media`)

| Task                               | Command                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Deploy the latest code from GitHub | `bash deploy/scripts/deploy.sh --pull`                                               |
| Status of all services             | `bash deploy/scripts/dc.sh ps`                                                       |
| API logs (live)                    | `bash deploy/scripts/dc.sh logs -f --tail 100 api`                                   |
| Restart n8n                        | `bash deploy/scripts/dc.sh restart n8n`                                              |
| Change dashboard password          | `bash deploy/scripts/set-dashboard-password.sh`                                      |
| Backup now / test restore          | `bash deploy/scripts/backup.sh` · `bash deploy/scripts/restore.sh --verify <folder>` |

## Troubleshooting

- **Browser shows a certificate error or doesn't load:** wait a minute, then check `bash deploy/scripts/dc.sh logs --tail 50 caddy`. With your own domain, check that DNS points to the server: `nslookup app.yourdomain.com` should show `SERVER_IP`.
- **`permission denied ... docker.sock`:** log out and back in once after `server-setup.sh` (the docker group applies to new logins).
- **Locked out of SSH:** use the provider's web **Console** (Hetzner: server → **Console**), log in as `qgm` with your password, and fix the problem from there.
- **`deploy.sh` says the API didn't become ready:** `bash deploy/scripts/dc.sh logs --tail 100 api`.
