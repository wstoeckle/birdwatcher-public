#!/usr/bin/env python3
"""Re-verify the sighting backlog and delete the false positives.

The cheap first-pass model confidently posted empty/wind frames as "squirrels"
AND as birds ("White-breasted Nuthatch" on an empty feeder), and sometimes filed
the wrong gallery. Verification only protects NEW captures, so this sweeps what's
ALREADY posted: it re-runs each sighting through the strong verify model and
deletes the ones it can't confirm as the SAME kind (bird/critter) it was filed
under.

Run it ON THE PI (it has the Gemini key + config), loading the secrets first:

    cd ~/birdwatcher-public/camera
    set -a; source birdcam.env; set +a
    ./venv/bin/python reverify.py                         # dry run, both galleries
    ./venv/bin/python reverify.py --kind bird             # only the bird gallery
    ./venv/bin/python reverify.py --apply --admin-pin XXXX   # actually delete rejects

`--admin-pin` is the website ADMIN_PIN (same code as the "Remove this photo"
button); or set BIRDCAM_ADMIN_PIN. People are always kept.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

import requests

from birdcam import load_config, make_client, detect_and_identify


def list_sightings(cfg, kind: str, limit: int) -> list[dict]:
    """Fetch current sightings of one kind from the website (newest first)."""
    base = cfg.upload_url.rsplit("/", 1)[0]
    headers = {}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    r = requests.get(
        f"{base}/sightings", params={"kind": kind, "limit": limit}, headers=headers, timeout=30
    )
    r.raise_for_status()
    return r.json().get("sightings", [])


def delete_sighting(cfg, sighting_id: str, admin_pin: str) -> bool:
    """Delete one sighting via the admin-gated DELETE endpoint. Never raises."""
    try:
        r = requests.delete(cfg.upload_url, json={"id": sighting_id, "pin": admin_pin}, timeout=30)
    except requests.RequestException as e:
        print(f"      ! delete request failed: {e}", file=sys.stderr)
        return False
    if r.status_code != 200:
        print(f"      ! delete failed: {r.status_code} {r.text[:120]}", file=sys.stderr)
        return False
    return bool(r.json().get("deleted"))


def verdict_str(v) -> str:
    if v is None or v.kind == "none":
        return "no animal"
    return f"{v.kind}:{v.species or '?'} {v.confidence:.0%}"


def main() -> None:
    ap = argparse.ArgumentParser(description="Re-verify and prune the sighting backlog")
    ap.add_argument("--config", type=Path, default=Path(__file__).with_name("config.toml"))
    ap.add_argument(
        "--kind", choices=["bird", "critter", "all"], default="all", help="which gallery to sweep"
    )
    ap.add_argument("--apply", action="store_true", help="actually delete rejects (default: dry run)")
    ap.add_argument("--admin-pin", default=os.environ.get("BIRDCAM_ADMIN_PIN", ""))
    ap.add_argument("--limit", type=int, default=500, help="max per kind to scan (server caps at 500)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if not cfg.upload_url:
        sys.exit("No upload_url configured (config.toml / BIRDCAM_UPLOAD_URL).")
    if args.apply and not args.admin_pin:
        sys.exit("--apply needs the website ADMIN_PIN: pass --admin-pin or set BIRDCAM_ADMIN_PIN.")

    client = make_client(cfg)
    model = cfg.verify_model or cfg.gemini_model
    kinds = ["bird", "critter"] if args.kind == "all" else [args.kind]

    sightings: list[dict] = []
    for k in kinds:
        sightings += list_sightings(cfg, k, args.limit)

    print(f"Scanning {len(sightings)} sighting(s) [{', '.join(kinds)}] with detect-first verifier '{model}'")
    print(f"({'APPLY — rejects will be deleted' if args.apply else 'dry run — nothing will be deleted'})\n")

    kept = dropped = people = failed = skipped = 0
    mismatches: list[str] = []

    for s in sightings:
        sid = str(s.get("id", ""))
        species = (s.get("species") or "").strip()
        posted_kind = "critter" if s.get("kind") == "critter" else "bird"

        # Always keep people — the whole charm is catching an actual person.
        if posted_kind == "critter" and species.lower() in ("person", "human", ""):
            people += 1
            print(f"  · keep (person)   {species or '—'}  [{sid}]")
            continue

        url = s.get("imageUrl") or ""
        try:
            jpeg = requests.get(url, timeout=30).content
        except requests.RequestException as e:
            failed += 1
            print(f"  ! fetch failed   {posted_kind}:{species}  [{sid}]: {e}", file=sys.stderr)
            continue

        device = str(s.get("device") or "")
        # RTSP-sourced sightings need the rtsp pipeline config for re-verification;
        # match against your RTSP camera's device_name here.
        scan_cfg = replace(cfg, source="rtsp") if device == "yard-reolink" else cfg
        v = detect_and_identify(scan_cfg, client, jpeg)
        if v is None:
            # No verdict (bad/empty response) — never delete on doubt.
            skipped += 1
            print(f"  ? skip (no verdict)  {posted_kind}:{species}  [{sid}]")
            continue

        # Keep if the verifier still sees the SAME kind of animal at all — even an
        # uncertain or differently-named species is a real bird/critter. We only
        # delete true empties (verifier sees nothing) and wrong-gallery misfiles,
        # so a real animal is never nuked over a species disagreement.
        if v.kind == posted_kind and v.species:
            kept += 1
            print(f"  ✓ KEEP   {posted_kind}:{species} → {v.species} ({v.confidence:.0%})  [{sid}]")
            continue

        # A confident animal of the OTHER kind = filed in the wrong gallery.
        if v.kind in ("bird", "critter") and v.species and v.confidence >= cfg.min_confidence:
            mismatches.append(f"{posted_kind}:{species} → {v.kind}:{v.species}  [{sid}]")

        dropped += 1
        action = "DELETED " if args.apply else "would del"
        print(f"  ✗ {action}  {posted_kind}:{species} → verifier saw {verdict_str(v)}  [{sid}]")
        if args.apply and not delete_sighting(cfg, sid, args.admin_pin):
            dropped -= 1
            failed += 1

    print(
        f"\nDone. kept={kept}  {'deleted' if args.apply else 'to delete'}={dropped}  "
        f"people kept={people}  skipped={skipped}  failed={failed}"
    )
    if mismatches:
        print(f"\n{len(mismatches)} were in the WRONG gallery (verifier disagreed on bird vs critter):")
        for m in mismatches:
            print(f"  · {m}")
        print("(These were removed; they aren't auto-moved to the other gallery.)")
    if not args.apply and dropped:
        print("\nDry run only — re-run with --apply --admin-pin <code> to delete the rejects.")


if __name__ == "__main__":
    main()
