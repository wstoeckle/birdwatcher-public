#!/usr/bin/env python3
"""bird-cam capture service.

Watches the camera, waits for motion, grabs the sharpest frame, asks Gemini
"is this a bird? which one?", and (if so) posts the photo + facts to the website.

Designed to run on a Raspberry Pi with a Camera Module, but you can develop and
test the whole AI + upload pipeline on any computer with:

    python3 birdcam.py --test-image some_bird.jpg

Config comes from config.toml (see config.example.toml). Env vars override:
    BIRDCAM_GEMINI_API_KEY, BIRDCAM_UPLOAD_URL, BIRDCAM_INGEST_TOKEN
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import threading
import time
import tomllib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests
from PIL import Image

try:  # google-genai is the unified Gemini SDK
    from google import genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover - only matters at runtime on the Pi
    genai = None
    genai_types = None


# ── Config ───────────────────────────────────────────────────────────────────


@dataclass
class Config:
    gemini_api_key: str
    gemini_model: str
    verify_model: str
    upload_url: str
    ingest_token: str
    device_name: str
    motion_threshold: float
    motion_metric: str
    cooldown_seconds: float
    min_confidence: float
    poll_seconds: float
    burst_frames: int
    capture_poll_seconds: float
    source: str
    rtsp_url: str
    lens_position: float
    rotation: int
    jpeg_max_width: int
    jpeg_quality: int
    min_detection_area: float
    rtsp_night_min_detection_area: float
    max_detection_span: float
    rare_species_min_count: int
    rare_bird_min_confidence: float
    rare_critter_min_confidence: float
    species_prior_limit: int
    species_prior_ttl_seconds: float
    correction_prior_limit: int
    correction_prior_ttl_seconds: float
    ebird_api_key: str
    ebird_lat: float
    ebird_lng: float
    ebird_dist_km: int
    ebird_days_back: int
    ebird_prior_limit: int
    ebird_prior_ttl_seconds: float
    max_subjects_per_frame: int
    location_hint: str
    heartbeat_url: str
    heartbeat_seconds: float


def load_config(path: Path) -> Config:
    raw: dict = {}
    if path.exists():
        raw = tomllib.loads(path.read_text())

    cam = raw.get("camera", {})
    gem = raw.get("gemini", {})
    web = raw.get("website", {})
    mon = raw.get("monitoring", {})

    return Config(
        gemini_api_key=os.environ.get("BIRDCAM_GEMINI_API_KEY", gem.get("api_key", "")),
        gemini_model=gem.get("model", "gemini-2.5-flash"),
        verify_model=gem.get("verify_model", "gemini-2.5-pro"),
        upload_url=os.environ.get("BIRDCAM_UPLOAD_URL", web.get("upload_url", "")),
        ingest_token=os.environ.get("BIRDCAM_INGEST_TOKEN", web.get("ingest_token", "")),
        device_name=cam.get("device_name", "backyard-feeder"),
        motion_threshold=float(cam.get("motion_threshold", 6.0)),
        motion_metric=str(cam.get("motion_metric", "auto")).strip().lower(),
        cooldown_seconds=float(cam.get("cooldown_seconds", 180)),
        poll_seconds=float(cam.get("poll_seconds", 0.5)),
        burst_frames=int(cam.get("burst_frames", 5)),
        capture_poll_seconds=float(cam.get("capture_poll_seconds", 10.0)),
        source=str(cam.get("source", "picamera2")).strip().lower(),
        rtsp_url=os.environ.get("BIRDCAM_RTSP_URL", cam.get("rtsp_url", "")),
        lens_position=float(cam.get("lens_position", 0.0)),
        rotation=int(cam.get("rotation", 0)),
        jpeg_max_width=int(cam.get("jpeg_max_width", 1600)),
        jpeg_quality=int(cam.get("jpeg_quality", 85)),
        min_confidence=float(gem.get("min_confidence", 0.6)),
        min_detection_area=float(gem.get("min_detection_area", 0.006)),
        rtsp_night_min_detection_area=float(gem.get("rtsp_night_min_detection_area", 0.08)),
        max_detection_span=float(gem.get("max_detection_span", 0.65)),
        rare_species_min_count=int(gem.get("rare_species_min_count", 3)),
        rare_bird_min_confidence=float(gem.get("rare_bird_min_confidence", 0.92)),
        rare_critter_min_confidence=float(gem.get("rare_critter_min_confidence", 0.9)),
        species_prior_limit=int(gem.get("species_prior_limit", 12)),
        species_prior_ttl_seconds=float(gem.get("species_prior_ttl_seconds", 6 * 60 * 60)),
        correction_prior_limit=int(gem.get("correction_prior_limit", 8)),
        correction_prior_ttl_seconds=float(gem.get("correction_prior_ttl_seconds", 6 * 60 * 60)),
        ebird_api_key=os.environ.get("BIRDCAM_EBIRD_API_KEY", gem.get("ebird_api_key", "")),
        ebird_lat=float(gem.get("ebird_lat", 0.0)),
        ebird_lng=float(gem.get("ebird_lng", 0.0)),
        ebird_dist_km=int(gem.get("ebird_dist_km", 25)),
        ebird_days_back=int(gem.get("ebird_days_back", 14)),
        ebird_prior_limit=int(gem.get("ebird_prior_limit", 40)),
        ebird_prior_ttl_seconds=float(gem.get("ebird_prior_ttl_seconds", 6 * 60 * 60)),
        max_subjects_per_frame=int(gem.get("max_subjects_per_frame", 1)),
        location_hint=gem.get("location_hint", ""),
        heartbeat_url=os.environ.get("BIRDCAM_HEARTBEAT_URL", mon.get("heartbeat_url", "")),
        heartbeat_seconds=float(mon.get("heartbeat_seconds", 300)),
    )


# ── Camera ───────────────────────────────────────────────────────────────────


class PiCameraSource:
    """Wraps picamera2. Yields RGB numpy frames."""

    def __init__(self, lens_position: float = 0.0) -> None:
        from picamera2 import Picamera2  # imported lazily; apt: python3-picamera2

        self.cam = Picamera2()
        config = self.cam.create_still_configuration(main={"size": (2304, 1296)})
        self.cam.configure(config)
        self.cam.start()
        time.sleep(2)  # let auto-exposure / focus settle
        if lens_position > 0:
            # Lock focus to a fixed distance (dioptres = 1 / metres). Required for
            # window/enclosure mounts: continuous autofocus hunts on the glass right
            # in front of the lens and comes back soft.
            try:
                from libcamera import controls as _controls

                self.cam.set_controls(
                    {"AfMode": _controls.AfModeEnum.Manual, "LensPosition": lens_position}
                )
                time.sleep(1)  # let the lens move and settle
            except Exception as e:  # pragma: no cover - hardware/runtime only
                print(f"  ! could not set fixed focus ({lens_position}): {e}", file=sys.stderr)

    def frame(self) -> np.ndarray:
        return self.cam.capture_array()


def _redact_rtsp(url: str) -> str:
    """Hide user:pass when printing an rtsp://user:pass@host URL."""
    return re.sub(r"//[^@/]+@", "//***:***@", url)


class RtspCameraSource:
    """Pulls frames from a network (RTSP/ONVIF) camera, e.g. a Reolink. Use this
    instead of the Pi Camera Module for an off-the-shelf weatherproof camera:
    fixed-focus and factory-sealed, so there's no lens/enclosure calibration.

    A background thread keeps only the latest frame, so the motion loop reads a
    near-live image instead of a stale, buffered one, and it reconnects on its own
    if the stream drops (a Wi-Fi blip must not take the camera down)."""

    def __init__(self, url: str) -> None:
        try:
            import cv2  # imported lazily; pip: opencv-python-headless
        except ImportError:
            sys.exit(
                "camera.source = 'rtsp' needs OpenCV. Install it:\n"
                "  ./venv/bin/pip install opencv-python-headless"
            )

        self._cv2 = cv2
        self._url = url
        # Force TCP transport: over Wi-Fi, RTSP-over-UDP drops packets and the
        # picture smears/tears. Must be set before VideoCapture opens the stream.
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

        self._lock = threading.Lock()
        self._latest: np.ndarray | None = None
        self._skipped_corrupt = 0
        self._stop = threading.Event()
        self._cap = self._open()
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()

        # Wait briefly for the first frame so the caller never gets a None.
        deadline = time.monotonic() + 15
        while self._latest is None and time.monotonic() < deadline:
            time.sleep(0.1)
        if self._latest is None:
            sys.exit(
                f"No frames from RTSP stream after 15s: {_redact_rtsp(self._url)}\n"
                "Check: the stream path (Reolink main stream is h264Preview_01_main; "
                "some H.265 models use h265Preview_01_main), the username/password, "
                "and that the camera's IP is reachable from the Pi."
            )

    def _open(self):
        cap = self._cv2.VideoCapture(self._url, self._cv2.CAP_FFMPEG)
        # Keep OpenCV's internal buffer tiny so reads return near-live frames.
        try:
            cap.set(self._cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:  # pragma: no cover - backend-dependent
            pass
        return cap

    def _reader(self) -> None:
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                # Stream dropped — back off, reopen, keep going.
                time.sleep(1.0)
                self._cap.release()
                self._cap = self._open()
                continue
            # OpenCV decodes BGR; the rest of the pipeline expects RGB (picamera2
            # returns RGB). Convert here so frames look identical to either source.
            rgb = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2RGB)
            if looks_like_rtsp_smear(rgb):
                self._skipped_corrupt += 1
                if self._skipped_corrupt == 1 or self._skipped_corrupt % 30 == 0:
                    print(
                        f"  ! skipped {self._skipped_corrupt} corrupt RTSP frame(s)",
                        file=sys.stderr,
                    )
                continue
            with self._lock:
                self._latest = rgb

    def frame(self) -> np.ndarray:
        with self._lock:
            if self._latest is None:  # pragma: no cover - only mid-reconnect
                raise RuntimeError("RTSP stream produced no frame")
            return self._latest.copy()  # copy: caller mutates while reader writes

    def close(self) -> None:
        self._stop.set()
        self._cap.release()


