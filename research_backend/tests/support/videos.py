"""Generated video fixtures (no copyrighted or personal media).

``write_dot_squat_video`` renders a REAL encoded video of the Milestone 6
stick-figure squat: each landmark of the camera-side leg is a small disk
with its own grey level on black. ``DotPoseProvider`` (tests/support/
providers.py) finds those disks again. Together they exercise the complete
pipeline — container, decoder, presentation timestamps, orientation,
sampling, pose-frame contract, protocol, segmentation, skeleton, storage —
on actual media with a deterministic stand-in for the learned pose model.
Lossless RGB H.264 (``libx264rgb``) keeps the grey levels exact.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence
from fractions import Fraction
from pathlib import Path
from typing import Any

import av
import numpy as np

from tests.support.synthetic_pose import lean_for_knee, squat_knee_at, stick_figure

DOT_LEVELS: dict[str, int] = {
    "nose": 40,
    "shoulder": 70,
    "hip": 100,
    "knee": 130,
    "ankle": 160,
    "heel": 190,
    "foot_index": 220,
}
SECOND_PERSON_LEVEL = 250
DOT_RADIUS = 5.0

PORTRAIT = (360, 640)  # width, height (display orientation)
FIGURE = {"ankleX": 180.0, "ankleY": 560.0, "shank": 110.0, "thigh": 110.0, "trunk": 150.0, "head": 55.0}


def draw_disk(img: np.ndarray, cx: float, cy: float, level: int, radius: float = DOT_RADIUS) -> None:
    h, w = img.shape[:2]
    x0, x1 = max(0, math.floor(cx - radius - 1)), min(w, math.ceil(cx + radius + 1))
    y0, y1 = max(0, math.floor(cy - radius - 1)), min(h, math.ceil(cy + radius + 1))
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    mask = (xs + 0.5 - cx) ** 2 + (ys + 0.5 - cy) ** 2 <= radius**2
    img[y0:y1, x0:x1][mask] = level


def dot_frame(
    t_ms: float,
    *,
    size: tuple[int, int] = PORTRAIT,
    figure: dict[str, float] | None = None,
    spec: dict[str, float] | None = None,
    knee_fn: Callable[[float], float] | None = None,
    second_person: bool = False,
    mirror: bool = False,
) -> np.ndarray:
    """Upright (display-oriented) RGB frame of the stick figure at t_ms."""
    w, h = size
    img = np.zeros((h, w, 3), dtype=np.uint8)
    knee = knee_fn(t_ms) if knee_fn is not None else squat_knee_at(t_ms, spec)
    fig = stick_figure(knee, lean_for_knee(knee), **{**FIGURE, **(figure or {})})
    for part, level in DOT_LEVELS.items():
        x, y = fig[part]
        if mirror:
            x = w - x
        draw_disk(img, x, y, level)
    if second_person:
        draw_disk(img, 30.0, 40.0, SECOND_PERSON_LEVEL)
    return img


def encode_video(
    path: Path,
    frames: Iterable[tuple[np.ndarray, int]],
    *,
    time_base: Fraction = Fraction(1, 90000),
    codec: str = "libx264rgb",
    rotation: int | None = None,
    options: dict[str, str] | None = None,
    rate: int = 30,
    container_options: dict[str, str] | None = None,
) -> Path:
    """Encode (stored-orientation RGB frame, pts) pairs into an MP4 (streamed)."""
    iterator = iter(frames)
    first_pair = next(iterator)
    h, w = first_pair[0].shape[:2]
    container = av.open(str(path), "w", format="mp4", options=container_options or {})
    stream = container.add_stream(codec, rate=rate)
    stream.width, stream.height = w, h
    if codec == "libx264rgb":
        stream.pix_fmt = "rgb24"
        stream.options = {"qp": "0", "preset": "ultrafast", **(options or {})}
    else:
        stream.pix_fmt = "yuv420p"
        base = {"preset": "ultrafast"} if codec.startswith("libx26") else {}
        stream.options = {**base, **(options or {})}
    stream.time_base = time_base
    stream.codec_context.time_base = time_base
    if rotation is not None:
        stream.set_display_rotation(rotation)
    import itertools

    for rgb, pts in itertools.chain([first_pair], iterator):
        frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(rgb), format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    return path


def stored_for_rotation(upright: np.ndarray, rotation: int) -> np.ndarray:
    """Pixels to store so that FFmpeg's display rotation shows ``upright``.

    Display = np.rot90(stored, k) with k = rotation/90 (FFmpeg convention,
    counter-clockwise), so stored = np.rot90(upright, −k).
    """
    k = {0: 0, 90: 1, 180: 2, -180: 2, -90: -1, 270: -1}[rotation]
    return np.ascontiguousarray(np.rot90(upright, -k))


def times_cfr(fps: float, duration_ms: float) -> list[Fraction]:
    n = math.floor(duration_ms / 1000 * fps) + 1
    return [Fraction(i) / Fraction(fps).limit_denominator(1001) for i in range(n)]


def write_dot_squat_video(
    path: Path,
    *,
    times_s: Sequence[Fraction] | None = None,
    fps: float = 30,
    duration_ms: float = 7000,
    rotation: int | None = None,
    size: tuple[int, int] = PORTRAIT,
    time_base: Fraction = Fraction(1, 90000),
    spec: dict[str, float] | None = None,
    knee_fn: Callable[[float], float] | None = None,
    second_person_after_ms: float | None = None,
    mirror: bool = False,
    frame_hook: Callable[[float, np.ndarray], np.ndarray] | None = None,
    codec: str = "libx264rgb",
) -> Path:
    times = list(times_s) if times_s is not None else times_cfr(fps, duration_ms)

    def frames() -> Iterable[tuple[np.ndarray, int]]:
        for t in times:
            yield render(t)

    def render(t: Fraction) -> tuple[np.ndarray, int]:
        t_ms = float(t * 1000)
        up = dot_frame(
            t_ms,
            size=size,
            spec=spec,
            knee_fn=knee_fn,
            second_person=second_person_after_ms is not None and t_ms >= second_person_after_ms,
            mirror=mirror,
        )
        if frame_hook is not None:
            up = frame_hook(t_ms, up)
        stored = stored_for_rotation(up, rotation) if rotation else up
        pts = int(t / time_base)
        assert Fraction(pts) * time_base == t, "fixture times must be exact in the time base"
        return stored, pts

    return encode_video(path, frames(), time_base=time_base, rotation=rotation, codec=codec)


def write_blank_video(
    path: Path, *, size: tuple[int, int] = (160, 120), fps: int = 30, duration_ms: float = 1000, codec: str = "libx264"
) -> Path:
    frames = []
    tb = Fraction(1, 90000)
    for t in times_cfr(fps, duration_ms):
        img = np.full((size[1], size[0], 3), 90, dtype=np.uint8)
        frames.append((img, int(t / tb)))
    return encode_video(path, frames, time_base=tb, codec=codec)


def write_image_video(
    path: Path,
    image: np.ndarray,
    *,
    fps: int = 15,
    duration_ms: float = 1000,
    rotation: int | None = None,
    codec: str = "libx264",
    options: dict[str, str] | None = None,
) -> Path:
    """A still image as a short video (stored so that it DISPLAYS upright)."""
    tb = Fraction(1, 90000)
    stored = stored_for_rotation(image, rotation) if rotation else image
    h, w = stored.shape[:2]
    stored = stored[: h - h % 2, : w - w % 2]
    frames = ((stored, int(t / tb)) for t in times_cfr(fps, duration_ms))
    return encode_video(path, frames, time_base=tb, rotation=rotation, codec=codec, options=options)


def mp4_bytes_with_brand(payload: bytes) -> bytes:
    """An ``ftyp``-prefixed blob (passes the API sniff; not a decodable video)."""
    ftyp = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
    return ftyp + payload


def decode_timestamps(path: Path) -> list[Fraction]:
    out = []
    with av.open(str(path)) as c:
        s = c.streams.video[0]
        for f in c.decode(s):
            out.append(Fraction(f.pts) * Fraction(s.time_base))
    return out


def as_pairs(values: Iterable[Any]) -> list[Any]:
    return list(values)
