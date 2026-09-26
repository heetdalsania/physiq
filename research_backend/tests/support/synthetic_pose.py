"""Python port of test/fixtures/syntheticPose.js (Milestone 6 test fixture).

Hand-checkable stick figure: ankle fixed; the shank tilts forward by
φ = (180 − θ)/2 from vertical and the thigh back by the same φ, so the
included knee angle is exactly θ; the trunk leans forward by ψ, so the
trunk–thigh angle is 180 − (φ + ψ). No person, photo or video is involved.
"""

from __future__ import annotations

import math
from typing import Any

IDX = {
    "nose": 0,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_heel": 29,
    "right_heel": 30,
    "left_foot_index": 31,
    "right_foot_index": 32,
}

DEFAULT_SQUAT = {"standDeg": 175, "bottomDeg": 95, "descentAt": 3000, "bottomAt": 4200, "riseAt": 4600, "standAt": 5800}


def rad(deg: float) -> float:
    return deg * math.pi / 180


def stick_figure(knee_deg: float, lean_deg: float, **opts: float) -> dict[str, tuple[float, float]]:
    o = {"ankleX": 320.0, "ankleY": 440.0, "shank": 100.0, "thigh": 100.0, "trunk": 130.0, "head": 50.0, **opts}
    phi = rad((180 - knee_deg) / 2)
    psi = rad(lean_deg)
    ankle = (o["ankleX"], o["ankleY"])
    knee = (ankle[0] + o["shank"] * math.sin(phi), ankle[1] - o["shank"] * math.cos(phi))
    hip = (knee[0] - o["thigh"] * math.sin(phi), knee[1] - o["thigh"] * math.cos(phi))
    shoulder = (hip[0] + o["trunk"] * math.sin(psi), hip[1] - o["trunk"] * math.cos(psi))
    nose = (shoulder[0] + 12, shoulder[1] - o["head"])
    heel = (ankle[0] - 14, ankle[1] + 6)
    foot = (ankle[0] + 34, ankle[1] + 8)
    return {
        "ankle": ankle,
        "knee": knee,
        "hip": hip,
        "shoulder": shoulder,
        "nose": nose,
        "heel": heel,
        "foot_index": foot,
    }


def provider_pose(knee_deg: float, lean_deg: float, **options: Any) -> list[dict[str, float]]:
    o: dict[str, Any] = {
        "width": 640,
        "height": 480,
        "visibleSide": "left",
        "nearVisibility": 0.95,
        "farVisibility": 0.3,
        "farOffsetX": 6,
        "frontalHipSeparation": 0,
        "shiftX": 0,
        "figure": {},
        **options,
    }
    near = stick_figure(knee_deg, lean_deg, **{"ankleX": 320 + o["shiftX"], **o["figure"]})
    far = stick_figure(knee_deg, lean_deg, **{"ankleX": 320 + o["shiftX"] + o["farOffsetX"], **o["figure"]})
    sep = o["frontalHipSeparation"]
    far_side = "right" if o["visibleSide"] == "left" else "left"
    pts = [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.1} for _ in range(33)]

    def put(name: str, p: tuple[float, float], vis: float) -> None:
        pts[IDX[name]] = {"x": p[0] / o["width"], "y": p[1] / o["height"], "z": 0.0, "visibility": vis}

    near_dx = -sep / 2 if sep else 0
    far_dx = sep / 2 if sep else 0
    put("nose", near["nose"], o["nearVisibility"])
    for side, fig, vis, dx in (
        (o["visibleSide"], near, o["nearVisibility"], near_dx),
        (far_side, far, o["farVisibility"], far_dx),
    ):
        for part in ("shoulder", "hip", "knee", "ankle", "heel", "foot_index"):
            x, y = fig[part]
            put(f"{side}_{part}", (x + dx, y), vis)
    return pts


def squat_knee_at(t_ms: float, spec: dict[str, float] | None = None) -> float:
    s = {**DEFAULT_SQUAT, **(spec or {})}
    if t_ms <= s["descentAt"]:
        return s["standDeg"]
    if t_ms < s["bottomAt"]:
        return s["standDeg"] - (s["standDeg"] - s["bottomDeg"]) * (t_ms - s["descentAt"]) / (
            s["bottomAt"] - s["descentAt"]
        )
    if t_ms <= s["riseAt"]:
        return s["bottomDeg"]
    if t_ms < s["standAt"]:
        return s["bottomDeg"] + (s["standDeg"] - s["bottomDeg"]) * (t_ms - s["riseAt"]) / (s["standAt"] - s["riseAt"])
    return s["standDeg"]


def lean_for_knee(knee_deg: float, spec: dict[str, float] | None = None) -> float:
    s = {**DEFAULT_SQUAT, **(spec or {})}
    return 35 * (s["standDeg"] - knee_deg) / (s["standDeg"] - s["bottomDeg"])


def provider_result_at(t_ms: float, scenario: str = "squat", **options: Any) -> dict[str, Any]:
    spec = options.get("spec")
    if scenario == "none":
        return {"landmarks": []}
    if scenario == "garbage":
        return {"landmarks": [[{"x": math.nan, "y": math.inf, "visibility": 2}]]}
    knee = 175.0
    if scenario in ("squat", "front", "two", "low"):
        knee = squat_knee_at(t_ms, spec)
    if scenario == "twoSquats":
        second = {**DEFAULT_SQUAT, "descentAt": 6600, "bottomAt": 7400, "riseAt": 7600, "standAt": 8400}
        knee = min(squat_knee_at(t_ms, spec), squat_knee_at(t_ms, second))
    if scenario == "shallow":
        knee = squat_knee_at(t_ms, {**(spec or {}), "bottomDeg": 165})
    if scenario == "partial":
        knee = 175 if t_ms <= 3000 else max(95, 175 - (t_ms - 3000) / 1200 * 80)
    lean = lean_for_knee(knee)
    pose_opts = dict(options.get("pose", {}))
    if scenario == "front":
        pose_opts.update(frontalHipSeparation=60, farOffsetX=0, farVisibility=0.95)
    if scenario == "low":
        pose_opts.update(nearVisibility=0.3)
    pose = provider_pose(knee, lean, **pose_opts)
    if scenario == "two":
        return {"landmarks": [pose, provider_pose(175, 0, shiftX=200)]}
    return {"landmarks": [pose]}