def make_camera(cfg: Config):
    """Build the configured frame source. Both sources expose .frame() -> RGB array."""
    if cfg.source == "rtsp":
        if not cfg.rtsp_url:
            sys.exit(
                "camera.source = 'rtsp' but no stream URL. Set BIRDCAM_RTSP_URL in "
                "birdcam.env, or camera.rtsp_url in config.toml."
            )
        print(f"Using RTSP camera: {_redact_rtsp(cfg.rtsp_url)}")
        return RtspCameraSource(cfg.rtsp_url)
    if cfg.source not in ("", "picamera2", "pi"):
        sys.exit(f"Unknown camera.source '{cfg.source}'. Use 'picamera2' or 'rtsp'.")
    return PiCameraSource(cfg.lens_position)


def looks_like_rtsp_smear(frame: np.ndarray) -> bool:
    """Detect the vertical-band corruption OpenCV can return after RTSP decode errors."""
    gray = Image.fromarray(frame).convert("L").resize((320, 240))
    arr = np.asarray(gray, dtype=np.float32)
    bottom = arr[int(arr.shape[0] * 0.45) :]
    y_delta = float(np.abs(np.diff(bottom, axis=0)).mean())
    row_std = float(bottom.std(axis=1).mean())
    col_std = float(bottom.std(axis=0).mean())
    if y_delta < 0.8 and row_std > 12 and col_std < row_std * 0.15:
        return True

    # Some RTSP failures preserve a normal-looking top strip but smear the lower
    # half into vertical bands. Those frames fool object detection badly at night.
    lower = arr[int(arr.shape[0] * 0.35) :]
    lower_y_delta = float(np.abs(np.diff(lower, axis=0)).mean())
    lower_row_std = float(lower.std(axis=1).mean())
    lower_col_std = float(lower.std(axis=0).mean())
    return lower_y_delta < 0.2 and lower_row_std > 15 and lower_col_std < 2.0


def jpeg_looks_like_rtsp_smear(jpeg: bytes) -> bool:
    try:
        frame = np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB"))
    except Exception:
        return True
    return looks_like_rtsp_smear(frame)


def is_ir_night_frame(jpeg: bytes) -> bool:
    """True for monochrome IR night shots from the Reolink."""
    try:
        arr = np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB").resize((160, 120)))
    except Exception:
        return False
    channels = arr.astype(np.float32)
    rg = np.abs(channels[:, :, 0] - channels[:, :, 1]).mean()
    gb = np.abs(channels[:, :, 1] - channels[:, :, 2]).mean()
    return float(rg + gb) < 4.0


def to_grayscale_small(frame: np.ndarray) -> np.ndarray:
    """Downscale + grayscale for cheap motion comparison."""
    img = Image.fromarray(frame).convert("L").resize((160, 90))
    return np.asarray(img, dtype=np.float32)


# Side of the square tiles (in pixels of the 160x90 motion image) the "localized"
# metric pools over. ~10px averages ~100 pixels per tile, smoothing sensor/IR
# noise while staying small enough that a distant subject lights up its own tile.
_MOTION_TILE = 10


def resolve_motion_metric(metric: str, source: str) -> str:
    """Turn the configured motion_metric into a concrete one.

    'auto' (the default) picks 'localized' for wide-view network/RTSP cameras
    (e.g. a Reolink watching a yard) and 'frame' for the close-up Pi feeder cam.
    An explicit 'frame' or 'localized' is always honored.
    """
    m = (metric or "auto").strip().lower()
    if m in ("frame", "localized"):
        return m
    return "localized" if source == "rtsp" else "frame"


def motion_score(prev_small: np.ndarray, small: np.ndarray, metric: str = "frame") -> float:
    """Average pixel change (0-255) used to gate captures, compared to
    motion_threshold.

    'frame' averages the change over the whole image (the original behavior):
    great for a feeder where the subject is close and fills much of the frame.

    'localized' pools the change into small tiles and returns the busiest tile.
    A small, distant animal in a wide scene only moves a handful of pixels, so a
    whole-frame average barely budges and never trips the threshold; the busiest
    tile, by contrast, lights up. A frame-wide change (a passing cloud, IR gain
    shifting) spreads evenly across every tile, so it scores the same as 'frame'
    and does not over-trigger. Both metrics share the 0-255 scale, so a given
    motion_threshold keeps its meaning across the two.
    """
    diff = np.abs(small - prev_small)
    if metric != "localized":
        return float(diff.mean())
    h, w = diff.shape
    ny, nx = h // _MOTION_TILE, w // _MOTION_TILE
    if ny == 0 or nx == 0:  # frame smaller than a tile — fall back to whole-frame
        return float(diff.mean())
    # Crop to a whole number of tiles, then mean-pool each tile and take the max.
    tiles = diff[: ny * _MOTION_TILE, : nx * _MOTION_TILE].reshape(
        ny, _MOTION_TILE, nx, _MOTION_TILE
    )
    return float(tiles.mean(axis=(1, 3)).max())


def sharpness(frame: np.ndarray) -> float:
    """Focus measure: variance of image gradients (higher = crisper)."""
    g = np.asarray(Image.fromarray(frame).convert("L"), dtype=np.float32)
    gx, gy = np.gradient(g)
    return float((gx**2 + gy**2).var())


