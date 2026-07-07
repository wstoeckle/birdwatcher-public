#!/usr/bin/env python3
"""Focus / optical-path calibration helper for the feeder camera.

Sweeps manual focus across a range and measures how sharp two regions are at each
lens position — the FEEDER (the subject) and a CONTROL region (something close,
high-contrast, and not backlit). It prints a table of numbers so you can pick the
best focus objectively, with no eyeballing of blurry photos and no relaying images.

Run on the Pi with the service stopped:

    sudo systemctl stop birdcam
    python3 camera/focus_calibrate.py
    # custom regions / range:
    python3 camera/focus_calibrate.py --feeder 0.43,0.45,0.29,0.17 \
        --control 0.74,0.05,0.22,0.33 --range 0.3 2.5 --steps 12

How to read it (this is the whole point):
  * A REAL best-focus distance makes a smooth hump — sharpness climbs to a clear
    peak (usually 3-10x the edges) and falls off. Set lens_position to that peak.
  * A FLAT, noisy curve (spread < ~2x, scores bouncing between adjacent steps)
    means NO focus setting helps. If even the close, high-contrast CONTROL region
    is flat, the problem is not focus or glare — it's the optical path itself
    (a film/smudge on the lens or lid, or the lens bumped out of position). That
    needs hands at the camera; a software focus value cannot fix it.
"""

from __future__ import annotations

import argparse
import time

import numpy as np
from PIL import Image


def sharpness(gray: np.ndarray) -> float:
    """Focus measure: variance of image gradients (higher = crisper)."""
    gx, gy = np.gradient(gray.astype(np.float32))
    return float((gx**2 + gy**2).var())


def region_sharpness(frame: np.ndarray, win: tuple[float, float, float, float]) -> float:
    h, w = frame.shape[:2]
    x, y, ww, hh = win
    crop = frame[int(y * h) : int((y + hh) * h), int(x * w) : int((x + ww) * w)]
    return sharpness(np.asarray(Image.fromarray(crop).convert("L")))


def parse_win(s: str) -> tuple[float, float, float, float]:
    parts = tuple(float(v) for v in s.split(","))
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("expected x,y,w,h as fractions (0-1)")
    return parts  # type: ignore[return-value]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--feeder", type=parse_win, default=(0.43, 0.45, 0.29, 0.17))
    ap.add_argument("--control", type=parse_win, default=(0.74, 0.05, 0.22, 0.33))
    ap.add_argument("--range", nargs=2, type=float, default=[0.3, 2.5], metavar=("LO", "HI"))
    ap.add_argument("--steps", type=int, default=12)
    args = ap.parse_args()

    from picamera2 import Picamera2  # apt: python3-picamera2
    from libcamera import controls

    cam = Picamera2()
    cam.configure(cam.create_still_configuration(main={"size": (2304, 1296)}))
    cam.start()
    time.sleep(2)  # let auto-exposure settle

    res: list[tuple[float, float, float]] = []
    print(f"{'lp':>6} {'dist':>8} {'feeder':>10} {'control':>10}")
    for lp in np.linspace(args.range[0], args.range[1], args.steps):
        cam.set_controls({"AfMode": controls.AfModeEnum.Manual, "LensPosition": float(lp)})
        time.sleep(0.8)  # let the lens settle
        frame = cam.capture_array()
        sf = region_sharpness(frame, args.feeder)
        sc = region_sharpness(frame, args.control)
        res.append((float(lp), sf, sc))
        print(f"{lp:6.2f} {1 / lp:7.2f}m {sf:10.1f} {sc:10.1f}")
    cam.close()

    fsp = max(r[1] for r in res) / max(1e-9, min(r[1] for r in res))
    csp = max(r[2] for r in res) / max(1e-9, min(r[2] for r in res))
    best_f = max(res, key=lambda r: r[1])
    print(f"\nfeeder spread={fsp:.1f}x   control spread={csp:.1f}x")
    if csp < 2.0:
        print("⚠ Control region is FLAT — the camera cannot focus on anything through the")
        print("  current setup. This is NOT focus or glare; it's the optical path (film on")
        print("  the lens/lid, or the lens bumped out of position). Needs hands at the")
        print("  camera: open the box, check the lens is centered/flush behind the clear")
        print("  window, wipe the lens + inside of the lid, reseat, and re-run this.")
    elif fsp < 2.0:
        print("Control focuses but the feeder stays flat — likely glare/aim on the feeder.")
    else:
        print(f"→ Sharpest feeder at lens_position={best_f[0]:.2f}. Set it in config.toml & restart.")


if __name__ == "__main__":
    main()
