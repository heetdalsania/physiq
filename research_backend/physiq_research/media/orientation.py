"""Display-orientation normalization (part of ``video-decoding-v0.1``).

Phones usually store portrait video as landscape pixels plus a display
matrix saying how to rotate them for display. Pose must run on the image as
DISPLAYED — analysing sideways pixels would produce landmarks (and angles)
of a sideways person.

FFmpeg exports the matrix as frame side data (``AV_FRAME_DATA_DISPLAYMATRIX``,
nine int32: a b u / c d v / x y w, with a–d, x, y in 16.16 and u, v, w in
2.30 fixed point). The rotation angle follows FFmpeg's
``av_display_rotation_get`` convention (counter-clockwise degrees). The
normalization reproduces what ``ffmpeg`` itself does with ``-autorotate``
(verified against the ffmpeg CLI while building this module, and pinned by
tests/test_decoder.py):

    rotation +90  → rotate the pixels 90° counter-clockwise  (np.rot90, k=1)
    rotation −90  → rotate the pixels 90° clockwise          (np.rot90, k=−1)
    rotation 180  → rotate 180°                              (np.rot90, k=2)

Only the four pure rotations are supported. A matrix containing a
reflection (mirror), scaling, shear or projective terms is rejected
(``unsupported_orientation``) rather than guessed at: a mirrored display
would silently swap which side of the body faces the camera.
Translation terms (x, y) only place the picture and are ignored.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Final

import numpy as np

FP16: Final = 1 << 16
FP30: Final = 1 << 30

# (a, b, c, d) in 16.16 → counter-clockwise rotation degrees, np.rot90 k
_PURE_ROTATIONS: Final = {
    (FP16, 0, 0, FP16): (0, 0),
    (0, -FP16, FP16, 0): (90, 1),
    (-FP16, 0, 0, -FP16): (180, 2),
    (0, FP16, -FP16, 0): (-90, -1),
}


class UnsupportedOrientation(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Orientation:
    rotation_ccw_deg: int  # 0, 90, 180 or -90
    rot90_k: int
    display_matrix: tuple[int, ...] | None  # None: no matrix present

    @property
    def transform(self) -> str:
        return {0: "none", 1: "rotate_90_ccw", 2: "rotate_180", -1: "rotate_90_cw"}[self.rot90_k]

    def displayed_size(self, width: int, height: int) -> tuple[int, int]:
        return (height, width) if self.rot90_k in (1, -1) else (width, height)

    def apply(self, rgb: np.ndarray) -> np.ndarray:
        if self.rot90_k == 0:
            return rgb
        return np.ascontiguousarray(np.rot90(rgb, k=self.rot90_k))

    def describe(self) -> dict[str, object]:
        return {
            "display_matrix_present": self.display_matrix is not None,
            "display_matrix": list(self.display_matrix) if self.display_matrix is not None else None,
            "rotation_ccw_deg": self.rotation_ccw_deg,
            "transform_applied": self.transform,
            "mirror": False,
        }


IDENTITY: Final = Orientation(0, 0, None)


def parse_display_matrix(raw: bytes) -> tuple[int, ...]:
    if len(raw) != 36:
        raise UnsupportedOrientation("display matrix must be 36 bytes")
    return struct.unpack("<9i", raw)


def classify(matrix: tuple[int, ...] | None) -> Orientation:
    if matrix is None:
        return IDENTITY
    if len(matrix) != 9:
        raise UnsupportedOrientation("display matrix must have 9 entries")
    a, b, u, c, d, v, _x, _y, w = matrix
    if u != 0 or v != 0 or w != FP30:
        raise UnsupportedOrientation("projective display matrix")
    key = (a, b, c, d)
    if key not in _PURE_ROTATIONS:
        raise UnsupportedOrientation("display matrix is not a pure 90° rotation (mirror, scale or shear)")
    deg, k = _PURE_ROTATIONS[key]
    return Orientation(deg, k, tuple(matrix))
