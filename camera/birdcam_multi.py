#!/usr/bin/env python3
"""Run birdcam.py against one or more configured camera sources."""

from __future__ import annotations

import argparse
import os
import sys
import time
import tomllib
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

import birdcam as core


@dataclass
class CameraConfig:
    device_name: str
    source: str
    rtsp_url: str
    lens_position: float
    rotation: int
    jpeg_max_width: int
    jpeg_quality: int
    motion_threshold: float
    motion_metric: str


@dataclass
class CameraState:
    cfg: core.Config
    cam: object
    metric: str
    prev_small: np.ndarray | None = None
    last_post: float = 0.0


def _camera_config(raw: dict, default_name: str, default_rtsp_env: str = "") -> CameraConfig:
    source = str(raw.get("source", "picamera2")).strip().lower()
    rtsp_url_env = str(raw.get("rtsp_url_env", default_rtsp_env)).strip()
    rtsp_url = str(raw.get("rtsp_url", ""))
    if rtsp_url_env:
        rtsp_url = os.environ.get(rtsp_url_env, rtsp_url)

    return CameraConfig(
        device_name=str(raw.get("device_name", default_name)).strip() or default_name,
        source=source,
        rtsp_url=rtsp_url,
        lens_position=float(raw.get("lens_position", 0.0)),
        rotation=int(raw.get("rotation", 0)),
        jpeg_max_width=int(raw.get("jpeg_max_width", 1600)),
        jpeg_quality=int(raw.get("jpeg_quality", 85)),
        motion_threshold=float(raw.get("motion_threshold", 6.0)),
        motion_metric=str(raw.get("motion_metric", "auto")).strip().lower(),
    )


def load_camera_configs(path: Path) -> list[CameraConfig]:
    raw: dict = {}
    if path.exists():
        raw = tomllib.loads(path.read_text())

    cam = raw.get("camera", {})
    default_name = str(cam.get("device_name", "backyard-feeder"))
    camera_tables = raw.get("cameras", [])
    if camera_tables:
        return [
            _camera_config(c, default_name)
            for c in camera_tables
            if isinstance(c, dict)
        ]
    return [_camera_config(cam, default_name, default_rtsp_env="BIRDCAM_RTSP_URL")]


def runtime_config(base: core.Config, camera: CameraConfig) -> core.Config:
    return replace(
        base,
        device_name=camera.device_name,
        motion_threshold=camera.motion_threshold,
        source=camera.source,
        rtsp_url=camera.rtsp_url,
        lens_position=camera.lens_position,
        rotation=camera.rotation,
        jpeg_max_width=camera.jpeg_max_width,
        jpeg_quality=camera.jpeg_quality,
        motion_metric=camera.motion_metric,
    )


def capture_burst(
    cam: object, burst_frames: int, first_frame: np.ndarray | None = None
) -> list[np.ndarray]:
    """Grab a burst and return every frame — the pipeline (core.make_capture) picks
    the sharpest overall and keeps the rest for per-subject re-looks."""
    frames = [first_frame if first_frame is not None else cam.frame()]
    for _ in range(max(0, burst_frames - 1)):
        frames.append(cam.frame())
    return frames


def run_loop(base_cfg: core.Config, client, cameras: list[CameraConfig]) -> None:
    states = []
    for camera in cameras:
        cfg = runtime_config(base_cfg, camera)
        metric = core.resolve_motion_metric(cfg.motion_metric, cfg.source)
        states.append(CameraState(cfg, core.make_camera(cfg), metric))
    if not states:
        sys.exit("No cameras configured. Add [camera] or [[cameras]] entries to config.toml.")

    names = ", ".join(f"{s.cfg.device_name} ({s.metric} motion)" for s in states)
    print(f"Watching for birds on {len(states)} camera(s): {names}. Ctrl-C to stop.")
    core.send_heartbeat(base_cfg.heartbeat_url)
    last_heartbeat = time.time()
    last_capture_poll = 0.0

    while True:
        time.sleep(base_cfg.poll_seconds)

        if (
            base_cfg.heartbeat_url
            and time.time() - last_heartbeat >= base_cfg.heartbeat_seconds
        ):
            core.send_heartbeat(base_cfg.heartbeat_url)
            last_heartbeat = time.time()

        if (
            base_cfg.capture_poll_seconds
            and time.time() - last_capture_poll >= base_cfg.capture_poll_seconds
        ):
            last_capture_poll = time.time()
            capture_target = core.claim_capture_target(base_cfg)
            if capture_target:
                selected = (
                    states
                    if capture_target == "all"
                    else [state for state in states if state.cfg.device_name == capture_target]
                )
                if not selected:
                    print(f"Manual capture requested for unknown camera '{capture_target}'.")
                    continue
                print(
                    f"Manual capture requested - grabbing shots from "
                    f"{len(selected)} camera(s)..."
                )
                now = time.time()
                for state in selected:
                    frames = capture_burst(state.cam, max(1, base_cfg.burst_frames))
                    core.process_manual(
                        state.cfg, client, core.make_capture(state.cfg, frames)
                    )
                    state.last_post = now
                    state.prev_small = core.to_grayscale_small(frames[-1])
                continue

        for state in states:
            frame = state.cam.frame()
            small = core.to_grayscale_small(frame)

            if state.prev_small is None:
                state.prev_small = small
                continue

            motion = core.motion_score(state.prev_small, small, state.metric)
            state.prev_small = small

            if motion < state.cfg.motion_threshold:
                continue
            if time.time() - state.last_post < state.cfg.cooldown_seconds:
                continue

            print(f"[{state.cfg.device_name}] Motion detected ({motion:.1f}). Capturing burst...")
            frames = capture_burst(state.cam, base_cfg.burst_frames, first_frame=frame)
            state.prev_small = core.to_grayscale_small(frames[-1])

            core.process_frame(state.cfg, client, core.make_capture(state.cfg, frames))
            state.last_post = time.time()


def main() -> None:
    parser = argparse.ArgumentParser(description="multi-camera bird-cam capture service")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.toml"))
    parser.add_argument("--test-image", type=Path, help="Run once on a local image")
    args = parser.parse_args()

    base_cfg = core.load_config(args.config)
    if not base_cfg.upload_url:
        sys.exit("No upload_url. Set BIRDCAM_UPLOAD_URL or website.upload_url in config.toml")

    client = core.make_client(base_cfg)

    if args.test_image:
        core.run_test_image(base_cfg, client, args.test_image)
        return

    try:
        run_loop(base_cfg, client, load_camera_configs(args.config))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
