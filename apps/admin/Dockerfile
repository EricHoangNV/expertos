# Next.js admin portal (standalone) for Cloud Run. Build context = repo root.
#   docker build -f apps/admin/Dockerfile -t <region>-docker.pkg.dev/<proj>/expertos/admin .
# Next's standalone server reads PORT (Cloud Run injects it) and HOSTNAME.
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@expertos/admin..." build

FROM node:20-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# outputFileTracingRoot=repo root, so standalone mirrors the monorepo layout:
# server entry is apps/admin/server.js with traced node_modules at the root.
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
# NOTE: add `COPY --from=build /app/apps/admin/public ./apps/admin/public` once a
# public/ dir exists (omitted now — COPY of a missing path fails the build).
USER node
CMD ["node", "apps/admin/server.js"]
