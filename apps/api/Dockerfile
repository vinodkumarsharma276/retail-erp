# =============================================================================
# RetailERP API image (linux/amd64 and linux/arm64)
#
#   docker build -f apps/api/Dockerfile -t retailerp-api .      (from repo root)
#
# The image runs the esbuild bundle (apps/api/dist/index.js). It does NOT migrate
# on start: releases run `npx prisma migrate deploy` in a one-off container
# first (infra/vm/deploy.sh), so a failed migration never leaves a half-started API.
# =============================================================================

FROM node:22-bookworm-slim AS base
# Networks that block registry.npmjs.org can pass a mirror:
#   --build-arg NPM_REGISTRY=https://<mirror>/npm/
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/

# ---------------------------------------------------------------------------
# Build: all API dependencies (incl. dev) to bundle the source
# ---------------------------------------------------------------------------
FROM base AS builder
RUN npm ci --ignore-scripts --no-audit --no-fund \
      --workspace=apps/api --workspace=packages/shared-types --workspace=packages/shared-utils
COPY tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY packages/shared-utils ./packages/shared-utils
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/scripts ./apps/api/scripts
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace=apps/api

# ---------------------------------------------------------------------------
# Runtime: production dependencies, Prisma client + CLI, migrations, bundle
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace=apps/api \
 && npm cache clean --force
COPY apps/api/prisma/schema.prisma ./apps/api/prisma/schema.prisma
COPY apps/api/prisma/migrations ./apps/api/prisma/migrations
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
COPY --from=builder /app/apps/api/dist ./apps/api/dist

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.source="https://github.com/vinodkumarsharma276/retail-erp" \
      org.opencontainers.image.revision="${GIT_SHA}"

WORKDIR /app/apps/api
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]