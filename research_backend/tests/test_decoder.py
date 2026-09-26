"""video-decoding-v0.1 on REAL generated media (PyAV/FFmpeg).

Timing must come from presentation timestamps (PTS × time_base), never from
frame_index / nominal_fps. Every fixture is generated here; no third-party
media is used.
"""

from __future__ import annotations

import io
import itertools
import os
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any

import av
import numpy as np
import pytest

from physiq_research.config import MediaLimits
from physiq_research.failures import FailureCode, PipelineFailure
from physiq_research.media.decoder import DecodeStats, SourceTechnical, VideoDecoder
from physiq_research.media.orientation import IDENTITY, UnsupportedOrientation, classify
from tests.support.videos import (
    PORTRAIT,
    dot_frame,
    encode_video,
    mp4_bytes_with_brand,
    stored_for_rotation,
    times_cfr,
    write_dot_squat_video,
)

LIMITS = MediaLimits()


def decode_all(path: Path, limits: MediaLimits = LIMITS) -> tuple[SourceTechnical, list[Any]]:
    with VideoDecoder(path, limits) as dec:
        tech = dec.probe()
        frames = [(f.index, f.pts, f.t, dec.to_rgb(f)) for f in dec.frames()]
    return tech, frames


def fail(path: Path, limits: MediaLimits = LIMITS) -> PipelineFailure:
    with pytest.raises(PipelineFailure) as info, VideoDecoder(path, limits) as dec:
        dec.probe()
        for f in dec.frames():
            dec.to_rgb(f)
    return info.value


