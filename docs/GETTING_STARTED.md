# Getting Started — your own AI bird feeder camera

This is the end-to-end walkthrough. Follow it top to bottom and, in about an
afternoon, you'll have:

- **A public website** — a warm, photo-forward gallery of every bird that visits
  your feeder, each one identified by name with a fun fact or two, live on your
  own domain.
- **A camera at your feeder** that watches for motion, keeps the sharpest frame of
  each visit, asks Google Gemini "what bird is this?", and posts the photo to that
  website automatically — for a fraction of a cent per identification.

We build it in **two halves, website first**. That order matters: the website
ships with built-in sample birds, so it works and looks finished *before the
camera exists*. You'll have something real to look at from the first ten minutes,
and when the camera comes online it just starts adding real sightings to a site
that already works.

You don't need to be a professional engineer. Every step says exactly what to
type. If a step doesn't match what you see, stop there rather than pushing on.

> **A note on names.** Throughout, `your-domain.example` stands in for your real
> domain, `you@example.com` for your email, and `pi@birdcam.local` for your Pi's
> login. The first time you hit an `ssh pi@birdcam.local` command, substitute the
> username and hostname *you* chose when flashing the SD card (Part 2). The device
> names `feeder-pi` (a Pi camera) and `yard-reolink` (a network camera) are also
> examples — pick whatever you like.

---

## Prerequisites

- [ ] **Hardware.** See [`HARDWARE.md`](./HARDWARE.md) for a shopping guide with
      three budgets. You can do all of **Part 1** before any hardware arrives.
- [ ] **A domain name** you control (about $10–15/year from any registrar). Have it
      ready — you'll point it at the site in Part 1.
