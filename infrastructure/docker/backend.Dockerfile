# Build the API or worker: docker build -f infrastructure/docker/backend.Dockerfile --build-arg APP=api .
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl

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

FROM base AS runtime
ARG APP
ENV NODE_ENV=production APP=${APP}
WORKDIR /repo
COPY --from=build --chown=node /repo ./
USER node
CMD ["sh", "-c", "node apps/${APP}/dist/main.js"]
