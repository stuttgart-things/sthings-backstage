# Multi-stage build for the backend package.
# Execute with the root of the repo as docker context.
#
# Before building, run in the repo root:
#   yarn install --immutable
#   yarn tsc
#   yarn build:backend
#
# Stage 1 compiles production deps (incl. native modules better-sqlite3 /
# isolated-vm) with the build toolchain. Stage 2 is a slim runtime that
# copies the result, so the compiler chain (g++, build-essential,
# linux-libc-dev kernel headers, python, dev headers) never ships in the
# final image. That toolchain accounted for ~180 of the image's
# HIGH/CRITICAL CVEs (linux-libc-dev alone = 136), none of which apply at
# runtime.
#
# NOTE: TechDocs is configured with generator.runIn: 'docker' (see
# app-config.yaml), so mkdocs/python are NOT needed in this image — the
# generator runs in a separate container. If you switch techdocs to
# generator.runIn: 'local', reinstate mkdocs in the runtime stage.

# ---------- Stage 1: builder (has the native build toolchain) ----------
FROM node:24-bookworm-slim AS builder

# Python interpreter for node-gyp
ENV PYTHON=/usr/bin/python3

# Build deps for native modules (better-sqlite3, isolated-vm).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 \
      g++ \
      build-essential \
      libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

# Files needed by Yarn
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml ./
COPY --chown=node:node backstage.json ./

ENV NODE_ENV=production

# Repo skeleton (package.json of every workspace) for a cache-friendly install.
COPY --chown=node:node yarn.lock package.json packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# ---------- Stage 2: runtime (no build toolchain) ----------
FROM node:24-bookworm-slim

# This disables node snapshot for the Scaffolder
ENV NODE_OPTIONS="--no-node-snapshot"
ENV NODE_ENV=production

USER node
WORKDIR /app

# Bring over the installed production node_modules (with compiled native
# bindings) and the workspace skeleton from the builder.
COPY --from=builder --chown=node:node /app ./

# Then the backend bundle and runtime config.
COPY --chown=node:node packages/backend/dist/bundle.tar.gz app-config*.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

CMD ["node", "packages/backend", "--config", "app-config.yaml"]
