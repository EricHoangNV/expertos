# NestJS API image for Cloud Run. Build context = repo root (pnpm workspace).
#   docker build -f apps/api/Dockerfile -t <region>-docker.pkg.dev/<proj>/expertos/api .
# Cloud Run injects PORT; main.ts binds 0.0.0.0:$PORT (see apps/api/src/main.ts).
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# openssl + ca-certificates are required by the Prisma query engine at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# `@expertos/api...` builds the api plus its workspace deps (db, shared); the db
# build runs `prisma generate`, so the client + engine land in packages/db.
RUN pnpm --filter "@expertos/api..." build
# Emit a self-contained prod deployment (dist + prod node_modules, workspace
# deps resolved) into /prod/api.
RUN pnpm --filter "@expertos/api" deploy --prod /prod/api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api ./
USER node
CMD ["node", "dist/main.js"]
