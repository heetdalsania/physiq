# syntax=docker/dockerfile:1
# PhysiQ research backend — ONE image for the API, the worker and the
# migration job (local research stack; see compose.yaml).
#
# Build context is the REPOSITORY ROOT so the vendored Milestone 6 model is
# reused rather than duplicated:
#   docker build -f research_backend/Dockerfile -t physiq-research:local .
#
# linux/amd64 only: mediapipe 0.10.31 publishes no linux/aarch64 wheel
# (Apple-silicon hosts run this image under emulation).

FROM --platform=linux/amd64 python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --system --uid 10001 --create-home --home-dir /home/research research

WORKDIR /srv/research_backend
COPY research_backend/requirements.lock.txt ./
RUN pip install --no-deps -r requirements.lock.txt \
 && python -c "import importlib.metadata as m; assert m.version('mediapipe') == '0.10.31', m.version('mediapipe')"

# The pose model: Milestone 6's vendored file, verified by SHA-256 at build time
# (and again by the worker before every use).
COPY vendor/mediapipe/pose_landmarker_full.task /srv/models/pose_landmarker_full.task
RUN echo "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1  /srv/models/pose_landmarker_full.task" | sha256sum -c -

COPY research_backend/pyproject.toml research_backend/alembic.ini ./
COPY research_backend/migrations ./migrations
COPY research_backend/physiq_research ./physiq_research

RUN install -d -o research -g research -m 0700 /var/lib/research/uploads
ENV RESEARCH_POSE_MODEL_PATH=/srv/models/pose_landmarker_full.task \
    RESEARCH_UPLOAD_DIR=/var/lib/research/uploads \
    PYTHONPATH=/srv/research_backend
USER research
CMD ["python", "-m", "physiq_research.api"]

# Test image: the full pytest suite on Linux (used by `docker compose run tests`).
FROM runtime AS test
USER root
COPY research_backend/requirements-dev.lock.txt ./
RUN pip install --no-deps -r requirements-dev.lock.txt
COPY research_backend/tests ./tests
COPY research_backend/tools ./tools
RUN chown -R research:research /srv/research_backend
USER research
CMD ["python", "-m", "pytest", "-q"]