def to_jpeg_bytes(
    frame: np.ndarray, max_width: int = 1600, quality: int = 85, rotation: int = 0
) -> bytes:
    img = Image.fromarray(frame)
    if rotation in (90, 180, 270):
        img = img.transpose(
            {
                90: Image.Transpose.ROTATE_90,
                180: Image.Transpose.ROTATE_180,
                270: Image.Transpose.ROTATE_270,
            }[rotation]
        )
    if img.width > max_width:
        h = round(img.height * max_width / img.width)
        img = img.resize((max_width, h))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def rotate_frame(frame: np.ndarray, rotation: int) -> np.ndarray:
    """Rotate a frame upright in numpy, matching to_jpeg_bytes's JPEG rotation
    exactly (90 = counterclockwise, like PIL's Transpose.ROTATE_90)."""
    if rotation in (90, 180, 270):
        return np.ascontiguousarray(np.rot90(frame, rotation // 90))
    return frame


@dataclass
class Capture:
    """One motion event's frames, packaged for the pipeline (already rotated
    upright). `jpeg` is the modest upload-size JPEG — what gets posted, and what
    detection runs on. `full` is the native-resolution frame that classifier crops
    are cut from: the fine field marks that separate lookalike species survive at
    native res but not in the downscaled, recompressed upload. `alts` are the other
    burst frames, kept so a borderline subject can be judged from several poses."""

    jpeg: bytes
    full: np.ndarray | None = None
    alts: list[np.ndarray] = field(default_factory=list)


def make_capture(cfg: Config, frames: list[np.ndarray]) -> Capture:
    """Rotate a burst upright, pick the sharpest frame as primary, and package it."""
    rotated = [rotate_frame(f, cfg.rotation) for f in frames]
    order = sorted(range(len(rotated)), key=lambda i: sharpness(rotated[i]), reverse=True)
    primary = rotated[order[0]]
    jpeg = to_jpeg_bytes(primary, max_width=cfg.jpeg_max_width, quality=cfg.jpeg_quality)
    return Capture(jpeg=jpeg, full=primary, alts=[rotated[i] for i in order[1:]])


# ── Gemini identification ──────────────────────────────────────────────────────


def _gen_config(schema: dict | None = None):
    """Generation config for classification calls. Low temperature keeps repeated
    IDs of the same photo from flip-flopping (the default 1.0 adds run-to-run
    variance a classifier doesn't want); response_schema makes the API enforce the
    JSON shape instead of us hoping the model follows the prompt."""
    kwargs: dict = {"response_mime_type": "application/json", "temperature": 0.2}
    if schema is not None:
        kwargs["response_schema"] = schema
    return genai_types.GenerateContentConfig(**kwargs)


def date_context(now: datetime | None = None) -> str:
    """Tell the model what day it is. Plumage and species presence are strongly
    seasonal (breeding vs winter plumage, juveniles in summer, migrants), and
    without a date the model defaults to field-guide adult-male plumage.
    Seasons are Northern-Hemisphere (fine for this fleet)."""
    now = now or datetime.now()
    season, note = {
        12: ("winter", "expect winter plumage and cold-season visitors"),
        1: ("winter", "expect winter plumage and cold-season visitors"),
        2: ("winter", "expect winter plumage and cold-season visitors"),
        3: ("spring", "expect breeding plumage and spring migrants passing through"),
        4: ("spring", "expect breeding plumage and spring migrants passing through"),
        5: ("spring", "expect breeding plumage and spring migrants passing through"),
        6: ("summer", "expect recently fledged juveniles and worn or molting adult plumage"),
        7: ("summer", "expect recently fledged juveniles and worn or molting adult plumage"),
        8: ("summer", "expect recently fledged juveniles and worn or molting adult plumage"),
        9: ("fall", "expect non-breeding plumage, confusing immatures, and fall migrants"),
        10: ("fall", "expect non-breeding plumage, confusing immatures, and fall migrants"),
        11: ("fall", "expect non-breeding plumage, confusing immatures, and fall migrants"),
    }[now.month]
    return f"Today is {now:%B %d, %Y} ({season}): {note}."


# Appended to prompts when the frame is a monochrome IR night shot. Without this
# the model invents colors from IR luminance — how a grackle becomes a "black-morph
# squirrel" and a gray fox becomes a red one.
IR_NIGHT_NOTE = (
    "This photo is a monochrome infrared night capture: colors are NOT real, so do "
    "not use color as a field mark. Judge by shape, size, posture, and light/dark "
    "markings, and expect nocturnal visitors (raccoon, opossum, skunk, fox, deer, "
    "owls) more than daytime songbirds."
)

PROMPT = """You are a wildlife spotter for a friendly backyard bird feeder camera.

This camera is triggered by motion, and most triggers are FALSE ALARMS: wind
moving the leaves and branches, changing light, or a swaying feeder — with NO
animal present. Your default answer is "none". Only report a bird or critter when
you can actually SEE the animal's body in THIS photo.

First, find the animal. In "evidence", describe where in the frame the animal is
and what body parts you can see (e.g. "small brown bird perched on the feeder
port, left side"). If you cannot point to an actual animal — if you're inferring
one only because this is a feeder, or you see just the feeder, tree, lawn,
tractor, leaves, blur, or an empty scene — then it is "none". The presence of a
feeder is NOT evidence of an animal. Do NOT guess what "usually" visits a feeder.

When you do see an animal or person, also give a tight bounding box around it in
"box" as [x, y, width, height], each a fraction 0–1 of the image with (x, y) at
the box's top-left corner. Use null for "box" when kind is "none" or you can't
localize the subject.

Then classify into exactly one "kind":

- "bird": a wild bird you can clearly see. Identify the most likely species
  (common + scientific name) and give 2-3 delightful, accurate fun facts a family
  would enjoy. If you see a bird but are unsure of the exact species, give your
  best guess and lower the confidence.
- "critter": a non-bird animal OR a person you can clearly see at/near the feeder.
  Name the SPECIFIC thing you actually see (open-ended, not a fixed list): put a
  friendly display name in "species" (e.g. "Eastern Gray Squirrel", "Raccoon",
  "Red Fox", "White-tailed Deer", "Person") and a short, singular, lowercase tally
  label in "category" (e.g. "squirrel", "raccoon", "fox", "deer", "human"). Only
  identify animals plausibly found in coastal Rhode Island / southern New England.
  A couple of fun facts are welcome here too.
- "none": no animal you can actually see — an empty feeder, a hand, blur, leaves,
  wind, or an empty scene. This is the common case; use it freely.

Calibrate "confidence" honestly: it is your certainty that the animal is really
there AND is what you named. Never report high confidence for an animal you
cannot clearly see. When in doubt, choose "none".

Respond ONLY with JSON matching exactly this shape:
{
  "kind": "bird" | "critter" | "none",
  "evidence": string,           // where the animal is + visible body parts; "" if none
  "species": string,            // bird common name, or critter display name; "" if none
  "category": string,           // critter tally label; "" for birds and none
  "scientific_name": string,    // "" if unknown
  "confidence": number,         // 0.0–1.0
  "box": [number, number, number, number] | null,  // [x,y,w,h] fractions 0–1, top-left origin; null if none
  "fun_facts": string[]         // 2-3 short facts for birds (a couple for critters); [] for none
}"""


@dataclass
class Identification:
    kind: str  # "bird" | "critter" | "none"
    species: str
    category: str
    scientific_name: str
    confidence: float
    fun_facts: list[str]
    evidence: str = ""  # where the animal is in frame; for logging, not posted
    box: list[float] | None = None  # [x, y, w, h] fractions 0–1 around the subject
    # Ranked "what else could it be" list from the classifier (dicts with species,
    # scientific_name, confidence, field_marks). Used for prior-aware tiebreaks;
    # not posted to the website.
    candidates: list[dict] = field(default_factory=list)


def _parse_box(raw) -> list[float] | None:
    """Validate Gemini's bounding box: four numbers, each clamped to 0–1. Anything
    malformed → None (the website just won't offer a 'show me' button)."""
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        return [min(1.0, max(0.0, float(v))) for v in raw]
    except (TypeError, ValueError):
        return None


def identify(cfg: Config, client, jpeg: bytes, model: str | None = None) -> Identification | None:
    model = model or cfg.gemini_model
    prompt = PROMPT + "\n\n" + date_context()
    if cfg.location_hint:
        prompt += f"\n\nThe feeder is located in: {cfg.location_hint}. Prefer species found there."

    resp = client.models.generate_content(
        model=model,
        contents=[
            genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"),
            prompt,
        ],
        config=_gen_config(),
    )
    report_usage(cfg, resp, model)  # track token spend (best-effort)
    text = (resp.text or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        print(f"  ! could not parse Gemini response: {text[:120]}", file=sys.stderr)
        return None
    # Occasionally Gemini returns a JSON array instead of the object we asked for;
    # take the first object if so, else give up (don't crash the capture loop).
    if isinstance(data, list):
        data = next((d for d in data if isinstance(d, dict)), None)
    if not isinstance(data, dict):
        print(f"  ! unexpected Gemini response shape: {text[:120]}", file=sys.stderr)
        return None
    return Identification(
        kind=str(data.get("kind", "")).strip().lower(),
        species=str(data.get("species", "")).strip(),
        category=str(data.get("category", "")).strip().lower(),
        scientific_name=str(data.get("scientific_name", "")).strip(),
        confidence=float(data.get("confidence", 0) or 0),
        fun_facts=[str(f) for f in data.get("fun_facts", []) if str(f).strip()],
        evidence=str(data.get("evidence", "")).strip(),
        box=_parse_box(data.get("box")),
    )


def verify_detection(cfg: Config, client, jpeg: bytes, first: Identification) -> Identification | None:
    """Second opinion on a flash detection, from a stronger model. Cheap flash runs
    on every motion frame and confidently hallucinates animals in empty/wind shots
    (and sometimes calls a bird a squirrel); the verifier re-identifies the SAME
    photo independently. Returns the verifier's read (more trustworthy — use it as
    the source of truth, so a bird mislabeled a squirrel gets corrected) or None to
    drop a false positive. Only runs on positives, so the pro cost stays small."""
    if not cfg.verify_model or cfg.verify_model == cfg.gemini_model:
        return first  # verification disabled → trust the first pass

    second = identify(cfg, client, jpeg, model=cfg.verify_model)
    if second is None:
        # Verifier didn't answer (transient error). Fail OPEN — don't lose a real
        # sighting over a blip; the first pass already cleared the confidence bar.
        print(f"  ? verifier ({cfg.verify_model}) gave no answer — keeping first pass")
        return first
    if second.kind not in ("bird", "critter") or second.confidence < cfg.min_confidence:
        why = f" — {second.evidence}" if second.evidence else ""
        print(
            f"  ✗ verifier ({cfg.verify_model}) saw no confident animal "
            f"(first pass said {first.species or first.category or first.kind}){why} — dropping"
        )
        return None
    return second


# ── Detect-first pipeline ────────────────────────────────────────────────────────
#
# The classify-first approach (identify() above, kept for reverify.py) asks "what is
# the main subject of this whole scene?" — which makes the model invent a squirrel on
# an empty feeder. Asking it to DETECT objects instead returns [] on an empty frame,
# and Gemini's native box_2d format ([ymin,xmin,ymax,xmax], 0-1000) boxes tightly.
# Then we crop to the box and classify just that — a far easier, more reliable call.
# Validated on known sightings with camera/boxtest.py before this replaced the loop.

DETECT_PROMPT = """Detect every real bird, mammal, or person ACTUALLY VISIBLE in this
backyard bird-feeder photo. Most frames are empty (just wind in the leaves) — if you
see no animal or person, return []. Do not guess from the setting.

Return ONLY a JSON array, one object per animal/person actually present:
{"box_2d": [ymin, xmin, ymax, xmax], "label": "<specific common name>", "confidence": <0-1>}
box_2d values are integers 0-1000 (top-left origin, y first then x)."""

def _crop_prompt_intro(n_crops: int) -> str:
    if n_crops <= 1:
        return """The first image is a zoomed-in crop from a backyard bird-feeder
camera, centered on something a detector flagged. The image after it is the full
frame for context only: use it for size, pose, lighting, and surroundings, but
base the identification on visible body parts in the crop. Identify what is
actually in the crop."""
    return f"""The first {n_crops} images are zoomed-in crops of the SAME subject,
captured a fraction of a second apart by a backyard bird-feeder camera burst, so
you have more than one pose to judge from. The image after them is the full frame
for context only: use it for size, pose, lighting, and surroundings, but base the
identification on visible body parts in the crops. Identify what is actually in
the crops."""


CROP_PROMPT_BODY = """

Default to present=false. Use present=true only when you can point to visible
animal/person body parts in the crop, such as head, torso/body, legs, wings,
tail, ears, eyes, beak, or fur/feathers attached to a body. Do not classify
branches, leaves, shadows, feeder hardware, timestamp text, compression smear,
vertical bands, or general blur as an animal.

Respond ONLY with JSON matching this shape:
{
  "present": true | false,        // is there really an animal/person here?
  "evidence": string,             // visible body parts + location; "" if none
  "kind": "bird" | "critter" | "none",
  "species": string,              // friendly display name, or "" if none
  "category": string,             // short lowercase tally label for critters
                                  // (e.g. "squirrel", "raccoon", "human"); "" otherwise
  "scientific_name": string,      // "" if unknown
  "confidence": number,           // 0.0-1.0
  "fun_facts": string[],          // 2-3 short delightful facts; [] if none
  "candidates": [                 // birds only: up to 3 ranked possibilities; [] otherwise
    {"species": string, "scientific_name": string, "confidence": number, "field_marks": string}
  ]
}
Use present=false / kind="none" if it's just feeder, seed, leaves, bark, grass, sky,
or blur with no actual animal. Look carefully at the SHAPE: a dark bird on the ground
(beak, folded wings, thin legs) is a "bird", not a cat. Only identify animals
plausibly found in coastal Rhode Island / southern New England.

For birds, name a specific species only when visible field marks support it
(color pattern, bill shape, body shape, wing/tail markings, posture, or size).
If a real bird is visible but the species is not supportable, use species
"Unidentified bird" and keep confidence below 0.6.

For birds, also fill "candidates": the species this could plausibly be, ranked
most to least likely (the first entry must match "species"), each with the
visible field marks that support or rule it out. Asking "what else could it be?"
is required for lookalike feeder pairs — House Finch vs Purple Finch, Downy vs
Hairy Woodpecker (bill length vs head), Cooper's vs Sharp-shinned Hawk, the brown
sparrows, blackbird/grackle/starling — check the alternative before committing."""


# OpenAPI-style schemas passed as response_schema so the API enforces the JSON
# shape (no more hand-parsing around a model that occasionally returns an array).
_CANDIDATE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "species": {"type": "STRING"},
        "scientific_name": {"type": "STRING"},
        "confidence": {"type": "NUMBER"},
        "field_marks": {"type": "STRING"},
    },
    "required": ["species", "confidence"],
}

CROP_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "present": {"type": "BOOLEAN"},
        "evidence": {"type": "STRING"},
        "kind": {"type": "STRING", "enum": ["bird", "critter", "none"]},
        "species": {"type": "STRING"},
        "category": {"type": "STRING"},
        "scientific_name": {"type": "STRING"},
        "confidence": {"type": "NUMBER"},
        "fun_facts": {"type": "ARRAY", "items": {"type": "STRING"}},
        "candidates": {"type": "ARRAY", "items": _CANDIDATE_SCHEMA},
    },
    "required": ["present", "evidence", "kind", "species", "confidence"],
}

