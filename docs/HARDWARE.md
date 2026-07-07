# Hardware — what to buy

You have real choices here, and they involve honest tradeoffs. This guide lays out
three builds — a cheap one, a comfortable one, and a **no-Raspberry-Pi** one that
runs on a computer you already own — plus how to choose a camera and mount it.

Prices are rough US ballparks and drift over time; treat them as relative, not
exact. When you've picked a build, head to
[`GETTING_STARTED.md`](./GETTING_STARTED.md) for the walkthrough.

---

## Build 1 — Budget (~$45–60)

The smallest thing that works.

| Part | Notes |
| --- | --- |
| **Raspberry Pi Zero 2 W** | Quad-core, WiFi built in. Plenty for this workload. |
| **Camera Module 3** | Sharp, autofocus, small. The standard-lens version is right for a feeder. |
| **microSD card** (32 GB+) | A reputable brand. This is the OS drive. |
| **USB-C power supply** | The official 5V one; flaky power causes flaky Pis. |
| **Case / enclosure** | A basic case indoors; a weatherproof box with a clear window if it lives outside (see [Mounting](#mounting--enclosure)). |

**Caveat:** the Zero 2 W is slower and has less RAM, so the identify step takes a
beat longer and you won't want to also run heavy tools on it. For the motion →
Gemini → upload loop, though, it's completely fine. If you'll only ever run one
camera and want to spend the least, this is the build.

> Note the Zero 2 W uses the **mini** camera connector, so you need the small
> ribbon cable that fits it (often sold as the "Zero" camera cable) rather than the
> standard one — check what your camera ships with.

---

## Build 2 — Recommended (~$100–140)

More headroom, fewer headaches, room to grow.

| Part | Notes |
| --- | --- |
| **Raspberry Pi 4 or Pi 5** | Faster, more RAM. Comfortable for multi-camera and for running an AI coding agent *on the device* (see [`REMOTE_ACCESS.md`](./REMOTE_ACCESS.md)). |
| **Camera Module 3** | Same great feeder camera as the budget build. |
| **microSD card** (32 GB+) | Same as above. |
| **Official USB-C power supply** | The Pi 5 wants the **27 W** supply; the Pi 4 uses the 15 W one. |
| **Case / enclosure** | Indoor case or a weatherproof box with a clear window. |

> **Pi 5 camera-cable gotcha — read this before you order.** The Pi 5 moved to a
> **22-pin** CSI camera connector, but the Camera Module 3 ships with a **15-pin**
> cable pre-attached. So on a Pi 5 you must:
>
> 1. Buy the **22-pin-to-15-pin** camera cable (Raspberry Pi sells it as the
>    "Camera Cable for Pi 5").
> 2. **Remove the pre-attached 15-pin cable from the camera** before fitting the
>    new one — gently lift the connector's tab, slide the old cable out, slide the
>    15-pin end of the new cable in, press the tab down. The 22-pin end goes into
>    the Pi's `CAM/DISP` connector.
>
> The Pi 4 uses the classic 15-pin connector, so the camera's included cable works
> as-is there.

This is the build most people should get. The extra power means you can add a
second camera later, or SSH in and let an agent maintain the thing for you, without
running out of headroom.

---

## Build 3 — No Pi / spare computer (~$60–90 for the camera)

Already have an always-on machine — a Mac mini, an old laptop that never sleeps, a
home server / NAS? You can skip the Raspberry Pi entirely. The host runs the exact
same `birdcam.py`; the camera is a **weatherproof network camera** streaming over
your WiFi.

| Part | Notes |
| --- | --- |
| **Any always-on computer** | Mac mini, old laptop, home server — anything that stays powered and on the network. |
| **A Reolink RTSP camera** | E.g. the **RLC-510WA** or similar. Weatherproof, WiFi, its own power supply, and it exposes an RTSP video stream. |

**The key constraint:** `picamera2` is **Raspberry-Pi-only**, so this path is
**RTSP-only** — you talk to a network camera over its stream, not to a ribbon-cabled
Pi camera. You run the same code with `source = "rtsp"` in `config.toml`.

Setup differs from the Pi in a few ways:

- **Virtualenv, no system packages.** On macOS/Linux you don't need
  `--system-site-packages` (that flag only exists to share the Pi's system
  `picamera2`). Just:

  ```bash
  cd birdwatcher-public/camera
  python3 -m venv venv
  ./venv/bin/pip install -r requirements.txt
  ./venv/bin/pip install opencv-python-headless   # required for RTSP
  ```

  OpenCV is what reads the RTSP stream, so it's mandatory on this path (on the Pi
  it's optional).

- **Keep the machine awake.** A sleeping laptop is a dead camera. On macOS run the
  service under `caffeinate`, or set Energy Saver / Battery to never sleep on
  power. On a laptop, also consider "prevent sleep when the lid is closed."

- **No systemd on macOS.** Instead of the `birdcam.service` systemd unit, run it
  under **launchd** (a `.plist` in `~/Library/LaunchAgents`) so it starts at login
  and restarts on crash — or, for a quick always-running setup, keep it alive in a
  **tmux** session you leave attached. On a Linux box, systemd works the same as on
  the Pi.

Everything downstream — Gemini, the website, the API contract — is identical. The
host just needs to stay on and reach the internet.

---

## Choosing a camera

The Pi Camera Module and a Reolink/RTSP camera solve the same problem differently.

| | **Pi Camera Module 3** | **Reolink / RTSP camera** |
| --- | --- | --- |
| **Image detail** | Sharpest close-ups; genuinely nice feeder photos. | Slightly softer, but plenty for AI identification. |
| **Focus** | Autofocus, or a fixed focus you set for the feeder distance. | Fixed focus, factory-sealed — no calibration. |
| **Connection** | Wired to the Pi by ribbon cable (short reach). | Over WiFi/LAN — place it **anywhere** with signal. |
| **Power** | From the Pi. | Its own power supply. |
| **Weatherproofing** | Needs an enclosure with a clear window. | Weatherproof out of the box. |
| **Works with** | Raspberry Pi only. | **Any** host — Pi, Mac, server. |

Rules of thumb: pick the **Pi Camera Module 3** if you want the sharpest photos and
can build or buy a weatherproof enclosure with a clear window. Pick a **Reolink/
RTSP camera** if you want to mount the camera far from the computer, skip the
enclosure fuss, or run the whole thing off a machine you already own.

**Want both?** You can run a Pi camera *and* a network camera at once — the
multi-camera mode uses `[[cameras]]` entries in `config.toml` and
`birdcam_multi.py`. Each camera posts with its own `device_name`, so the gallery
shows which one caught the sighting. Details are in
[`../camera/SETUP.md`](../camera/SETUP.md).

---

## Mounting & enclosure

- **Distance.** Mount the camera **0.5–1 m (about 2–3 ft) from the feeder**, aimed
  at where the birds land. A known, fixed distance lets you set one fixed focus
  value and forget it — that's the whole reason the pipeline assumes a feeder
  rather than an open yard.
- **Sun behind the camera**, ideally with the lens shaded. Backlight makes birds
  into silhouettes and confuses the ID.
- **Shooting through glass or a window?** Expect focus and reflection trouble.
  Autofocus tends to lock onto the glass right in front of the lens, and
  reflections wash out the image. Set a **fixed** `lens_position` and read
  [`FOCUS_DEBUG.md`](./FOCUS_DEBUG.md) *before* you conclude the camera is broken —
  most "everything is soft" problems are optical-path issues, not the camera.
- **The Pi path needs a weatherproof box** if it lives outdoors: the camera lens
  flush against a clear window, black foam around the lens to kill internal
  reflections, silica gel packs against condensation, and a cable gland for the
  power lead. The Reolink path skips all of this — it's already sealed.

---

## Also needed (don't forget these)

- **A bird feeder — and seed!** The camera is pointless without birds showing up.
  Get the feeder going a week or two early so the birds find it before the camera
  does.
- **A domain name** (~$10–15/year) from any registrar, for the public website.
- **Free accounts**, all no-cost to start:
  - [Vercel](https://vercel.com) — hosts the website and API.
  - [Neon](https://neon.tech) — the Postgres database.
  - [Vercel Blob](https://vercel.com/storage/blob) — stores the photos (added
    inside your Vercel project).
  - [Google AI Studio](https://aistudio.google.com/apikey) — the Gemini API key
    (~$0.0006 per identification; the free tier covers testing).
  - Optional: [eBird](https://ebird.org/api/keygen) for a seasonal species prior,
    [healthchecks.io](https://healthchecks.io) for uptime alerts, and
    [Twilio](https://twilio.com) for text alerts ([`NOTIFICATIONS.md`](./NOTIFICATIONS.md)).

Ready to build? Start at [`GETTING_STARTED.md`](./GETTING_STARTED.md).
