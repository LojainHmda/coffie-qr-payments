# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Production image for Cloud Run.
#
# No AFS credentials are baked in. AFS_ENTITY_ID / AFS_ACCESS_TOKEN are read
# from the environment at runtime and must be supplied by Cloud Run, never by
# this file and never by the repository.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Telemetry off: this build runs unattended.
ENV NEXT_TELEMETRY_DISABLED=1
# The build only prerenders pages that do not touch AFS, so it needs no secrets.
RUN npm run build


FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run injects PORT; bind every interface so its proxy can reach us.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `output: "standalone"` produces server.js plus only the needed dependencies.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 8080

CMD ["node", "server.js"]