DETECT_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "box_2d": {"type": "ARRAY", "items": {"type": "INTEGER"}},
            "label": {"type": "STRING"},
            "confidence": {"type": "NUMBER"},
        },
        "required": ["box_2d", "label", "confidence"],
    },
}

REVIEW_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "approve": {"type": "BOOLEAN"},
        "box_on_subject": {"type": "BOOLEAN"},
        "same_kind": {"type": "BOOLEAN"},
        "same_species": {"type": "BOOLEAN"},
        "confidence": {"type": "NUMBER"},
        "evidence": {"type": "STRING"},
    },
    "required": ["approve", "box_on_subject", "same_kind", "same_species", "confidence", "evidence"],
}

RARE_SIGHTING_REVIEW_PROMPT = """You are an adversarial reviewer for a backyard
wildlife camera. The first image is the exact crop that a detector says contains
the subject. The second image is the full frame for context.

A previous model wants to post this as:
- kind: "{kind}"
- species: "{species}"

Be skeptical, especially because this would be a new or rarely seen label for
this camera. Approve only if the CROP itself clearly contains a real subject, the
box is on that subject rather than bark/leaves/feeder hardware/blur, and visible
diagnostic features support the claimed kind and species.

Reject if the crop is tree trunk, foliage, shadow, feeder parts, motion blur, or
an unidentifiable shape. Also reject if the crop contains a different kind of
animal than claimed, such as a bird being labeled as a deer/cat/squirrel/dog.
Do not approve a rare label from context or guesswork.

Respond ONLY with JSON:
{
  "approve": true | false,
  "box_on_subject": true | false,
  "same_kind": true | false,
  "same_species": true | false,
  "confidence": number,
  "evidence": string
}"""

def detect(cfg: Config, client, jpeg: bytes, model: str) -> list[dict]:
    """Native-format object detection. Returns a list of {box_2d, label, confidence}
    (box_2d = [ymin,xmin,ymax,xmax], 0-1000), or [] when nothing is found / on error."""
    resp = client.models.generate_content(
        model=model,
        contents=[genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), DETECT_PROMPT],
        config=_gen_config(DETECT_SCHEMA),
    )
    report_usage(cfg, resp, model)
    try:
        data = json.loads((resp.text or "").strip())
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out = []
    for d in data:
        if isinstance(d, dict) and isinstance(d.get("box_2d"), list) and len(d["box_2d"]) == 4:
            out.append(d)
    return out


_SPECIES_PRIOR_CACHE: dict[tuple[str, str, int], tuple[float, list[tuple[str, int]]]] = {}
_CORRECTION_PRIOR_CACHE: dict[tuple[str, str, int], tuple[float, list[tuple[str, str, int]]]] = {}
_EBIRD_PRIOR_CACHE: dict[tuple[float, float, int, int], tuple[float, list[str]]] = {}


def ebird_prior(cfg: Config) -> list[str]:
    """Species other birders have reported to eBird near the feeder recently.

    The camera's own history only knows what it has already confirmed — empty at
    cold start and blind to migration. eBird supplies the seasonal picture from
    other birders nearby, so a first-ever visitor still gets a sensible prior.

    This is a PRESENCE list, not a frequency ranking: /data/obs/geo/recent
    returns only the most recent observation per species (live-tested — every
    species comes back exactly once), and its order is recency, which carries no
    signal. Sorted alphabetically for a stable prompt, and the limit is a token
    cap, not a top-N: everything reported nearby is equally "around right now".
    Cached with a TTL; degrades to [] with no key/coords or on any error."""
    if not cfg.ebird_api_key or not cfg.ebird_lat or not cfg.ebird_lng:
        return []
    limit = max(0, cfg.ebird_prior_limit)
    if limit <= 0:
        return []
    key = (cfg.ebird_lat, cfg.ebird_lng, cfg.ebird_dist_km, cfg.ebird_days_back)
    now = time.time()
    cached = _EBIRD_PRIOR_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1][:limit]

    names: set[str] = set()
    try:
        r = requests.get(
            "https://api.ebird.org/v2/data/obs/geo/recent",
            params={
                "lat": cfg.ebird_lat,
                "lng": cfg.ebird_lng,
                "back": max(1, min(30, cfg.ebird_days_back)),
                "dist": max(1, min(50, cfg.ebird_dist_km)),
            },
            headers={"X-eBirdApiToken": cfg.ebird_api_key},
            timeout=10,
        )
        if r.status_code == 200:
            for row in r.json():
                if not isinstance(row, dict):
                    continue
                name = str(row.get("comName", "")).strip()
                if name:
                    names.add(name)
    except (requests.RequestException, ValueError):
        names = set()

    out = sorted(names)
    ttl = max(60.0, cfg.ebird_prior_ttl_seconds)
    _EBIRD_PRIOR_CACHE[key] = (now + ttl, out)
    return out[:limit]


def species_prior(cfg: Config, kind: str) -> list[tuple[str, int]]:
    """Fetch a cached local species prior from the website's durable activity API."""
    limit = max(0, cfg.species_prior_limit)
    if limit <= 0 or not cfg.upload_url:
        return []
    base = cfg.upload_url.rsplit("/", 1)[0]
    key = (base, kind, limit)
    now = time.time()
    cached = _SPECIES_PRIOR_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]

    headers = {}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    out: list[tuple[str, int]] = []
    try:
        r = requests.get(
            f"{base}/activity",
            params={"kind": kind, "days": 120},
            headers=headers,
            timeout=10,
        )
        if r.status_code == 200:
            for row in r.json().get("species", []):
                if not isinstance(row, dict):
                    continue
                species = str(row.get("species", "")).strip()
                if not species:
                    continue
                try:
                    count = int(row.get("count", 0) or 0)
                except (TypeError, ValueError):
                    count = 0
                out.append((species, count))
                if len(out) >= limit:
                    break
    except (requests.RequestException, ValueError):
        out = []

    ttl = max(60.0, cfg.species_prior_ttl_seconds)
    _SPECIES_PRIOR_CACHE[key] = (now + ttl, out)
    return out


