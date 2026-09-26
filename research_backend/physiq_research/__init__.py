"""PhysiQ / TissueOS Milestones 7–8 — local research backend.

A research-only service that turns an approved research video of one
bodyweight squat (sagittal view) into versioned, reproducible, derived
Stage-3 movement data (2D pose landmarks, a normalized skeleton, apparent 2D
joint-angle traces and phase timing). It is not connected to the consumer
app, never retains raw video, and estimates no force, load or risk.

Milestone 8 (``physiq_research.force_plate``, command line only) pairs such
an assessment with MEASURED force-plate data and evaluates separately
supplied estimates; it contains no estimator.
"""

__version__ = "0.1.0"
