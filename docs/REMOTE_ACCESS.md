# Remote access — maintain your bird cam from anywhere

Your camera lives at a feeder — maybe in your own yard, maybe at a relative's house
across the state. Either way, the last thing you want is to drive over with a
keyboard and monitor every time the WiFi hiccups or you want to push an update.

This guide sets up two tools that, together, let you fix the camera from your couch:

- **Tailscale** — the **network path**. A free VPN that lets you SSH into the Pi
  from anywhere, as if it were on your own network.
- **An AI coding agent on the Pi** (Claude Code or Codex CLI) — the **hands**. Once
  you can reach the Pi, an on-device agent lets you fix things by *describing the
  problem* instead of remembering the exact commands.

Set both up **before the camera leaves for its final home**.

> Throughout, `pi@birdcam` stands for your Pi's username and hostname — substitute
> whatever you chose when flashing the SD card.

---

## Tailscale — reach the Pi from anywhere

The Pi sits behind a home router, so plain SSH from the outside world can't reach
it (there's no public address, and you don't want to set up port forwarding).
[Tailscale](https://tailscale.com) is a free mesh VPN: it puts your Pi and your
laptop on the same private network no matter where either one physically is. No
port forwarding, no firewall surgery.

**On the Pi** (over SSH on the local network):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

`sudo tailscale up --ssh` prints a login URL — open it, sign in, and the Pi joins
your private network ("tailnet"). The `--ssh` flag lets Tailscale handle SSH
authentication for devices on your tailnet, so you don't juggle SSH keys. It starts
automatically on boot.

**On your laptop and phone**, install Tailscale too and sign in with the **same
account**: [tailscale.com/download](https://tailscale.com/download).

Now, from any network on earth:

```bash
ssh pi@birdcam
```

That resolves over Tailscale's **MagicDNS** to the Pi wherever it is.

> **If `birdcam` won't resolve**, MagicDNS may be off. Find the Pi's Tailscale IP
> (it starts with `100.`) by running `tailscale ip -4` on the Pi, then use it
> directly: `ssh pi@100.x.x.x`. You can also enable MagicDNS in the Tailscale admin
> console.
>
> **Gotcha:** if you ever **reflash the SD card**, the Pi is a fresh machine to
> Tailscale — you'll re-run `sudo tailscale up --ssh` and re-approve it into your
> tailnet.

---

## An AI coding agent on the Pi — the hands

Reaching the Pi is half the battle. The other half is *doing* something once you're
in — and that's where remembering `journalctl` incantations at 9pm gets old. Put an
AI coding agent on the Pi and you can just tell it what's wrong.

**Install Node 20+**, then Claude Code:

```bash
# Node 20+ via NodeSource (or use nvm if you prefer):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

npm install -g @anthropic-ai/claude-code
```

Then run it once inside the repo to log in:

```bash
cd ~/birdwatcher-public
claude
```

After that, your whole maintenance loop is:

```bash
ssh pi@birdcam
claude
```

…and then you *talk to it*:

- "The camera stopped posting — check `journalctl -u birdcam` and fix whatever's
  wrong."
- "Pull the latest code and restart the service."
- "Photos have been blurry since yesterday — run the focus calibration and tell me
  what you find."

The agent reads the repo's [`CLAUDE.md`](../CLAUDE.md), which gives it project
context — where the service runs, how to restart it, the conventions — so it acts
with real understanding of this specific setup rather than guessing.

> Prefer OpenAI's **Codex CLI**? It works the same way — install it on the Pi, run
> it in `~/birdwatcher-public`, and describe the problem. Either agent is fine.

---

## The manual fallback

You should know these commands even with an agent on board — the agent runs them
too, and sometimes you'll want to do it yourself. The routine update loop:

```bash
ssh pi@birdcam
cd ~/birdwatcher-public && git pull
./camera/venv/bin/pip install -r camera/requirements.txt   # only if deps changed
sudo systemctl restart birdcam
journalctl -u birdcam -f                                   # watch it come back
```

`journalctl -u birdcam -f` is your window into what the camera is seeing right now —
motion events, identifications, uploads, and any errors. `Ctrl-C` stops watching
(it doesn't stop the camera).

---

## Uptime monitoring — know when it goes dark

A camera you can't see is a camera you can't trust. Two safety nets:

### Heartbeat alerts (healthchecks.io)

Get emailed if the camera stops checking in:

1. Create a free check at [healthchecks.io](https://healthchecks.io). Set its
   **period** a bit longer than your heartbeat interval and copy its **ping URL**.
2. Put it in `config.toml` under `[monitoring]` (or set `BIRDCAM_HEARTBEAT_URL` in
   `birdcam.env`):

   ```toml
   [monitoring]
   heartbeat_url = "https://hc-ping.com/your-uuid-here"
   heartbeat_seconds = 300
   ```

3. `sudo systemctl restart birdcam`.

The camera now pings every few minutes. If the pings stop — power cut, WiFi down,
crashed process — healthchecks.io emails you. Because the ping comes from the
capture loop itself, a *stalled* loop trips the alert too, not just a dead machine.

### Network self-heal (netwatch)

For a WiFi-only camera, the `netwatch` watchdog automatically recovers from network
drops so you don't have to. Install it on the Pi:

```bash
cd ~/birdwatcher-public/camera
sudo cp netwatch.sh /usr/local/sbin/ && sudo chmod +x /usr/local/sbin/netwatch.sh
sudo cp netwatch.service netwatch.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now netwatch.timer
```

`netwatch.timer` runs the check every couple of minutes. Its logic: if the internet
has been unreachable for **5 minutes**, it bounces WiFi (restarts NetworkManager);
if it's still down after **20 minutes**, it reboots the Pi. The failure timestamp
lives in a temporary file that clears the moment connectivity returns, so it won't
get stuck in a reboot loop while everything's healthy.

---

## Where to go next

- [`GETTING_STARTED.md`](./GETTING_STARTED.md) — the full end-to-end walkthrough.
- [`../camera/SETUP.md`](../camera/SETUP.md) — the deep Pi reference, including the
  original Tailscale + heartbeat setup steps.
- [`HARDWARE.md`](./HARDWARE.md) — build options and what to buy.