def correction_prior(cfg: Config, kind: str) -> list[tuple[str, str, int]]:
    """Fetch cached admin correction pairs: (original species, corrected species, count)."""
    limit = max(0, cfg.correction_prior_limit)
    if limit <= 0 or not cfg.upload_url:
        return []
    base = cfg.upload_url.rsplit("/", 1)[0]
    key = (base, kind, limit)
    now = time.time()
    cached = _CORRECTION_PRIOR_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]

    headers = {}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    out: list[tuple[str, str, int]] = []
    try:
        r = requests.get(
            f"{base}/corrections",
            params={"kind": kind, "limit": limit},
            headers=headers,
            timeout=10,
        )
        if r.status_code == 200:
            for row in r.json().get("corrections", []):
                if not isinstance(row, dict):
                    continue
                original = str(row.get("originalSpecies", "")).strip()
                corrected = str(row.get("correctedSpecies", "")).strip()
                if not original or not corrected:
                    continue
                try:
                    count = int(row.get("count", 0) or 0)
                except (TypeError, ValueError):
                    count = 0
                out.append((original, corrected, count))
                if len(out) >= limit:
                    break
    except (requests.RequestException, ValueError):
        out = []

    ttl = max(60.0, cfg.correction_prior_ttl_seconds)
    _CORRECTION_PRIOR_CACHE[key] = (now + ttl, out)
    return out


def crop_classification_prompt(
    cfg: Config, n_crops: int = 1, night: bool = False, extra_note: str = ""
) -> str:
    prompt = _crop_prompt_intro(n_crops) + CROP_PROMPT_BODY
    prompt += "\n\n" + date_context()
    if night:
        prompt += "\n\n" + IR_NIGHT_NOTE
    if cfg.location_hint:
        prompt += f"\n\nThe feeder is located in: {cfg.location_hint}."

    prior = species_prior(cfg, "bird")
    if prior:
        species = ", ".join(
            f"{name} ({count})" if count > 0 else name for name, count in prior
        )
        prompt += (
            "\n\nConfirmed bird species at this exact feeder, with prior sighting counts: "
            f"{species}. Treat this as a local prior, not evidence. Prefer one of these "
            "only when the visible field marks fit; choose another plausible local species "
            "when the crop clearly shows diagnostic features for it."
        )
    ebird = ebird_prior(cfg)
    if ebird:
        prompt += (
            f"\n\nSpecies other birders have reported to eBird within {cfg.ebird_dist_km} km "
            f"of this feeder in the last {cfg.ebird_days_back} days: {', '.join(ebird)}. "
            "This is the seasonal picture of what is actually around right now — again a "
            "prior, not evidence."
        )
    # Both kinds: classify_crop is the single combined bird/critter classifier, and
    # the marquee false-positive case (a phantom "squirrel" on an empty frame) files
    # under critter — bird-only corrections would never warn about it.
    corrections = correction_prior(cfg, "bird") + correction_prior(cfg, "critter")
    # "-> none" pairs are admin deletions: the camera posted that label and a person
    # removed it as a false detection. They warn differently than true corrections.
    fixes = [(o, c, n) for o, c, n in corrections if c.strip().lower() != "none"]
    removed = [(o, n) for o, c, n in corrections if c.strip().lower() == "none"]
    if fixes:
        pairs = ", ".join(
            f"{original} -> {corrected} ({count})" if count > 0 else f"{original} -> {corrected}"
            for original, corrected, count in fixes
        )
        prompt += (
            "\n\nAdmin correction history for this feeder: "
            f"{pairs}. These are known prior mistakes by this camera/model. If your first "
            "impression matches the left side of a pair, explicitly check whether visible "
            "field marks better support the corrected species on the right."
        )
    if removed:
        labels = ", ".join(f"{o} ({n}x)" if n > 1 else o for o, n in removed)
        prompt += (
            "\n\nThe admin has deleted past posts from this camera as false detections of: "
            f"{labels}. If you find yourself naming one of these, double-check that the crop "
            "really shows that animal's body and not foliage, hardware, shadow, or blur."
        )
    if extra_note:
        prompt += "\n\n" + extra_note
    return prompt


def _open_rgb(src: bytes | np.ndarray) -> Image.Image:
    """Open a crop source: either encoded JPEG bytes or an in-memory RGB frame.
    Cropping from the raw frame keeps native resolution and skips a lossy
    re-encode — fine field marks survive that the upload-size JPEG loses."""
    if isinstance(src, (bytes, bytearray)):
        return Image.open(io.BytesIO(src)).convert("RGB")
    return Image.fromarray(src).convert("RGB")


# Classifier crops smaller than this per side get their window grown: a
# postage-stamp crop of a distant bird carries too little detail for field marks.
MIN_CROP_PX = 512


def _grow_to_min(
    x0: float, y0: float, x1: float, y1: float, w: int, h: int, min_px: int
) -> tuple[float, float, float, float]:
    """Expand a crop window symmetrically until each side reaches min_px (or the
    image edge), sliding along an edge rather than shrinking when clamped."""

    def grow(a0: float, a1: float, size: int) -> tuple[float, float]:
        need = min(float(min_px), float(size)) - (a1 - a0)
        if need > 0:
            a0 -= need / 2
            a1 += need / 2
        if a0 < 0:
            a1 -= a0
            a0 = 0.0
        if a1 > size:
            a0 -= a1 - size
            a1 = float(size)
        return max(0.0, a0), min(float(size), a1)

    x0, x1 = grow(x0, x1, w)
    y0, y1 = grow(y0, y1, h)
    return x0, y0, x1, y1


def crop_to_box(src: bytes | np.ndarray, box_2d: list, pad: float = 0.15) -> bytes | None:
    """Crop to a box_2d ([ymin,xmin,ymax,xmax], 0-1000) with padding and a minimum
    output size. `src` may be JPEG bytes or a native-resolution RGB frame."""
    try:
        ymin, xmin, ymax, xmax = [float(v) / 1000.0 for v in box_2d]
    except (TypeError, ValueError):
        return None
    im = _open_rgb(src)
    w, h = im.size
    bw, bh = xmax - xmin, ymax - ymin
    x0 = max(0.0, xmin - bw * pad) * w
    y0 = max(0.0, ymin - bh * pad) * h
    x1 = min(1.0, xmax + bw * pad) * w
    y1 = min(1.0, ymax + bh * pad) * h
    x0, y0, x1, y1 = _grow_to_min(x0, y0, x1, y1, w, h, MIN_CROP_PX)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    buf = io.BytesIO()
    im.crop((int(x0), int(y0), int(x1), int(y1))).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def crop_to_xywh(src: bytes | np.ndarray, box: list[float], pad: float = 0.2) -> bytes | None:
    """Crop to our stored [x,y,w,h] fractional box. `src` as in crop_to_box."""
    if len(box) != 4:
        return None
    x, y, bw, bh = box
    if bw <= 0 or bh <= 0:
        return None
    im = _open_rgb(src)
    w, h = im.size
    x0 = max(0.0, x - bw * pad) * w
    y0 = max(0.0, y - bh * pad) * h
    x1 = min(1.0, x + bw * (1 + pad)) * w
    y1 = min(1.0, y + bh * (1 + pad)) * h
    x0, y0, x1, y1 = _grow_to_min(x0, y0, x1, y1, w, h, MIN_CROP_PX)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    buf = io.BytesIO()
    im.crop((int(x0), int(y0), int(x1), int(y1))).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _box2d_to_xywh(box_2d: list) -> list[float] | None:
    """Convert detection [ymin,xmin,ymax,xmax] (0-1000) to our stored [x,y,w,h] (0-1)."""
    try:
        ymin, xmin, ymax, xmax = [min(1.0, max(0.0, float(v) / 1000.0)) for v in box_2d]
    except (TypeError, ValueError):
        return None
    return [xmin, ymin, max(0.0, xmax - xmin), max(0.0, ymax - ymin)]


def detection_box_ok(cfg: Config, jpeg: bytes, box: list[float] | None) -> bool:
    """Reject boxes that are too tiny or too broad to be a trustworthy subject.

    The Reolink IR night false positives were usually tiny branch/noise boxes, or
    huge boxes spanning wind-blurred foliage. Daytime and Pi-camera shots keep a
    lower floor so small birds are not lost.
    """
    if box is None or len(box) != 4:
        return False
    _, _, w, h = box
    area = w * h
    min_area = cfg.min_detection_area
    if cfg.source == "rtsp" and is_ir_night_frame(jpeg):
        min_area = max(min_area, cfg.rtsp_night_min_detection_area)
    if area < min_area:
        print(f"  · detection box too small ({area:.3f} < {min_area:.3f}), skipping")
        return False
    if max(w, h) > cfg.max_detection_span:
        print(f"  · detection box too broad ({max(w, h):.2f}), skipping")
        return False
    return True


