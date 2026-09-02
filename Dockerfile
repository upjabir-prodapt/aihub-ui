# AI Hub BFF — one container, one Cloud Run service `aihub-bff` (decision D1).
#
# Stage 1 builds the SPA. Stage 2 installs Python dependencies into a virtualenv.
# Stage 3 is the runtime: it copies the venv and the built bundle into a slim
# image and runs as a non-root user.
#
# Gap G15 container hardening, and how each requirement is met:
#   non-root user            -> `USER app` (uid 10001), created in the runtime stage
#   read-only root filesystem-> set at deploy time (`--execution-environment` /
#                               Cloud Run `readOnlyRootFilesystem`); nothing here
#                               writes outside /tmp, and PYTHONDONTWRITEBYTECODE
#                               stops .pyc files appearing next to the source
#   minimal base             -> python:3.11-slim, build toolchain confined to stage 2
#   no shell                 -> not achievable with python-slim; see the note below
#   dependency + secret scan -> CI stages in .gitlab-ci.yml
#   secrets from Secret Manager, never env vars -> app/secrets/manager.py; no
#                               ARG or ENV in this file carries a secret value
#
# On "no shell": a distroless Python base (gcr.io/distroless/python3) removes the
# shell but pins the interpreter minor version to whatever Google ships and makes
# native wheels (cryptography, grpcio) awkward. python:3.11-slim is the pragmatic
# choice; the shell is present but unreachable without code execution, and the
# service account it would run as holds only the four roles in plan task 35.
# Revisit if the platform mandates distroless.

# ── Stage 1: build the SPA ───────────────────────────────────────────────────
FROM node:24-alpine AS frontend

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# ── Stage 2: python dependencies ─────────────────────────────────────────────
FROM python:3.11-slim AS pydeps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build tools stay in this stage and never reach the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY bff/pyproject.toml /src/pyproject.toml
WORKDIR /src
# `app` must exist for the editable-style metadata build to resolve packages.
RUN mkdir -p app && touch app/__init__.py && pip install --no-cache-dir .


# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8080 \
    SPA_DIST_DIR=/srv/static

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=pydeps /opt/venv /opt/venv

WORKDIR /srv
COPY --chown=root:root bff/app /srv/app
COPY --from=frontend --chown=root:root /build/dist /srv/static

# Application code is read-only to the runtime user: the process has no reason
# to modify its own source, and a read-only root filesystem makes that explicit.
RUN chmod -R a-w /srv

USER 10001:10001

EXPOSE 8080

# No healthcheck instruction: Cloud Run probes /healthz over HTTP itself, and a
# container-level HEALTHCHECK would need curl in the image.
#
# `sh -c` is required so $PORT expands. Cloud Run always sets it.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-server-header --proxy-headers --forwarded-allow-ips='*'"]
