"""TissueOS Milestone 8 — force-plate validation infrastructure (research only).

Pairs ONE existing, immutable Milestone 7 assessment of a sagittal
bodyweight squat with MEASURED vertical force-plate data:

    canonical force-plate CSV + explicit JSON manifest
      + existing M7 assessment (media-time coordinates, repetition events)
      + explicit synchronization anchors
      → canonical measured signal          (force acquisition time)
      → synchronization into M7 media time  (declared anchors only)
      → overlap and measurement checks
      → versioned measured vertical-GRF ground-truth artifact
      → evaluator for FUTURE video-derived estimates

Scope and boundary:
    * one movement (bodyweight_squat_sagittal), one capture mode
      (single_camera_sagittal), one force plate with both feet on it, one
      target: total vertical ground-reaction force;
    * the force plate is the measured ground truth; nothing derived from
      video is ever called ground truth;
    * no estimator, no learned model and no training exist here: the
      evaluator only compares a separately supplied estimate with measured
      force;
    * no joint kinetics, no tissue quantities, no judgement of the person;
    * local command-line tooling (``python -m physiq_research.force_plate``):
      no HTTP route, no consumer-app integration.

Design, contracts and non-claims: FORCE_PLATE_VALIDATION.md.
"""