def _parse_candidates(raw) -> list[dict]:
    out: list[dict] = []
    if not isinstance(raw, list):
        return out
    for c in raw[:3]:
        if not isinstance(c, dict):
            continue
        species = str(c.get("species", "")).strip()
        if not species:
            continue
        try:
            confidence = float(c.get("confidence", 0) or 0)
        except (TypeError, ValueError):
            confidence = 0.0
        out.append(
            {
                "species": species,
                "scientific_name": str(c.get("scientific_name", "")).strip(),
                "confidence": confidence,
                "field_marks": str(c.get("field_marks", "")).strip(),
            }
        )
    return out


def classify_crop(
    cfg: Config,
    client,
    crops: list[bytes],
    full_jpeg: bytes,
    model: str,
    night: bool = False,
    extra_note: str = "",
) -> Identification | None:
    """Identify what's in a cropped region (1-3 crops of the same subject — extra
    burst poses when the first look was borderline). Returns an Identification, or
    None if there's no real animal (present=false / kind=none) or the response is
    unusable."""
    contents = [genai_types.Part.from_bytes(data=c, mime_type="image/jpeg") for c in crops]
    contents.append(genai_types.Part.from_bytes(data=full_jpeg, mime_type="image/jpeg"))
    contents.append(
        crop_classification_prompt(cfg, n_crops=len(crops), night=night, extra_note=extra_note)
    )
    resp = client.models.generate_content(
        model=model, contents=contents, config=_gen_config(CROP_SCHEMA)
    )
    report_usage(cfg, resp, model)
    try:
        data = json.loads((resp.text or "").strip())
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not data.get("present"):
        return None
    kind = str(data.get("kind", "")).strip().lower()
    if kind not in ("bird", "critter"):
        return None
    evidence = str(data.get("evidence", "")).strip()
    if not evidence:
        return None
    return Identification(
        kind=kind,
        species=str(data.get("species", "")).strip(),
        category=str(data.get("category", "")).strip().lower(),
        scientific_name=str(data.get("scientific_name", "")).strip(),
        confidence=float(data.get("confidence", 0) or 0),
        fun_facts=[str(f) for f in data.get("fun_facts", []) if str(f).strip()],
        evidence=evidence,
        candidates=_parse_candidates(data.get("candidates")),
    )


def _iou(a: list[float], b: list[float]) -> float:
    """Intersection-over-union of two [x,y,w,h] fractional boxes."""
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    ix = max(0.0, min(ax0 + aw, bx0 + bw) - max(ax0, bx0))
    iy = max(0.0, min(ay0 + ah, by0 + bh) - max(ay0, by0))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _dedupe_detections(
    cfg: Config, jpeg: bytes, dets: list[dict], max_n: int
) -> list[tuple[dict, list[float]]]:
    """Order detections by confidence, drop implausible boxes and near-duplicates
    (the detector sometimes boxes the same bird twice), and keep the top max_n."""
    kept: list[tuple[dict, list[float]]] = []
    for d in sorted(dets, key=lambda d: float(d.get("confidence", 0) or 0), reverse=True):
        box = _box2d_to_xywh(d.get("box_2d"))
        if box is None or not detection_box_ok(cfg, jpeg, box):
            continue
        if any(_iou(box, kept_box) > 0.5 for _, kept_box in kept):
            continue
        kept.append((d, box))
        if len(kept) >= max_n:
            break
    return kept


def box_sharpness(frame: np.ndarray, box: list[float]) -> float:
    """Sharpness of just the boxed region — whole-frame sharpness rewards crisp
    background foliage even when the bird itself is motion-blurred."""
    h, w = frame.shape[:2]
    x, y, bw, bh = box
    x0, x1 = int(max(0.0, x) * w), int(min(1.0, x + bw) * w)
    y0, y1 = int(max(0.0, y) * h), int(min(1.0, y + bh) * h)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return -1.0
    return sharpness(frame[y0:y1, x0:x1])


def _frames_by_box_sharpness(cap: Capture, box: list[float]) -> list[np.ndarray]:
    """All native-res frames of a capture, sharpest-in-the-box first. Empty when the
    capture has no native frames (e.g. reverify.py re-checking a downloaded photo)."""
    if cap.full is None:
        return []
    frames = [cap.full, *cap.alts]
    scored = sorted(
        ((box_sharpness(f, box), i) for i, f in enumerate(frames)), reverse=True
    )
    return [frames[i] for score, i in scored if score >= 0]


# Below this classify confidence (and with burst alternates in hand), give the
# classifier a second look with multiple poses of the same subject.
MULTI_FRAME_MAX_CONFIDENCE = 0.85
# A locally-known runner-up candidate within this confidence gap of a locally-new
# top pick triggers a targeted compare-the-two reclassification.
TIEBREAK_MAX_GAP = 0.15


def _local_species_names(cfg: Config) -> set[str]:
    """Lower-cased bird species considered locally established: confirmed at this
    feeder, or reported to eBird nearby recently."""
    names = {name.lower() for name, _ in species_prior(cfg, "bird")}
    names.update(name.lower() for name in ebird_prior(cfg))
    return names


def prior_tiebreak_species(cfg: Config, ident: Identification) -> str | None:
    """When the top pick is locally unheard-of but the runner-up candidate is a
    known local bird at nearly the same confidence, return the runner-up so the
    classifier can be asked to compare the two directly. Plain Bayes: near-equal
    likelihoods should fall to the much more probable species."""
    if ident.kind != "bird" or len(ident.candidates) < 2:
        return None
    top, runner = ident.candidates[0], ident.candidates[1]
    if top["species"].lower() != ident.species.lower():
        return None  # candidates disagree with the main answer — don't compound it
    known = _local_species_names(cfg)
    if not known or top["species"].lower() in known:
        return None
    if runner["species"].lower() not in known:
        return None
    if top["confidence"] - runner["confidence"] > TIEBREAK_MAX_GAP:
        return None
    return runner["species"]


def detect_and_identify_all(cfg: Config, client, cap: Capture) -> list[Identification]:
    """Detect-first identification for every subject in a capture: cheap detection
    gate → accurate boxes → per-subject native-res crop + classify (with burst
    re-looks and prior tiebreaks). Returns Identifications with boxes set; empty
    when the frame has nothing real in it."""
    if cfg.source == "rtsp" and jpeg_looks_like_rtsp_smear(cap.jpeg):
        print("  · corrupt RTSP frame, skipping")
        return []

    # 1. Cheap gate: flash detection. Empty frame → [] → done (no expensive calls).
    dets = detect(cfg, client, cap.jpeg, cfg.gemini_model)
    if not dets:
        return []

    # 2. Identify with the stronger model (if configured). Boxes come from the
    #    cheap Flash detect above: drawing a box needs far less reasoning than fine
    #    species ID, so we skip a second full-frame Pro detect and spend Pro only on
    #    the per-subject crop classification below (which is also the real gate —
    #    classify_crop returns None on an empty/foliage crop). Re-running detect on
    #    Pro here fired a full-frame Pro call on every motion positive, including
    #    wind false-positives, for a marginally tighter box — the dominant cost.
    model = cfg.verify_model or cfg.gemini_model

    night = is_ir_night_frame(cap.jpeg)
    idents: list[Identification] = []
    for det, box in _dedupe_detections(cfg, cap.jpeg, dets, cfg.max_subjects_per_frame):
        # 3. Crop at native res, from whichever burst frame is sharpest in the box.
        ranked = _frames_by_box_sharpness(cap, box)
        source: bytes | np.ndarray = ranked[0] if ranked else cap.jpeg
        crop = crop_to_box(source, det["box_2d"])
        if crop is None:
            continue
        crops_used = [crop]
        ident = classify_crop(cfg, client, crops_used, cap.jpeg, model, night=night)

        # 4. Borderline call + more poses available → one re-look with several
        #    burst crops of the same subject (different poses show different marks).
        if (
            ident is not None
            and ident.confidence < MULTI_FRAME_MAX_CONFIDENCE
            and len(ranked) > 1
        ):
            crops = [crop]
            for alt in ranked[1:3]:
                extra = crop_to_box(alt, det["box_2d"])
                if extra is not None:
                    crops.append(extra)
            if len(crops) > 1:
                second = classify_crop(cfg, client, crops, cap.jpeg, model, night=night)
                if second is not None:
                    ident = second  # more evidence wins; fail open to the first look
                    crops_used = crops
        if ident is None:
            continue

        # 5. Locally-new top pick vs locally-known runner-up at similar confidence →
        #    ask the classifier to compare exactly those two before we commit.
        runner = prior_tiebreak_species(cfg, ident)
        if runner:
            note = (
                f"A local prior: {runner} is seen at/near this feeder far more often than "
                f"{ident.species}, and your earlier candidate confidences were close. Compare "
                f"{ident.species} vs {runner} directly against the visible field marks in the "
                "crop and answer with whichever the evidence actually supports."
            )
            third = classify_crop(
                cfg, client, crops_used, cap.jpeg, model, night=night, extra_note=note
            )
            if third is not None:
                if third.species.lower() != ident.species.lower():
                    print(f"  ~ prior tiebreak: {ident.species} → {third.species}")
                ident = third

        ident.box = box
        idents.append(ident)
    return idents