def pattern(w: int, h: int, i: int = 0) -> np.ndarray:
    """Asymmetric test image: a white block in the TOP-LEFT corner."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[: h // 4, : w // 3] = 255
    img[h // 2 :, w // 2 :, 1] = (i * 7) % 255
    return img


# ── timestamps ──────────────────────────────────────────────────────────


def test_constant_frame_rate_times_are_pts_times_time_base(tmp_path: Path) -> None:
    times = times_cfr(30, 1000)
    path = write_dot_squat_video(tmp_path / "cfr.mp4", times_s=times)
    tech, frames = decode_all(path)
    assert [t for _, _, t, _ in frames] == times  # exact rationals
    tb = Fraction(*map(int, tech.time_base.split("/")))
    assert all(Fraction(pts) * tb - Fraction(frames[0][1]) * tb == t for _, pts, t, _ in frames)
    assert tech.stats.accepted_frames == len(times) and tech.stats.dropped_duplicate_pts == 0


def test_variable_frame_rate_ignores_nominal_rate(tmp_path: Path) -> None:
    # Irregular gaps (20–140 ms) while the stream DECLARES 30 fps. index/fps would be wrong.
    gaps_ms = [33, 20, 140, 47, 33, 90, 25, 60, 33, 110, 21, 33]
    times = [Fraction(0)]
    for g in gaps_ms:
        times.append(times[-1] + Fraction(g, 1000))
    frames = [(dot_frame(float(t * 1000)), int(t * 90000)) for t in times]
    path = encode_video(tmp_path / "vfr.mp4", frames, rate=30)
    _, decoded = decode_all(path)
    got = [t for _, _, t, _ in decoded]
    assert got == times
    naive = [Fraction(i, 30) for i in range(len(times))]
    assert got != naive  # the frame_index / nominal_fps shortcut would misplace these frames


@pytest.mark.parametrize("tb", [Fraction(1, 90000), Fraction(1, 1000), Fraction(1, 30000), Fraction(1, 600)])
def test_time_base_semantics(tmp_path: Path, tb: Fraction) -> None:
    times = [Fraction(i, 10) for i in range(8)]  # exact in every tested time base
    path = write_dot_squat_video(tmp_path / f"tb{tb.denominator}.mp4", times_s=times, time_base=tb)
    _tech, decoded = decode_all(path)
    assert [t for _, _, t, _ in decoded] == times


def test_b_frame_reordering_keeps_presentation_order(tmp_path: Path) -> None:
    times = times_cfr(30, 2000)
    frames = [(pattern(64, 48, i), int(t * 90000)) for i, t in enumerate(times)]
    path = encode_video(tmp_path / "bframes.mp4", frames, codec="libx264", options={"bf": "3", "preset": "medium"})
    with av.open(str(path)) as c:
        packets = [p.pts for p in c.demux(c.streams.video[0]) if p.size]
    assert packets != sorted(packets)  # decode order really differs from presentation order
    _, decoded = decode_all(path)
    assert [t for _, _, t, _ in decoded] == times


# ── orientation ─────────────────────────────────────────────────────────


def test_portrait_and_landscape_without_metadata(tmp_path: Path) -> None:
    for name, (w, h) in {"portrait": (48, 64), "landscape": (64, 48)}.items():
        frames = [(pattern(w, h), 0)]
        tech, decoded = decode_all(encode_video(tmp_path / f"{name}.mp4", frames, codec="libx264rgb"))
        assert (tech.display_width, tech.display_height) == (w, h)
        assert tech.orientation.transform == "none" and not tech.orientation.describe()["display_matrix_present"]
        assert np.array_equal(decoded[0][3], pattern(w, h))


@pytest.mark.parametrize("rotation", [90, -90, 180])
def test_rotation_metadata_is_applied_before_analysis(tmp_path: Path, rotation: int) -> None:
    upright = pattern(48, 64)  # portrait as the viewer should see it
    stored = stored_for_rotation(upright, rotation)  # what a phone writes (landscape pixels)
    path = encode_video(tmp_path / f"rot{rotation}.mp4", [(stored, 0)], codec="libx264rgb", rotation=rotation)
    tech, decoded = decode_all(path)
    assert (tech.coded_width, tech.coded_height) == stored.shape[1::-1]
    assert (tech.display_width, tech.display_height) == (48, 64)
    assert tech.orientation.rotation_ccw_deg in (rotation, -180 if rotation == 180 else rotation)
    assert np.array_equal(decoded[0][3], upright)  # the analysed pixels are upright
    assert tech.orientation.describe()["transform_applied"] != "none"


def test_rotated_squat_video_decodes_to_the_same_frames_as_upright(tmp_path: Path) -> None:
    times = times_cfr(15, 600)
    plain = write_dot_squat_video(tmp_path / "plain.mp4", times_s=times)
    rotated = write_dot_squat_video(tmp_path / "rot.mp4", times_s=times, rotation=90)
    _, a = decode_all(plain)
    tech, b = decode_all(rotated)
    assert tech.orientation.rot90_k == 1
    for (_, _, ta, ia), (_, _, tb_, ib) in zip(a, b, strict=True):
        assert ta == tb_ and np.array_equal(ia, ib)


def test_mirrored_display_matrix_is_rejected(tmp_path: Path) -> None:
    buf_path = tmp_path / "mirror.mp4"
    c = av.open(str(buf_path), "w", format="mp4")
    s = c.add_stream("libx264", rate=30)
    s.width, s.height, s.pix_fmt = 64, 48, "yuv420p"
    s.set_display_matrix([-65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30])
    for i in range(3):
        f = av.VideoFrame.from_ndarray(pattern(64, 48, i), format="rgb24")
        f.pts = i
        for p in s.encode(f):
            c.mux(p)
    for p in s.encode():
        c.mux(p)
    c.close()
    assert fail(buf_path).detail == "unsupported_orientation"


def test_orientation_classifier() -> None:
    assert classify(None) is IDENTITY
    assert classify((0, -65536, 0, 65536, 0, 0, 0, 0, 1 << 30)).rot90_k == 1
    assert classify((0, 65536, 0, -65536, 0, 0, 480, 0, 1 << 30)).rot90_k == -1  # translation ignored
    for bad in [
        (65536, 0, 0, 0, -65536, 0, 0, 0, 1 << 30),  # vertical flip
        (131072, 0, 0, 0, 131072, 0, 0, 0, 1 << 30),  # scale
        (65536, 1000, 0, 0, 65536, 0, 0, 0, 1 << 30),  # shear
        (65536, 0, 5, 0, 65536, 0, 0, 0, 1 << 30),  # projective
    ]:
        with pytest.raises(UnsupportedOrientation):
            classify(bad)


# ── invalid media ───────────────────────────────────────────────────────


def test_garbage_with_mp4_signature(tmp_path: Path) -> None:
    p = tmp_path / "garbage.mp4"
    p.write_bytes(mp4_bytes_with_brand(os.urandom(4000)))
    f = fail(p)
    assert (f.code, f.detail) == (FailureCode.INVALID_VIDEO, "container_open_failed")


def test_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "empty.mp4"
    p.write_bytes(b"")
    assert fail(p).detail == "empty_file"


def test_zero_frame_video(tmp_path: Path) -> None:
    p = tmp_path / "zero.mp4"
    c = av.open(str(p), "w", format="mp4")
    s = c.add_stream("libx264", rate=30)
    s.width, s.height, s.pix_fmt = 64, 48, "yuv420p"
    c.start_encoding()
    c.close()
    f = fail(p)
    # FFmpeg exposes an MP4 video track without samples as no stream at all.
    assert f.code is FailureCode.INVALID_VIDEO and f.detail in ("no_video_stream", "no_video_frames")


def test_audio_only_file(tmp_path: Path) -> None:
    p = tmp_path / "audio.mp4"
    c = av.open(str(p), "w", format="mp4")
    st = c.add_stream("aac", rate=44100)
    fr = av.AudioFrame.from_ndarray(np.zeros((1, 1024), dtype=np.float32), format="fltp", layout="mono")
    fr.sample_rate = 44100
    fr.pts = 0
    for pk in st.encode(fr):
        c.mux(pk)
    for pk in st.encode():
        c.mux(pk)
    c.close()
    assert fail(p).detail == "no_video_stream"


@pytest.mark.parametrize("fraction", [0.5, 0.9])
def test_truncated_video(tmp_path: Path, fraction: float) -> None:
    times = times_cfr(30, 2000)
    frames = [
        (pattern(128, 96, i) ^ np.random.default_rng(i).integers(0, 255, (96, 128, 3), dtype=np.uint8), int(t * 90000))
        for i, t in enumerate(times)
    ]
    full = encode_video(tmp_path / "full.mp4", frames, codec="libx264", container_options={"movflags": "faststart"})
    data = full.read_bytes()
    cut = tmp_path / f"cut{int(fraction * 100)}.mp4"
    cut.write_bytes(data[: int(len(data) * fraction)])
    f = fail(cut)
    assert (f.code, f.detail) == (FailureCode.DECODE_FAILED, "truncated_or_corrupt")


def test_truncated_before_index_is_invalid(tmp_path: Path) -> None:
    full = write_dot_squat_video(tmp_path / "full.mp4", duration_ms=500)  # moov at the END
    cut = tmp_path / "cut.mp4"
    cut.write_bytes(full.read_bytes()[: full.stat().st_size // 2])
    assert fail(cut).detail == "container_open_failed"


def test_oversized_dimensions_rejected_before_decoding(tmp_path: Path) -> None:
    p = encode_video(tmp_path / "wide.mp4", [(pattern(4000, 16), 0)], codec="libx264")
    f = fail(p)
    assert (f.code, f.detail, f.stage.value) == (FailureCode.INVALID_VIDEO, "dimensions_exceeded", "probe")
    small = MediaLimits(max_long_side_px=64, max_short_side_px=64)
    assert (
        fail(encode_video(tmp_path / "hd.mp4", [(pattern(128, 96), 0)], codec="libx264"), small).detail
        == "dimensions_exceeded"
    )


def test_over_duration_rejected(tmp_path: Path) -> None:
    path = write_dot_squat_video(tmp_path / "long.mp4", fps=10, duration_ms=5000)
    early = fail(path, MediaLimits(max_duration_ms=1000))
    assert (early.detail, early.stage.value) == ("duration_exceeded", "probe")  # declared duration
    late = fail(write_dot_squat_video(tmp_path / "2s.mp4", fps=10, duration_ms=2000), MediaLimits(max_duration_ms=1500))
    assert (late.detail, late.stage.value) == ("duration_exceeded", "decode")  # per-frame media time


def test_frame_count_and_file_size_limits(tmp_path: Path) -> None:
    path = write_dot_squat_video(tmp_path / "v.mp4", fps=30, duration_ms=1000)
    assert fail(path, MediaLimits(max_decoded_frames=10)).detail == "frame_count_exceeded"
    assert fail(path, MediaLimits(max_upload_bytes=1000)).detail == "file_too_large"


def test_unsupported_codec_and_non_square_pixels(tmp_path: Path) -> None:
    # MPEG-4 Part 2 caps the time-base denominator at 65535.
    mpeg4 = encode_video(tmp_path / "mpeg4.mp4", [(pattern(64, 48), 0)], codec="mpeg4", time_base=Fraction(1, 30))
    assert fail(mpeg4).detail == "unsupported_codec"
    p = tmp_path / "anamorphic.mp4"
    c = av.open(str(p), "w", format="mp4")
    s = c.add_stream("libx264", rate=30)
    s.width, s.height, s.pix_fmt = 64, 48, "yuv420p"
    s.codec_context.sample_aspect_ratio = Fraction(4, 3)
    f = av.VideoFrame.from_ndarray(pattern(64, 48), format="rgb24")
    f.pts = 0
    for pk in s.encode(f):
        c.mux(pk)
    for pk in s.encode():
        c.mux(pk)
    c.close()
    assert fail(p).detail == "non_square_pixels"


def test_multiple_video_streams_rejected(tmp_path: Path) -> None:
    p = tmp_path / "two.mp4"
    c = av.open(str(p), "w", format="mp4")
    streams = []
    for _ in range(2):
        s = c.add_stream("libx264", rate=30)
        s.width, s.height, s.pix_fmt = 64, 48, "yuv420p"
        streams.append(s)
    for s in streams:
        f = av.VideoFrame.from_ndarray(pattern(64, 48), format="rgb24")
        f.pts = 0
        for pk in s.encode(f):
            c.mux(pk)
        for pk in s.encode():
            c.mux(pk)
    c.close()
    assert fail(p).detail == "multiple_video_streams"


def test_decoder_error_text_is_never_exposed(tmp_path: Path) -> None:
    p = tmp_path / "secret-path-name.mp4"
    p.write_bytes(mp4_bytes_with_brand(os.urandom(2000)))
    f = fail(p)
    assert "secret-path-name" not in str(f) and str(tmp_path) not in str(f)
    assert f.__cause__ is None and f.__suppress_context__


# ── timestamp anomalies (policy, via a fake demuxer) ────────────────────
# Conformant MP4 muxers refuse to write missing/duplicate/non-monotonic
# presentation timestamps, so the drop policy is exercised with a fake
# container that feeds the real VideoDecoder.frames() loop.


@dataclass
class FakeFrame:
    pts: int | None
    width: int = 64
    height: int = 48
    side_data: list = field(default_factory=list)
    is_corrupt: bool = False
    rotation: int = 0


class FakePacket:
    def __init__(self, frames: list[FakeFrame]) -> None:
        self.frames = frames
        self.size = 100 if frames else 0

    def decode(self) -> list[FakeFrame]:
        return self.frames


class FakeStream:
    time_base = Fraction(1, 1000)


class FakeContainer:
    def __init__(self, pts: list[int | None]) -> None:
        self.pts = pts

    def demux(self, _stream: object) -> Any:
        for p in self.pts:
            yield FakePacket([FakeFrame(p)])
        yield FakePacket([])

    def close(self) -> None:
        pass


def fake_decoder(pts: list[int | None]) -> VideoDecoder:
    dec = VideoDecoder(Path("unused.mp4"), LIMITS)
    dec._container = FakeContainer(pts)  # type: ignore[attr-defined]
    dec._stream = FakeStream()  # type: ignore[attr-defined]
    dec.technical = SourceTechnical(
        byte_size=1,
        demuxer="mov",
        major_brand="isom",
        codec="h264",
        profile=None,
        pixel_format="yuv420p",
        coded_width=64,
        coded_height=48,
        display_width=64,
        display_height=48,
        time_base="1/1000",
        average_frame_rate=None,
        declared_duration_ms=None,
        indexed_frames=None,
        orientation=IDENTITY,
        has_audio=False,
        stats=DecodeStats(),
    )
    return dec


def test_missing_duplicate_and_non_monotonic_pts_are_dropped_not_invented() -> None:
    pts: list[int | None] = list(range(0, 3000, 33))
    pts[10] = None  # missing
    pts.insert(20, pts[19])  # duplicate
    pts.insert(40, pts[30])  # non-monotonic (goes back in time)
    dec = fake_decoder(pts)
    frames = list(dec.frames())
    t = [f.t for f in frames]
    assert all(b > a for a, b in itertools.pairwise(t))
    stats = dec.technical.stats  # type: ignore[union-attr]
    assert (stats.dropped_missing_pts, stats.dropped_duplicate_pts, stats.dropped_non_monotonic_pts) == (1, 1, 1)
    assert frames[0].t == 0 and frames[-1].t == Fraction(pts[-1], 1000)  # type: ignore[arg-type]


def test_too_many_timestamp_anomalies_fail_the_video() -> None:
    pts: list[int | None] = [None if i % 3 == 0 else i * 33 for i in range(1, 60)]
    with pytest.raises(PipelineFailure) as info:
        list(fake_decoder(pts).frames())
    assert (info.value.code, info.value.detail) == (FailureCode.DECODE_FAILED, "invalid_timestamps")


def test_video_without_any_usable_timestamp_has_no_frames() -> None:
    with pytest.raises(PipelineFailure) as info:
        list(fake_decoder([None, None]).frames())
    assert info.value.detail == "no_video_frames"


def test_decoding_is_lazy(tmp_path: Path) -> None:
    """frames() is a generator: nothing is decoded until asked, and frames are
    yielded one at a time (the pipeline holds at most two)."""
    path = write_dot_squat_video(tmp_path / "lazy.mp4", fps=30, duration_ms=1000)
    with VideoDecoder(path, LIMITS) as dec:
        dec.probe()
        it = dec.frames()
        assert dec.technical is not None and dec.technical.stats.decoded_frames == 0
        next(it)
        assert dec.technical.stats.decoded_frames <= 2
    assert PORTRAIT == (360, 640)
    assert isinstance(io.BytesIO(), io.BytesIO)


def test_decoding_memory_is_bounded_by_a_few_frames(tmp_path: Path) -> None:
    """Regression: per-frame side-data access used to retain every decoded
    frame (a PyAV reference cycle). Decode 1080×1920 frames in a fresh
    process and bound its peak RSS."""
    import subprocess
    import sys

    video = write_dot_squat_video(tmp_path / "big.mp4", size=(1080, 1920), fps=30, duration_ms=4000)
    code = f"""
