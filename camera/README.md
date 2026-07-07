# bird-cam — the camera (Raspberry Pi)

The Python service that lives at the feeder: watch for motion → grab the
sharpest frame → ask Gemini what it is → post birds to the website.

> **Setting up new hardware?** Follow **[SETUP.md](./SETUP.md)** — a full
> start-to-finish, no-monitor-needed checklist from "in the box" to "posting
> birds". This README is the reference/background.

## Shopping list (~$120–160)

| Part | ~Cost | Notes |
| --- | --- | --- |
| Raspberry Pi 5 (4GB) | $60 | A Pi 4 / Pi Zero 2 W also work (slower). |
| Raspberry Pi Camera Module 3 | $25–35 | Autofocus — this makes the photos *nice*. Standard, not wide. |
| MicroSD card (64GB) | $10 | Flash with Raspberry Pi OS. |
| Official Pi power supply | $12 | |
| Weatherproof case / outdoor junction box | $15–30 | Keep the lens behind clear acrylic. |
| Bird feeder | $15–25 | **The key trick:** aim the camera at a feeder 3–6 ft away. |

> Birds are unpredictable in open yard; at a feeder they come to a known spot in
> good light at a fixed focus distance. Every reliable build does this.

## Software setup

```bash
# On the Pi, with the repo (or just this pi/ folder) at /home/pi/bird-cam:
cd /home/pi/bird-cam
bash install.sh          # installs picamera2 + a venv with the Python deps
```

Then edit:

- **`config.toml`** — camera tuning, model, location hint, `upload_url`.
- **`birdcam.env`** — secrets (`BIRDCAM_GEMINI_API_KEY`, `BIRDCAM_INGEST_TOKEN`).
  Get a Gemini key at <https://aistudio.google.com/apikey>.

## Test before deploying (works on any laptop too)

You can exercise the whole identify-and-upload pipeline with a saved photo — no
Pi or camera required:

```bash
pip install -r requirements.txt
BIRDCAM_GEMINI_API_KEY=... BIRDCAM_UPLOAD_URL=https://your-domain.example/api/sightings \
  python3 birdcam.py --test-image some_bird.jpg
```

## Run it for real

```bash
sudo cp birdcam.service /etc/systemd/system/
sudo systemctl enable --now birdcam
journalctl -u birdcam -f      # watch live
```

## How it works

1. **Motion gate** (free, local): downscaled grayscale frame differencing. Wind
   and empty frames never reach the API. Tune `motion_threshold`.
2. **Sharpest frame**: on motion it grabs a short burst and keeps the crispest
   one (birds move fast).
3. **Gemini Flash**: one call returns `{is_bird, species, confidence, fun_facts}`
   as JSON. At ~$0.0006 per image, cost is negligible even on a busy day.
4. **Cooldown**: after a post it waits `cooldown_seconds` so one visit = one
   post, not fifty.
5. Only confident birds (`min_confidence`) get posted.

## Cost

The local motion gate means Gemini is only called when something actually moves.
Even hundreds of calls a day is well under a dollar. Neon + Vercel Blob + Vercel
hosting all have free tiers that comfortably cover a home feeder.

## Tuning tips

- **Too many false triggers?** Raise `motion_threshold`.
- **Missing quick birds?** Lower `poll_seconds`, raise `burst_frames`.
- **Wrong species guesses?** Make `location_hint` more specific; raise
  `min_confidence` so only sure IDs post.