def detect_and_identify(cfg: Config, client, jpeg: bytes) -> Identification | None:
    """Single-image compatibility wrapper (reverify.py and friends): run the full
    detect-first pipeline on one JPEG and return the most confident subject."""
    idents = detect_and_identify_all(cfg, client, Capture(jpeg=jpeg))
    if not idents:
        return None
    return max(idents, key=lambda i: i.confidence)


def is_specific_species(ident: Identification) -> bool:
    """True when the model named a concrete species/category worth posting."""
    species = ident.species.strip()
    if not species:
        return False
    if ident.kind != "bird":
        return True
    vague = {
        "bird",
        "unknown bird",
        "unidentified bird",
        "unknown species",
        "unidentified species",
        "unidentified",
        "unknown",
    }
    return species.lower() not in vague


def species_sighting_count(cfg: Config, kind: str, species: str) -> int:
    """Count existing posted sightings for a species via the website API.

    This lets the Pi apply a stricter gate to new/rare species without needing a
    direct database connection.
    """
    base = cfg.upload_url.rsplit("/", 1)[0]
    headers = {}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    try:
        r = requests.get(
            f"{base}/sightings",
            params={"kind": kind, "species": species, "limit": cfg.rare_species_min_count},
            headers=headers,
            timeout=10,
        )
        if r.status_code != 200:
            return 0
        return len(r.json().get("sightings", []))
    except (requests.RequestException, ValueError):
        return 0


def adversarial_rare_sighting_review(
    cfg: Config, client, cap: Capture, ident: Identification
) -> bool:
    """Extra skeptical pass for new/rare species.

    It reviews the exact claimed crop plus the full frame. This catches failures
    where the model names a rare bird from foliage while the box is on a tree, or
    files a visible bird as a rare critter.
    """
    if ident.box is None:
        print(f"  · rare {ident.kind} has no box, skipping")
        return False
    min_confidence = (
        cfg.rare_bird_min_confidence if ident.kind == "bird" else cfg.rare_critter_min_confidence
    )
    if ident.confidence < min_confidence:
        print(
            f"  · rare {ident.kind} {ident.species} only {ident.confidence:.0%} sure "
            f"(< {min_confidence:.0%}), skipping"
        )
        return False

    ranked = _frames_by_box_sharpness(cap, ident.box)
    crop = crop_to_xywh(ranked[0] if ranked else cap.jpeg, ident.box)
    if crop is None:
        print(f"  · rare {ident.kind} crop failed, skipping")
        return False

    model = cfg.verify_model or cfg.gemini_model
    prompt = (
        RARE_SIGHTING_REVIEW_PROMPT.replace("{kind}", ident.kind).replace(
            "{species}", ident.species
        )
    )
    prompt += "\n\n" + date_context()
    if is_ir_night_frame(cap.jpeg):
        prompt += "\n\n" + IR_NIGHT_NOTE
    # The reviewer judges the pixels; eBird only informs plausibility. "Around but
    # unseen here" and "implausible for the area right now" are different priors.
    if ident.kind == "bird":
        ebird_names = {name.lower() for name in ebird_prior(cfg)}
        if ebird_names:
            if ident.species.lower() in ebird_names:
                prompt += (
                    f"\n\nFor plausibility: other birders HAVE reported {ident.species} to "
                    "eBird near this feeder recently, so the species is around — but the "
                    "crop must still clearly show it."
                )
            else:
                prompt += (
                    f"\n\nFor plausibility: no recent eBird reports of {ident.species} near "
                    "this feeder. That makes this claim extra surprising — require clearly "
                    "diagnostic field marks."
                )
    resp = client.models.generate_content(
        model=model,
        contents=[
            genai_types.Part.from_bytes(data=crop, mime_type="image/jpeg"),
            genai_types.Part.from_bytes(data=cap.jpeg, mime_type="image/jpeg"),
            prompt,
        ],
        config=_gen_config(REVIEW_SCHEMA),
    )
    report_usage(cfg, resp, model)
    try:
        data = json.loads((resp.text or "").strip())
    except json.JSONDecodeError:
        print(f"  · rare {ident.kind} review failed to parse for {ident.species}, skipping")
        return False
    if not isinstance(data, dict):
        return False
    approve = bool(data.get("approve"))
    box_on_subject = bool(data.get("box_on_subject"))
    same_kind = bool(data.get("same_kind"))
    same_species = bool(data.get("same_species"))
    confidence = float(data.get("confidence", 0) or 0)
    evidence = str(data.get("evidence", "")).strip()
    if (
        approve
        and box_on_subject
        and same_kind
        and same_species
        and confidence >= 0.85
        and evidence
    ):
        print(f"  ✓ rare {ident.kind} review approved {ident.species}: {evidence}")
        return True
    print(f"  · rare {ident.kind} review rejected {ident.species}: {evidence or data}")
    return False


def should_post_rare_sighting(cfg: Config, client, cap: Capture, ident: Identification) -> bool:
    count = species_sighting_count(cfg, ident.kind, ident.species)
    if count >= cfg.rare_species_min_count:
        return True
    print(
        f"  ? {ident.kind} {ident.species} is new/rare here ({count} prior); "
        "running adversarial review"
    )
    return adversarial_rare_sighting_review(cfg, client, cap, ident)


# ── Spend tracking ──────────────────────────────────────────────────────────────


def usage_url(upload_url: str) -> str:
    """Derive the usage endpoint: .../api/sightings -> .../api/usage"""
    return upload_url.rsplit("/", 1)[0] + "/usage"


def report_usage(cfg: Config, resp, model: str) -> None:
    """Record this Gemini call's token usage so the website can show an estimated
    spend. Every identify() call counts, including the many 'none' results — that's
    the real cost. `model` is the model actually used (identify may use the stronger
    verify model). Never raises: telemetry must not affect captures."""
    meta = getattr(resp, "usage_metadata", None)
    if meta is None:
        return
    payload = {
        "model": model,
        "inputTokens": int(getattr(meta, "prompt_token_count", 0) or 0),
        "outputTokens": int(getattr(meta, "candidates_token_count", 0) or 0),
    }
    headers = {"Content-Type": "application/json"}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    try:
        requests.post(usage_url(cfg.upload_url), json=payload, headers=headers, timeout=10)
    except requests.RequestException:
        pass


# ── Upload ─────────────────────────────────────────────────────────────────────

# A manual snapshot that isn't a confident bird is still shown (someone asked for a
# live look) but flagged to auto-delete after this long, with a friendly label.
MANUAL_SNAPSHOT_LABEL = "📸 Manual pic — we'll take this down shortly!"
MANUAL_TTL_SECONDS = 30 * 60


def _post_sighting(cfg: Config, payload: dict) -> bool:
    """POST a sighting payload to the website. Never raises — a network blip must
    not take down the camera."""
    headers = {"Content-Type": "application/json"}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    try:
        r = requests.post(cfg.upload_url, json=payload, headers=headers, timeout=30)
    except requests.RequestException as e:
        print(f"  ! upload failed: {e}", file=sys.stderr)
        return False
    if r.status_code != 200:
        print(f"  ! upload failed: {r.status_code} {r.text[:200]}", file=sys.stderr)
        return False
    return True


def upload(cfg: Config, ident: Identification, jpeg: bytes, manual: bool = False, kind: str = "bird") -> bool:
    return _post_sighting(
        cfg,
        {
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "species": ident.species,
            "scientificName": ident.scientific_name or None,
            "confidence": round(ident.confidence, 3),
            "funFacts": ident.fun_facts,
            "imageBase64": base64.b64encode(jpeg).decode("ascii"),
            "device": cfg.device_name,
            "manual": manual,
            "kind": kind,
            "box": ident.box,
        },
    )


def upload_manual_snapshot(cfg: Config, jpeg: bytes) -> bool:
    """Post a person-requested photo that wasn't a confident bird: show it now,
    but mark it to self-destruct after MANUAL_TTL_SECONDS."""
    now = datetime.now(timezone.utc)
    return _post_sighting(
        cfg,
        {
            "capturedAt": now.isoformat(),
            "species": MANUAL_SNAPSHOT_LABEL,
            "confidence": None,
            "funFacts": [],
            "imageBase64": base64.b64encode(jpeg).decode("ascii"),
            "device": cfg.device_name,
            "manual": True,
            "expiresAt": (now + timedelta(seconds=MANUAL_TTL_SECONDS)).isoformat(),
        },
    )


def critters_url(upload_url: str) -> str:
    """Derive the critter-tally endpoint from the sightings endpoint:
    .../api/sightings -> .../api/critters"""
    return upload_url.rsplit("/", 1)[0] + "/critters"