- [ ] **A GitHub account** (free) to fork the code into.
- [ ] **Free accounts** you'll create as you go: [Vercel](https://vercel.com)
      (hosting), [Neon](https://neon.tech) (database), and
      [Google AI Studio](https://aistudio.google.com/apikey) (the Gemini API key).
- [ ] **[Node.js](https://nodejs.org) 18+** and **[git](https://git-scm.com/downloads)**
      on your laptop for local development. (Already installed? `node --version`
      and `git --version` in a terminal will tell you.)

---

## PART 1 — The website (30–45 min)

### a. Get the code running locally

Fork [`github.com/wstoeckle/birdwatcher-public`](https://github.com/wstoeckle/birdwatcher-public)
to your own GitHub account (the **Fork** button, top-right), then clone your fork
and start it:

```bash
git clone https://github.com/YOUR-USERNAME/birdwatcher-public.git
cd birdwatcher-public
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). You should see the
gallery, already populated with **sample birds**. That's the whole point of this
first step: with zero environment variables set, the site serves built-in sample
sightings so you can see it work immediately. Nothing is wired up yet — that's
next.

### b. Create a Vercel project

At [vercel.com](https://vercel.com), sign in with GitHub and **Add New → Project**,
then import your fork. Vercel reads [`vercel.json`](../vercel.json) and
auto-detects the framework (Vite), build command, and output directory — you
shouldn't need to change anything.

> If Vercel asks for a **Root Directory**, it's the **repo root** (leave it as the
> default `.`). The website lives at the top level of the repo, not in a subfolder.

Deploy it. You now have a live URL like `your-project.vercel.app` showing the same
sample gallery. Real data comes when you add a database.

### c. Add a database (Neon)

The site stores each sighting's metadata (species, time, confidence, fun facts) in
Postgres. [Neon](https://neon.tech) gives you a free Postgres database:

1. Create a free Neon project and copy its **connection string** (`DATABASE_URL` —
   it starts with `postgres://`).
2. Run the migrations. These live in [`migrations/`](../migrations/) as **nine
   plain SQL files**, meant to be applied **in numeric order** with `psql`. In a
   terminal at the repo root, paste your connection string into the first line,
   then run the loop:

   ```bash
   export DATABASE_URL='postgres://...your connection string...'
   for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   ```

   The `*.sql` glob expands in sorted order, so `0001` runs before `0002`, and so
   on. They're written to be safe to re-run, so if you add a database later and
   need to catch up, running the whole loop again is fine.

   > No `psql` installed? It ships with the `postgresql` client package
   > (`brew install libpq` on macOS, `apt install postgresql-client` on Debian/
   > Ubuntu), or you can paste each file's contents into Neon's web SQL editor in
   > order.

### d. Add photo storage (Vercel Blob)

The bird *photos* themselves live in Vercel Blob. In your Vercel project:
**Storage → Create → Blob**. When you connect the store to the project, Vercel
adds the `BLOB_READ_WRITE_TOKEN` environment variable for you automatically.

### e. Set the environment variables

Open your Vercel project → **Settings → Environment Variables**. Here's the full
list, walking through [`.env.example`](../.env.example):

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | The Neon connection string from step (c). |
| `BLOB_READ_WRITE_TOKEN` | Added automatically in step (d) — confirm it's there. |
| `BIRDCAM_INGEST_TOKEN` | The shared secret the camera uses to authenticate. Generate a strong one by running `openssl rand -hex 32` in your laptop's terminal, and save the output — the **exact same value** goes on the Pi later. |
| `SITE_URL` | Your public URL, no trailing slash (e.g. `https://your-domain.example`). Used in SMS alert links. |
| `CAPTURE_PIN` | PIN for the public "take a photo now" button (defaults to `4434` if unset). |
| `ADMIN_PIN` | PIN for admin actions — correcting/deleting a sighting, viewing the `/spend` page. Leave unset to disable admin actions. |
| `GEMINI_API_KEY` | Lets the *website* regenerate a scientific name and fun facts when you correct a species. Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `CRON_SECRET` | Protects the weekly photo-archive cron (see `crons` in `vercel.json`). Any long random string. |
| Twilio vars | Optional text/MMS alerts. Skip for now — see [`NOTIFICATIONS.md`](./NOTIFICATIONS.md). |

> **The one gotcha everyone hits:** environment variable changes only take effect
> on the **next deployment**. After setting these, trigger a **redeploy**
> (Deployments → the latest one → **Redeploy**), or the site will keep running
> with the old (empty) config and you'll wonder why nothing changed.

Once redeployed, your live site is backed by a real database — the sample birds
give way to an empty gallery waiting for its first real visitor.

### f. Point your domain at it

In Vercel: **Settings → Domains → Add**, and enter your domain. Vercel tells you
which **A record** or **CNAME** to set at your registrar. Add it there and wait for
DNS to propagate (minutes to an hour).

> **The most important gotcha in this whole guide.** When the camera posts a
> sighting later, it must POST to the **exact canonical form** of your domain — the
> one Vercel treats as primary. If your canonical domain is `www.your-domain.example`,
> the Pi must use `https://www.your-domain.example/...`, **with** the `www`.
>
> Here's why it bites: if you post to the non-canonical host (e.g. the bare
> `your-domain.example` when `www` is canonical), Vercel answers with a **redirect**
> to the canonical host — and a redirect **strips the `Authorization` header**. Your
> token vanishes on the hop, and you get a **mysterious 401** that looks exactly
> like a wrong token. Note the canonical form now; you'll use it in Part 2.

### g. Make it yours

A few quick edits to personalize the site (all in your fork; commit and push, and
Vercel redeploys):

- **[`src/siteConfig.ts`](../src/siteConfig.ts)** — `SITE_TITLE`, `SITE_SUBTITLE`,
  `SITE_URL`, and `CONTACT_EMAIL`. These show up in the header and legal pages.
- **[`index.html`](../index.html)** — the browser-tab `<title>` and the
  `<meta name="description">`. (These are separate from `siteConfig.ts` — update
  both.)
- **[`sites/`](../sites/)** — copy `sites/example/` to `sites/your-name/` and edit
  the values (`name`, `device_name`, `domain`, `site_title`, `location_hint`).
  This is a non-secret registry entry for your household; secrets stay in Vercel
  and on the Pi.

The website half is done. Now let's give it something to photograph.

---

## PART 2 — The camera (1–2 hours)

This is the abbreviated path. For the exhaustive, click-by-click version — WiFi
handoff, moving the Pi between networks, enclosure assembly — see
[`../camera/SETUP.md`](../camera/SETUP.md), the deeper Pi reference. Everything
here is done **headless**: no monitor or keyboard on the Pi.

### Flash the SD card

Install [Raspberry Pi Imager](https://www.raspberrypi.com/software/) on your
laptop. Insert the microSD card and run the Imager:

- **OS:** Raspberry Pi OS (64-bit), Bookworm or newer.
- Click the **gear / Edit Settings** button before writing, and set:
  - **Hostname:** `birdcam` (the Pi becomes reachable as `birdcam.local`).
  - **Username / password:** `pi` and a strong password — write it down.
  - **WiFi:** the network **where the camera will live** (SSID + password).
  - **Enable SSH** (Services tab) with password authentication.

Write the card, put it in the Pi, and power on. First boot takes a minute or two
while it joins WiFi. No screen needed.

### Connect and install

From your laptop (substitute your username/hostname):

```bash
ssh pi@birdcam.local
```

This opens a terminal *on the Pi* — everything you type now runs there. The first
time, SSH will ask whether to trust the new machine (type `yes`), then prompt for
the password you set in the Imager. If it says it can't find `birdcam.local`,
give the Pi another minute to boot, or use its IP address from your router's
device list instead.

Then on the Pi:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/YOUR-USERNAME/birdwatcher-public.git
cd birdwatcher-public/camera
bash install.sh
```

`install.sh` installs the system camera library (`python3-picamera2`), creates a
Python virtualenv **with access to that system library**
(`python3 -m venv --system-site-packages venv`), installs the Python packages
(`google-genai`, `pillow`, `numpy`, `requests`), and creates your `config.toml`
and `birdcam.env` from the examples.

> **Using a network (RTSP) camera instead of a Pi camera?** `install.sh` skips
> OpenCV by default. Add it with `./venv/bin/pip install opencv-python-headless`.
> See [`HARDWARE.md`](./HARDWARE.md) for the RTSP-only and no-Pi paths.

### Configure it

Two files. First, camera tuning in **`config.toml`** (`nano config.toml`):

- `device_name` — e.g. `feeder-pi`. Appears with each sighting so the gallery can
  tell cameras apart.
- `source` — `"picamera2"` for the Pi Camera Module, or `"rtsp"` for a network
  camera.
- `motion_threshold` — average pixel change that counts as motion. `6` is a sane
  start; raise it if wind or moving shadows over-trigger.
- `lens_position` — fixed focus in dioptres (`1 / distance_in_metres`). If the
  camera shoots through an enclosure window, you **must** set this — autofocus
  hunts on the glass and comes back soft. Calibrate it objectively with
  `python3 focus_calibrate.py` (details in [`FOCUS_DEBUG.md`](./FOCUS_DEBUG.md)).
- `location_hint` — your feeder's real location. Helps Gemini pick the right
  regional species.

Then secrets in **`birdcam.env`** (`nano birdcam.env`, already `chmod 600`):

```
BIRDCAM_GEMINI_API_KEY=your_gemini_key_here
BIRDCAM_UPLOAD_URL=https://your-domain.example/api/sightings
BIRDCAM_INGEST_TOKEN=the_same_token_you_set_in_vercel
```

- `BIRDCAM_GEMINI_API_KEY` — from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- `BIRDCAM_UPLOAD_URL` — your ingest endpoint, using the **canonical domain** from
  Part 1f (with the `www` if that's canonical). This is where 401s come from if you
  get it wrong.
- `BIRDCAM_INGEST_TOKEN` — the **exact same value** as `BIRDCAM_INGEST_TOKEN` in
  Vercel.
- Optional: `BIRDCAM_EBIRD_API_KEY` — a free key from
  [ebird.org/api/keygen](https://ebird.org/api/keygen). Feeds recent nearby eBird
  sightings into the ID prompt so migration and season inform the guess.
- Optional: `BIRDCAM_RTSP_URL` — the stream URL for a Reolink/RTSP camera. Keeps
  the camera password out of `config.toml`.

### Smoke-test the whole pipeline (no live bird needed)

Copy any clear bird photo to the Pi and run one identification against it:

```bash
cd ~/birdwatcher-public/camera
set -a; source birdcam.env; set +a          # load your secrets
./venv/bin/python birdcam.py --test-image some-bird.jpg
```

You should see something like `✓ Northern Cardinal (94%) — posting` then `Posted.`,
and the bird should appear on your live website. This proves the camera → Gemini →
website chain end to end.

> **Warning:** a successful test **posts a real sighting** to your live site. That's
> the point (it proves the pipeline), but if you'd rather not, you can delete the
> post afterward from the site with your `ADMIN_PIN`.

### Run it for real (systemd)

So it starts on boot and restarts if it ever crashes:

```bash
cd ~/birdwatcher-public/camera
sudo cp birdcam.service /etc/systemd/system/
sudo systemctl enable --now birdcam
journalctl -u birdcam -f      # watch it live; Ctrl-C to stop watching
```

> The unit file points at `/home/pi/bird-cam` by default. If your path or username
> differs, edit `WorkingDirectory`, `User`, `EnvironmentFile`, and `ExecStart` in
> `birdcam.service` before copying it — [`../camera/SETUP.md`](../camera/SETUP.md)
> has a one-liner for this.
>
> You'll notice the service runs `birdcam_multi.py` rather than the `birdcam.py`
> you just smoke-tested — that's expected. It's the same pipeline; the multi
> wrapper reads your `config.toml` and runs one camera or several, whichever
> you've configured.
>
> **If logs seem to lag** (nothing appears in `journalctl` for a while, then a
> burst), add `Environment=PYTHONUNBUFFERED=1` to the `[Service]` section of the
> unit and `sudo systemctl daemon-reload && sudo systemctl restart birdcam`. Python
> buffers stdout when it's not a terminal; this flushes it.

**Optional but recommended:** the `netwatch.timer` watchdog bounces WiFi if the
network drops and reboots the Pi if it stays offline too long — worth it for a
camera you can't easily walk over to. Setup is in [`REMOTE_ACCESS.md`](./REMOTE_ACCESS.md).

### Do this before you walk away: set up remote access

The single most valuable thing you can do next is set up
**[`REMOTE_ACCESS.md`](./REMOTE_ACCESS.md)** — Tailscale so you can SSH in from
anywhere, plus an AI coding agent on the Pi so you can fix things by *describing*
the problem instead of remembering commands. Strongly recommended before the camera
goes somewhere inconvenient to reach.

---

## PART 3 — Point it at birds

The software works; now aim it well.

- **Feeder placement.** Mount the camera **0.5–1 m (about 2–3 ft) from the feeder**,
  pointed at where the birds actually land. A known, fixed distance is the whole
  trick — it lets you set one fixed focus value and never touch it again. Put the
  sun *behind* the camera, and shade the lens if you can.
- **Motion-threshold tuning.** If wind, swaying branches, or moving shadows keep
  triggering captures, **raise `motion_threshold`** in `config.toml` and
  `sudo systemctl restart birdcam`. If real birds get missed, lower it. Windy sites
  want a higher threshold.
- **Cooldown = one visit, one post.** After a capture, the camera won't run the AI
  again for `cooldown_seconds` (default 180). Birds tend to linger at a feeder, so
  a few minutes between captures loses almost nothing while keeping a gusty, empty
  scene from burning through API calls. Lower it if you want livelier posting.

---

## Troubleshooting quick table

| Symptom | Likely cause & fix |
| --- | --- |
| **401 on upload** | The Pi's `BIRDCAM_INGEST_TOKEN` ≠ the one in Vercel, **or** `BIRDCAM_UPLOAD_URL` uses the non-canonical host and a redirect is stripping the auth header. Use the **canonical** domain (Part 1f). |
| **Nothing posts** | Check `journalctl -u birdcam -f` for what it's seeing. If Gemini is rate-limited (free-tier quota), the camera **silently skips** rather than erroring — check your quota at AI Studio. |
| **Photos are blurry** | Run `python3 camera/focus_calibrate.py` to find the real focus peak and set `lens_position`; if even a close, high-contrast subject won't sharpen, it's an optical-path problem — see [`FOCUS_DEBUG.md`](./FOCUS_DEBUG.md). |
| **Gallery is empty when running locally** | That's **sample-data mode** — with no `DATABASE_URL`, the site shows built-in samples on the live deploy and an empty gallery once a database is wired but has no rows yet. Set `DATABASE_URL` (and post something) for real data. |
| **Upload 400 / image error** | Vercel Blob store not added, or `BLOB_READ_WRITE_TOKEN` missing. |

---

## Where to go next

- [`HARDWARE.md`](./HARDWARE.md) — shopping guide and build options.
- [`REMOTE_ACCESS.md`](./REMOTE_ACCESS.md) — maintain the cam from anywhere.
- [`../camera/SETUP.md`](../camera/SETUP.md) — the deep Pi reference.
- [`API.md`](./API.md) — the exact Pi ↔ website contract.
- [`NOTIFICATIONS.md`](./NOTIFICATIONS.md) — optional text/MMS alerts.
- [`FOCUS_DEBUG.md`](./FOCUS_DEBUG.md) — when photos won't come into focus.
