#!/usr/bin/env python3
"""EXPERIMENT (not used by the live camera): test better bounding boxes + crop-level
diagnosis on known sightings, so we can validate the approach before rewriting the
capture pipeline.

Today the camera asks Gemini for a freeform [x,y,w,h] box, which it's bad at (boxes
land off the animal). Gemini has a *native* detection format — box_2d =
[ymin,xmin,ymax,xmax], 0-1000 — that it's trained for, and which returns an empty
list on empty frames. This script compares that, then crops to each detected box
and re-classifies the crop.

Run on the Pi (needs the Gemini key):
    cd ~/birdwatcher-public/camera
    set -a; source birdcam.env; set +a
    ./venv/bin/python boxtest.py --ids 244,247,220

Paste the output back — the raw box_2d coords let us render the boxes and judge
accuracy, and the crop verdicts show whether diagnosis improves.
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import requests
from PIL import Image

from birdcam import load_config, make_client
from google.genai import types as genai_types

DETECT_PROMPT = """Detect every real bird, mammal, or person ACTUALLY VISIBLE in this
backyard bird-feeder photo. Most frames are empty (just wind in the leaves) — if you
see no animal or person, return []. Do not guess from the setting.

Return ONLY a JSON array, one object per animal/person actually present:
{"box_2d": [ymin, xmin, ymax, xmax], "label": "<specific common name>", "confidence": <0-1>}
box_2d values are integers 0-1000 (top-left origin, y first then x)."""

CROP_PROMPT = """This is a zoomed-in crop from a bird-feeder camera. What is in it?
Reply ONLY JSON: {"present": true|false, "kind": "bird"|"critter"|"none",
"species": "<name or empty>", "confidence": <0-1>}.
Use present=false / kind="none" if it's just feeder, seed, leaves, bark, grass, sky,
or blur with no actual animal."""


def gen_json(client, model, jpeg, prompt):
    resp = client.models.generate_content(
        model=model,
        contents=[genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), prompt],
        config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
    )
    txt = (resp.text or "").strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        return {"_unparsed": txt[:200]}


def fetch_sighting(cfg, sid):
    base = cfg.upload_url.rsplit("/", 1)[0]
    headers = {}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    for kind in ("critter", "bird"):
        r = requests.get(
            f"{base}/sightings", params={"kind": kind, "limit": 500}, headers=headers, timeout=30
        )
        for s in r.json().get("sightings", []):
            if str(s.get("id")) == str(sid):
                return s, requests.get(s["imageUrl"], timeout=30).content
    return None, None


def crop_to_box(jpeg, box_2d, pad=0.15):
    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    w, h = im.size
    ymin, xmin, ymax, xmax = [v / 1000 for v in box_2d]
    bw, bh = xmax - xmin, ymax - ymin
    x0 = max(0.0, xmin - bw * pad) * w
    y0 = max(0.0, ymin - bh * pad) * h
    x1 = min(1.0, xmax + bw * pad) * w
    y1 = min(1.0, ymax + bh * pad) * h
    if x1 - x0 < 8 or y1 - y0 < 8:  # guard against a degenerate box
        return None
    buf = io.BytesIO()
    im.crop((int(x0), int(y0), int(x1), int(y1))).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description="Box-format + crop-diagnosis experiment")
    ap.add_argument("--config", type=Path, default=Path(__file__).with_name("config.toml"))
    ap.add_argument("--ids", required=True, help="comma-separated sighting ids, e.g. 244,247,220")
    args = ap.parse_args()

    cfg = load_config(args.config)
    client = make_client(cfg)
    models = [("flash", cfg.gemini_model)]
    if cfg.verify_model and cfg.verify_model != cfg.gemini_model:
        models.append(("pro", cfg.verify_model))

    for sid in [s.strip() for s in args.ids.split(",") if s.strip()]:
        s, jpeg = fetch_sighting(cfg, sid)
        posted = f"{s.get('kind')}:{s.get('species')}" if s else "?"
        print(f"\n===== #{sid}  (posted as {posted}) =====")
        if jpeg is None:
            print("  (sighting not found)")
            continue
        for name, model in models:
            det = gen_json(client, model, jpeg, DETECT_PROMPT)
            print(f"  [{name} detect: {model}] {json.dumps(det)}")
            if not isinstance(det, list):
                continue
            for i, obj in enumerate(det):
                box = obj.get("box_2d") if isinstance(obj, dict) else None
                if not (isinstance(box, list) and len(box) == 4):
                    continue
                crop = crop_to_box(jpeg, box)
                if crop is None:
                    continue
                ver = gen_json(client, model, crop, CROP_PROMPT)
                print(f"      crop[{i}] box_2d={box} -> {json.dumps(ver)}")


if __name__ == "__main__":
    main()