def increment_critter(cfg: Config, category: str) -> bool:
    """Legacy endpoint for older deployments that kept a separate critter tally."""
    headers = {"Content-Type": "application/json"}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    try:
        r = requests.post(
            critters_url(cfg.upload_url), json={"species": category}, headers=headers, timeout=15
        )
    except requests.RequestException as e:
        print(f"  ! critter count failed: {e}", file=sys.stderr)
        return False
    if r.status_code != 200:
        print(f"  ! critter count failed: {r.status_code} {r.text[:200]}", file=sys.stderr)
        return False
    return True


# ── Manual capture ("take a photo now" button) ──────────────────────────────────


def capture_url(upload_url: str) -> str:
    """Derive the manual-capture endpoint: .../api/sightings -> .../api/capture"""
    return upload_url.rsplit("/", 1)[0] + "/capture"


def claim_capture_target(cfg: Config) -> str | None:
    """Poll the website for a pending 'take a photo now' request. Returns a device
    name, or "all" for a legacy all-camera request. Never raises."""
    headers = {}
    if cfg.ingest_token:
        headers["Authorization"] = f"Bearer {cfg.ingest_token}"
    try:
        r = requests.get(capture_url(cfg.upload_url), headers=headers, timeout=15)
    except requests.RequestException as e:
        # None, not False: claim_capture_request checks `is not None`, so returning
        # False here read as "request pending" and every network blip during the
        # 10s poll triggered a phantom manual capture (Gemini calls + a junk
        # temporary snapshot posted once connectivity returned).
        print(f"  ! capture poll failed: {e}", file=sys.stderr)
        return None
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except ValueError:
        return None
    if not data.get("pending"):
        return None
    camera = data.get("camera")
    if isinstance(camera, str) and camera.strip():
        return camera.strip()
    return "all"


def claim_capture_request(cfg: Config) -> bool:
    """Poll the website for a pending 'take a photo now' request. Returns True if
    one was waiting (and is now claimed). Never raises."""
    return claim_capture_target(cfg) is not None


def process_manual(cfg: Config, client, cap: Capture) -> bool:
    """Handle a person-requested live shot. A confident bird is posted for keeps;
    anything else still gets shown as a temporary snapshot that auto-deletes."""
    idents = detect_and_identify_all(cfg, client, cap)
    birds = [
        i
        for i in idents
        if i.kind == "bird" and is_specific_species(i) and i.confidence >= cfg.min_confidence
    ]
    if birds:
        best = max(birds, key=lambda i: i.confidence)
        if not should_post_rare_sighting(cfg, client, cap, best):
            print("  📸 manual: rare bird not confirmed — posting a temporary snapshot")
            return upload_manual_snapshot(cfg, cap.jpeg)
        print(f"  ✓ manual: {best.species} ({best.confidence:.0%}) — posting")
        return upload(cfg, best, cap.jpeg, manual=True)
    print("  📸 manual: not a confident bird — posting a temporary snapshot")
    return upload_manual_snapshot(cfg, cap.jpeg)


# ── Heartbeat ───────────────────────────────────────────────────────────────────


def send_heartbeat(url: str) -> None:
    """Ping a liveness URL (e.g. healthchecks.io) so an outage triggers an alert.
    Never raises — a network blip must not take down the camera."""
    if not url:
        return
    try:
        requests.get(url, timeout=10)
    except requests.RequestException:
        pass


# ── Pipeline ───────────────────────────────────────────────────────────────────


def _group_by_species(idents: list[Identification]) -> list[tuple[Identification, int]]:
    """Collapse same-species subjects to (best identification, how many), most
    confident group first. Two goldfinches are one post with a flock note; a
    goldfinch and a cardinal are two posts."""
    groups: dict[tuple[str, str], list[Identification]] = {}
    for ident in idents:
        key = (ident.kind, ident.species.strip().lower())
        groups.setdefault(key, []).append(ident)
    out = [
        (max(members, key=lambda i: i.confidence), len(members))
        for members in groups.values()
    ]
    out.sort(key=lambda pair: pair[0].confidence, reverse=True)
    return out


def process_frame(cfg: Config, client, cap: Capture) -> bool:
    """Identify every subject in a capture. Birds post a photo to the main gallery;
    critters (non-bird animals/people) post to the visitor sub-page; everything
    else is ignored. Multiple animals in one frame each get their own sighting
    (same photo, different box); several of the SAME species collapse into one
    post with a flock note. Returns True if anything was recorded."""
    idents = detect_and_identify_all(cfg, client, cap)
    if not idents:
        print("  · no animal detected, skipping")
        return False

    posted = False
    for ident, count in _group_by_species(idents):
        if ident.kind not in ("bird", "critter"):
            print("  · not an animal, skipping")
            continue
        if ident.confidence < cfg.min_confidence:
            label = ident.species or ident.category or ident.kind
            print(f"  · {label} only {ident.confidence:.0%} sure (< min), skipping")
            continue
        if count > 1:
            ident.fun_facts = [f"{count} of them were at the feeder together in this shot!"] + (
                ident.fun_facts
            )

        if ident.kind == "bird":
            if not is_specific_species(ident):
                label = ident.species or "bird"
                print(f"  · {label} was not identified to a specific species, skipping")
                continue
            if not should_post_rare_sighting(cfg, client, cap, ident):
                continue
            flock = f" ×{count}" if count > 1 else ""
            print(f"  ✓ {ident.species}{flock} ({ident.confidence:.0%}) — posting")
            posted = upload(cfg, ident, cap.jpeg) or posted
            continue

        # critter
        label = ident.species or ident.category
        if not label:
            print("  · unclassified critter, skipping")
            continue
        if not ident.species:
            continue
        if not should_post_rare_sighting(cfg, client, cap, ident):
            continue
        print(f"  🐾 {label} ({ident.confidence:.0%}) — logging to the visitor page")
        posted = upload(cfg, ident, cap.jpeg, kind="critter") or posted

    return posted


def run_test_image(cfg: Config, client, image_path: Path) -> None:
    frame = np.asarray(Image.open(image_path).convert("RGB"))
    posted = process_frame(cfg, client, make_capture(cfg, [frame]))
    print("Posted." if posted else "Nothing posted.")


def run_loop(cfg: Config, client) -> None:
    cam = make_camera(cfg)
    metric = resolve_motion_metric(cfg.motion_metric, cfg.source)
    print(f"Watching for birds as '{cfg.device_name}' ({metric} motion). Ctrl-C to stop.")
    prev_small: np.ndarray | None = None
    last_post = 0.0
    send_heartbeat(cfg.heartbeat_url)  # ping immediately on startup
    last_heartbeat = time.time()
    last_capture_poll = 0.0

    while True:
        time.sleep(cfg.poll_seconds)

        # Liveness ping. Sent from the capture loop itself, so if the loop ever
        # stops the pings stop too and the monitor alerts.
        if cfg.heartbeat_url and time.time() - last_heartbeat >= cfg.heartbeat_seconds:
            send_heartbeat(cfg.heartbeat_url)
            last_heartbeat = time.time()

        # "Take a photo now" button: poll the website for a pending request and, if
        # someone pressed it, grab a shot immediately (regardless of motion).
        if cfg.capture_poll_seconds and time.time() - last_capture_poll >= cfg.capture_poll_seconds:
            last_capture_poll = time.time()
            if claim_capture_request(cfg):
                print("📸 Manual capture requested — grabbing a shot…")
                frames = [cam.frame() for _ in range(max(1, cfg.burst_frames))]
                process_manual(cfg, client, make_capture(cfg, frames))
                last_post = time.time()
                prev_small = to_grayscale_small(frames[-1])
                continue

        frame = cam.frame()
        small = to_grayscale_small(frame)

        if prev_small is None:
            prev_small = small
            continue

        motion = motion_score(prev_small, small, metric)
        prev_small = small

        if motion < cfg.motion_threshold:
            continue
        if time.time() - last_post < cfg.cooldown_seconds:
            continue

        print(f"Motion detected ({motion:.1f}). Capturing burst…")
        # Grab a short burst — the whole burst rides along so the pipeline can pick
        # the sharpest frame overall AND the sharpest look at each subject.
        frames = [frame]
        for _ in range(max(0, cfg.burst_frames - 1)):
            f = cam.frame()
            frames.append(f)
            prev_small = to_grayscale_small(f)

        process_frame(cfg, client, make_capture(cfg, frames))
        last_post = time.time()


def make_client(cfg: Config):
    if genai is None:
        sys.exit("google-genai not installed. Run: pip install google-genai")
    if not cfg.gemini_api_key:
        sys.exit("No Gemini API key. Set BIRDCAM_GEMINI_API_KEY or gemini.api_key in config.toml")
    return genai.Client(api_key=cfg.gemini_api_key)


def main() -> None:
    parser = argparse.ArgumentParser(description="bird-cam capture service")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.toml"))
    parser.add_argument("--test-image", type=Path, help="Run once on a local image instead of the camera")
    args = parser.parse_args()

    cfg = load_config(args.config)
    if not cfg.upload_url:
        sys.exit("No upload_url. Set BIRDCAM_UPLOAD_URL or website.upload_url in config.toml")

    client = make_client(cfg)

    if args.test_image:
        run_test_image(cfg, client, args.test_image)
        return

    try:
        run_loop(cfg, client)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
