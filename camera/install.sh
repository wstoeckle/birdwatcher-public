#!/usr/bin/env bash
# One-time setup on a Raspberry Pi (Raspberry Pi OS, Bookworm or newer).
#   curl/clone this folder to /home/pi/bird-cam, then:  bash install.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Installing system camera library (python3-picamera2)…"
sudo apt-get update
sudo apt-get install -y python3-picamera2 python3-venv

echo "==> Creating virtualenv (with access to system picamera2)…"
python3 -m venv --system-site-packages venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

if [ ! -f config.toml ]; then
  cp config.example.toml config.toml
  echo "==> Created config.toml — edit it with your settings."
fi

if [ ! -f birdcam.env ]; then
  cat > birdcam.env <<'EOF'
# Secrets for the systemd service (chmod 600). Fill these in.
BIRDCAM_GEMINI_API_KEY=
BIRDCAM_UPLOAD_URL=https://your-domain.example/api/sightings
BIRDCAM_INGEST_TOKEN=
# Only for a network/IP camera (set camera.source = "rtsp", or add a [[cameras]]
# entry with rtsp_url_env = "BIRDCAM_RTSP_URL"). Keeps the camera password out of
# config.toml. Leave blank when using only the Pi Camera.
# Example: rtsp://USER:PASSWORD@192.168.1.50:554/h264Preview_01_main
BIRDCAM_RTSP_URL=
EOF
  chmod 600 birdcam.env
  echo "==> Created birdcam.env — fill in your secrets, then chmod 600 is already set."
fi

echo
echo "Next steps:"
echo "  1. Edit config.toml and birdcam.env."
echo "  2. Test once:   ./venv/bin/python birdcam.py --test-image sample.jpg"
echo "  3. Install service:"
echo "       sudo cp birdcam.service /etc/systemd/system/"
echo "       sudo systemctl enable --now birdcam"
echo "       journalctl -u birdcam -f   # watch it work"
