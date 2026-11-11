# Build one portal: docker build -f infrastructure/docker/portal.Dockerfile --build-arg APP=customer .
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS pruned
ARG APP
WORKDIR /repo
COPY . .
RUN npx turbo@2 prune @vendra/${APP} --docker

FROM base AS build
ARG APP
WORKDIR /repo
COPY --from=pruned /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ .
RUN pnpm turbo run build --filter=@vendra/${APP}

FROM node:22-alpine AS runtime
ARG APP
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 APP=${APP}
WORKDIR /app
USER node
COPY --from=build --chown=node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
EXPOSE 3000
CMD ["sh", "-c", "node apps/${APP}/server.js"]