import resource, sys
sys.path.insert(0, {str(Path(__file__).resolve().parents[1])!r})
from physiq_research.config import MediaLimits
from physiq_research.media.decoder import VideoDecoder
from physiq_research.media.sampling import sample_frames
n = 0
with VideoDecoder({str(video)!r}, MediaLimits()) as dec:
    dec.probe()
    for f in sample_frames(dec.frames()):
        dec.to_rgb(f); n += 1
    decoded = dec.technical.stats.decoded_frames
div = 1024 * 1024 if sys.platform == "darwin" else 1024
print(decoded, n, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / div)
"""
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.split()
    decoded, sampled, peak_mb = int(out[0]), int(out[1]), float(out[2])
    assert decoded == 121 and sampled == 61
    # 121 decoded frames × ~6 MB each would exceed 700 MB if frames were retained.
    assert peak_mb < 250, peak_mb


def test_decoder_never_opens_network_urls() -> None:
    """PyAV's FFmpeg build includes network protocols (it bundles a TLS
    library); the decoder allows only the ``file`` protocol and the ``mov``
    demuxer, so a URL is refused without any connection being made."""
    import socket

    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    server.settimeout(0.5)
    port = server.getsockname()[1]
    from physiq_research.media.decoding_contract import DEMUXER, OPEN_OPTIONS

    try:
        for url in (f"http://127.0.0.1:{port}/v.mp4", f"tcp://127.0.0.1:{port}"):
            # exactly the open call VideoDecoder.probe() makes
            with pytest.raises(av.error.FFmpegError):
                av.open(url, mode="r", format=DEMUXER, options=dict(OPEN_OPTIONS), metadata_errors="ignore")
        with pytest.raises(OSError):
            server.accept()  # nobody connected
        # control: without the whitelist FFmpeg WOULD connect (proves the test can see it)
        with pytest.raises(av.error.FFmpegError):
            av.open(f"tcp://127.0.0.1:{port}", mode="r", format=DEMUXER, timeout=1.0)
        conn, _ = server.accept()
        conn.close()
    finally:
        server.close()
