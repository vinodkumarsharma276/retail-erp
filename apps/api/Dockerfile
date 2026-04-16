# =============================================================================
# RetailERP API — Multi-stage Docker build
# Handles npm workspaces (monorepo) by copying the full workspace context
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy workspace package.json files (needed for npm ci to resolve workspaces)
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages/shared-types/package.json packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/tsconfig.json ./packages/shared-utils/

# Install all dependencies (workspace-aware)
RUN npm ci

# Copy source code for shared packages (API depends on these)
COPY packages/shared-types/src ./packages/shared-types/src
COPY packages/shared-utils/src ./packages/shared-utils/src

# Copy API source code and Prisma schema
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma

# Generate Prisma client
RUN npm run db:generate --workspace=apps/api

# Build shared packages first (API imports them)
RUN npx turbo build --filter=@retailerp/shared-types --filter=@retailerp/shared-utils

# Build the API
RUN npm run build --workspace=apps/api

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy root workspace files
COPY package.json package-lock.json ./

# Copy workspace package.json files
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=apps/api --workspace=packages/shared-types --workspace=packages/shared-utils

# Copy built artifacts from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=builder /app/packages/shared-types/src ./packages/shared-types/src
COPY --from=builder /app/packages/shared-utils/src ./packages/shared-utils/src

# The shared packages use "main": "./src/index.ts" — in production the API's
# compiled JS still resolves them through node_modules via workspace symlinks.
# Since they are TS-only packages with no build step, we keep their src/ as-is
# and they are resolved at runtime by Node's module resolution.

# Own the app directory
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

# Run Prisma migrations then start the server
# Using dumb-init ensures Node.js receives SIGTERM properly
CMD ["dumb-init", "sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/index.js"]
