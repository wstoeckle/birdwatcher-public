# bird-cam setup — do this when the hardware arrives

A start-to-finish checklist to take the Pi from "in the box" to "posting birds to
your domain". Follow it top to bottom. Nothing here needs a monitor or keyboard on
the Pi — it's all done from your laptop ("headless").

> New to this? Each step says exactly what to type. If something doesn't match,
> stop at that step rather than pushing on.

---

## Part A — Prep you can do NOW (before the box arrives)

- [ ] **Website is live.** Confirm `https://your-domain.example` loads (sample birds are fine).
- [ ] **Database + storage wired up.** In the Vercel project: add **Neon** (Postgres)
      and a **Blob** store, run the files in `migrations/` against the database (all nine, in order), and
      set **`BIRDCAM_INGEST_TOKEN`** to a long random string. See
      [`docs/GETTING_STARTED.md`](../docs/GETTING_STARTED.md) Part 1. *(Without
      this, test posts won't save or show up.)*
- [ ] **Get a Gemini API key.** Go to <https://aistudio.google.com/apikey> → *Create
      API key* → copy it somewhere safe. (Free tier is plenty for testing.)
- [ ] **Save your two secrets** where you can find them — you'll paste both into the Pi:
  - `BIRDCAM_GEMINI_API_KEY` = the Gemini key
  - `BIRDCAM_INGEST_TOKEN` = the same random string you set in Vercel
- [ ] **Download a test bird photo** (any clear photo of a bird, a `.jpg`) to your
      laptop. You'll use it to prove the whole pipeline before the camera is even mounted.
- [ ] **Install Raspberry Pi Imager** on your laptop: <https://www.raspberrypi.com/software/>

---

## Part B — Flash the SD card (headless)

1. Put the **microSD card** in your laptop (use the USB adapter if your laptop has no slot).
2. Open **Raspberry Pi Imager**.
3. **Choose Device:** Raspberry Pi 5.
4. **Choose OS:** *Raspberry Pi OS (64-bit)* (the recommended one).
5. **Choose Storage:** your SD card. *(Double-check it's the card, not a USB drive.)*
6. Click **Next**, then **Edit Settings** (this is the headless magic). Fill the tabs
   exactly like this — only the three `‹...›` values are yours to change:

   **Tab: General**

   | Field | Value |
   | --- | --- |
   | ☑ Set hostname | `birdcam` (the Pi becomes reachable as `birdcam.local`) |
   | ☑ Set username and password | username: `pi` · password: `‹pick a strong one — write it down›` |
   | ☑ Configure wireless LAN | SSID: `‹WiFi name›` · Password: `‹WiFi password›` |
   | Wireless LAN country | `US` |
   | ☑ Set locale settings | Time zone: `America/New_York` · Keyboard: `us` |

   **Tab: Services**

   | Field | Value |
   | --- | --- |
   | ☑ Enable SSH | select **Use password authentication** |

   > ⚠️ **Which WiFi?** The Pi connects to whatever network you enter here. It needs to
   > be the **WiFi at the location where the camera will live**. If you flash it on your
   > own WiFi to test first, see "Moving to a different WiFi" below before you bring it
   > over — otherwise it won't connect there.
7. **Save**, then **Yes** to apply settings, **Yes** to erase and write. Wait ~5 min.
8. Eject the card, put it in the Pi, plug in the **27W USB-C** power. First boot takes
   ~1–2 minutes (it joins WiFi automatically).

### Moving to a different WiFi (e.g. test at your house, deploy at the feeder site)

Raspberry Pi OS (Bookworm) uses NetworkManager, so you can pre-load the destination
network **while you still have SSH access on your own WiFi** — it'll connect there
automatically once in range. SSH in (Part C) and run, filling in the details:

```bash
sudo nmcli connection add type wifi con-name destination-wifi \
  ssid "DESTINATION_WIFI_NAME" \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "DESTINATION_WIFI_PASSWORD"
```

(If you know the destination WiFi credentials up front, the simplest path is to just
enter *those* in step 6 and skip this — but then you can't SSH-test on your own
network first. Pre-loading both networks is the most flexible option.)

---

## Part C — Connect to the Pi from your laptop

These instructions use `pi` as the username and `birdcam` as the hostname —
substitute whatever you chose when flashing the SD card.

1. Open a terminal (macOS: Terminal app; Windows: PowerShell).
2. Connect (use the username you chose):
   ```bash
   ssh pi@birdcam.local
   ```
   - Type `yes` to the fingerprint prompt the first time, then your password.
   - If `birdcam.local` isn't found, find the Pi's IP in your router's device list
     and use `ssh pi@192.168.x.x` instead.
3. You're in when the prompt changes to `pi@birdcam:~ $`.

---

## Part D — Install the bird-cam software

Run these on the Pi (over SSH):

```bash
# Get the code
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/YOUR-USERNAME/birdwatcher-public.git   # your fork
cd birdwatcher-public/camera

# Install camera library + Python deps into a virtualenv
bash install.sh
```

`install.sh` installs `python3-picamera2`, creates a `venv`, installs the Python
packages, and creates `config.toml` + `birdcam.env` from the examples.

Now fill in your settings:

```bash
nano birdcam.env
```
Set these three lines, then **Ctrl-O, Enter, Ctrl-X** to save:
```
BIRDCAM_GEMINI_API_KEY=your_gemini_key_here
BIRDCAM_UPLOAD_URL=https://your-domain.example/api/sightings
BIRDCAM_INGEST_TOKEN=the_same_token_from_vercel
```

Optionally tweak `nano config.toml` for camera tuning (set `location_hint` to your
feeder's location; other defaults are sensible).

---

## Part E — Prove the pipeline works (no camera needed yet)

1. Copy your test bird photo from your laptop to the Pi. In a **laptop** terminal:
   ```bash
   scp ~/Downloads/test-bird.jpg pi@birdcam.local:~/birdwatcher-public/camera/
   ```
2. Back on the **Pi**, run it once against that image:
   ```bash
   cd ~/birdwatcher-public/camera
   set -a; source birdcam.env; set +a          # load your secrets
   ./venv/bin/python birdcam.py --test-image test-bird.jpg
   ```
3. You should see something like `✓ Northern Cardinal (94%) — posting` then `Posted.`
4. **Open `https://your-domain.example`** → the bird should appear in the gallery. 🎉

> If it prints `not a bird` your test photo may be unclear — try another. If you get
> a `401`, the token doesn't match Vercel. A `400`/upload error → check `BLOB` is set
> up. (Troubleshooting table at the bottom.)

---

## Part F — Connect the camera and test a live capture

1. **Power off** first: `sudo shutdown -h now`, then unplug.
2. Connect the **Camera Module 3** using the **Pi 5 camera cable** (22-pin → 15-pin):
   - On the Pi 5, lift the small black tab on the **CAM/DISP 0** connector, slide the
     **22-pin** end in (contacts facing the right way), press the tab down.
   - At the camera, the **15-pin** end goes into its connector the same way.
3. Power back on, SSH in, and test the camera:
   ```bash
   cd ~/birdwatcher-public/camera
   set -a; source birdcam.env; set +a
   ./venv/bin/python birdcam.py        # live mode — watches for motion
   ```
4. Wave your hand in front of the lens. You should see `Motion detected…` and it will
   try to identify it (a hand → `not a bird`, which is correct!). Ctrl-C to stop.

---

## Part F2 — Add an off-the-shelf network camera

In addition to the Pi Camera Module, or instead of it, you can point the Pi at a
weatherproof Wi-Fi/PoE camera (e.g. a **Reolink RLC-510WA**). It's fixed-focus and
factory-sealed, so there's no lens/enclosure calibration — the Pi just pulls the
camera's video stream over the network and runs the same motion → Gemini → upload
pipeline. Each camera posts with its own `device_name`, so the gallery can show
which camera caught the sighting.

1. **Mount + power the camera** and get it on the **same network** as the Pi (Wi-Fi or
   PoE). In the **Reolink app → Device Settings → Network Information**, note its **IP
   address** (e.g. `192.168.1.50`). Tip: give it a **fixed/reserved IP** (set it to
   "Static" there, or reserve it in your router) so it doesn't change on reboot.
2. **Find the stream (RTSP) URL.** For Reolink the full-res "main" stream is:
   ```
   rtsp://USER:PASSWORD@CAMERA_IP:554/h264Preview_01_main
   ```
   (Some newer **H.265** models use `h265Preview_01_main`.) Sanity-check it by opening
   that URL in **VLC** (File → Open Network) on a laptop on the same Wi-Fi — you should
   see the live feed.
3. **Install OpenCV** on the Pi (only needed for this source):
   ```bash
   ./venv/bin/pip install opencv-python-headless
   ```
4. **Point birdcam at it.** For RTSP-only, set `source = "rtsp"` under `[camera]`. To
   run the Pi camera and Reolink together, add `[[cameras]]` entries in `config.toml`:
   ```toml
   [[cameras]]
   device_name = "feeder-pi"
   source = "picamera2"
   lens_position = 0.94
   rotation = 270
   motion_threshold = 9.0

   [[cameras]]
   device_name = "yard-reolink"
   source = "rtsp"
   rtsp_url_env = "BIRDCAM_RTSP_URL"
   rotation = 0
   jpeg_max_width = 1600
   jpeg_quality = 85
   motion_threshold = 9.0
   ```
   Put the RTSP URL in `birdcam.env` (keeps the password out of config):
   ```
   BIRDCAM_RTSP_URL=rtsp://USER:PASSWORD@192.168.1.50:554/h264Preview_01_main
   ```
5. **Run it:** `set -a; source birdcam.env; set +a; ./venv/bin/python birdcam_multi.py`. You
   should see the configured camera names, then motion captures as a bird visits.

> Troubleshooting: a **black screen / no frames** is almost always the wrong stream path
> (try `h265Preview_01_main`) or wrong credentials. A **smeary/torn** picture over Wi-Fi
> means a weak signal — the code already forces TCP transport to limit this; move the
> camera closer to the access point if it persists.

---

## Part G — Make it run automatically (systemd)

So it starts on boot and restarts if it ever crashes:

```bash
cd ~/birdwatcher-public/camera
# Point the service at your actual path + username (edit if different):
sed -i "s|/home/pi/bird-cam|$HOME/birdwatcher-public/camera|g; s|User=pi|User=$USER|" birdcam.service
sudo cp birdcam.service /etc/systemd/system/
sudo systemctl enable --now birdcam
journalctl -u birdcam -f      # watch it live; Ctrl-C to stop watching
```

It's now running 24/7. `journalctl -u birdcam -f` is how you peek at what it's seeing.

---

## Part H — Mount it at the feeder

1. Assemble inside the enclosure: Pi on standoffs, **camera lens flush against the
   clear window**, black foam/felt around the lens, **silica gel packs** inside,
   power cable out through the **cable gland**, **vent plug** fitted.
2. Mount **3–6 ft from the feeder**, lens pointing at the feeding spot, **sun behind
   the camera**, ideally shaded. Add a small hood over the window.
3. SSH in and watch `journalctl -u birdcam -f` while a bird visits to confirm real posts.

---

## Part I — Before you ship it: remote access + monitoring

Once the camera lives at its deployment site, you'll want to (a) reach it to push
updates, and (b) know if it goes offline. Set both up **before it leaves**.

### Remote access with Tailscale (so you can SSH in from anywhere)

The Pi sits behind a home router, so plain SSH from outside won't reach it.
Tailscale is a free mesh VPN that puts the Pi and your laptop on the same private
network no matter where they are — no port forwarding, no fuss.

```bash
# On the Pi:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh        # opens a login URL; sign in with your account
tailscale ip -4                # note the 100.x.x.x address
```

Install Tailscale on your laptop too (same account): <https://tailscale.com/download>.
Then from anywhere you can reach the Pi by its Tailscale name:

```bash
ssh pi@birdcam               # via Tailscale MagicDNS, from any network
```

`--ssh` lets Tailscale handle SSH auth for devices on your tailnet, so you don't
juggle keys. It starts on boot automatically.

**To push a software update later** (new species, tweaks, etc.):

```bash
ssh pi@birdcam
cd ~/birdwatcher-public && git pull
./camera/venv/bin/pip install -r camera/requirements.txt  # only if deps changed
sudo systemctl restart birdcam
```

### Heartbeat (get alerted if it goes offline)

1. Create a free check at <https://healthchecks.io> → set its **period** to ~10 min
   and **grace** to a few min. Copy its **ping URL**.
2. Put it in `config.toml` under `[monitoring]` (or set `BIRDCAM_HEARTBEAT_URL` in
   `birdcam.env`):
   ```toml
   [monitoring]
   heartbeat_url = "https://hc-ping.com/your-uuid-here"
   heartbeat_seconds = 300
   ```
3. `sudo systemctl restart birdcam`. The camera now pings every 5 min; if pings stop
   (power cut, wifi down, crash), healthchecks.io emails you. Pings come from the
   capture loop itself, so a stalled loop trips the alert too.

---

## Tuning & troubleshooting

| Symptom | Fix |
| --- | --- |
| Too many false triggers (wind, shadows) | Raise `motion_threshold` in `config.toml`, restart: `sudo systemctl restart birdcam` |
| Misses fast birds | Lower `poll_seconds`, raise `burst_frames` |
| Wrong species guesses | Make `location_hint` more specific; raise `min_confidence` |
| Blurry photos | Make sure the lens is flush to the window; check focus in daylight |
| Hazy/washed-out photos | Add black foam around the lens to kill window reflections |
| `401` on upload | `BIRDCAM_INGEST_TOKEN` on the Pi ≠ the one in Vercel, **or** `upload_url` points at the bare domain — use the canonical `www.` host (a redirect drops the auth header) |
| Upload `400` / image error | Vercel **Blob** store not added, or `BLOB_READ_WRITE_TOKEN` missing |
| Nothing shows on site | Neon not added, or the `migrations/` files not run |
| After editing config | `sudo systemctl restart birdcam` |
