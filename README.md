# Vendra

Multi-category retail and marketplace platform. Owned by Datakript Teknologies.

Three independently deployed Next.js portals, one NestJS modular-monolith API, and a background worker. Start with [docs/README.md](docs/README.md).

## Setup

Requires Node 22.18+ and pnpm 10.

```bash
pnpm install
pnpm --filter @vendra/api exec prisma generate
cp .env.example apps/api/.env
pnpm infra:up          # PostgreSQL and Redis (needs Docker)
pnpm --filter @vendra/api exec prisma migrate deploy
pnpm dev
```

Create the first administrator once, after building the API:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' pnpm --filter @vendra/api admin:create
```

On first sign-in Admin asks them to set up two-step sign-in with an authenticator app. This needs `SETTINGS_ENCRYPTION_KEY` to be set (see `.env.example`).

## Checks

```bash
pnpm typecheck
pnpm test              # includes the architecture rules
pnpm --filter @vendra/api test:integration   # needs a migrated database named *dev* or *test*
pnpm build
pnpm contract          # regenerate OpenAPI and the API client after changing the API
```
