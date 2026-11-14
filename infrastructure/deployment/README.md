# Deployment

The hosting provider is not yet chosen. Every unit is a container, so the design does not depend on one.

| Unit | Image build | Runtime configuration |
| --- | --- | --- |
| customer, admin, vendor | `portal.Dockerfile`, `--build-arg APP=<name>` | `API_BASE_URL`, `PORTAL_SHARED_SECRET`, `PORTAL_TRUST_PROXY_HOPS` |
| api | `backend.Dockerfile`, `--build-arg APP=api` | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `PORTAL_SHARED_SECRET`, `CORS_ORIGINS` (https only), `TRUST_PROXY_HOPS`, `PORT`. In production it will not start without the secrets. |
| worker | `backend.Dockerfile`, `--build-arg APP=worker` | `REDIS_URL`. Not needed at launch: it has no jobs yet, and the API runs its own timers. |

Release order for a backend change:

1. Run `prisma migrate deploy` using `DIRECT_DATABASE_URL`.
2. Deploy the API and check `GET /v1/health/ready`.
3. Deploy the worker.
4. Deploy any portal consuming a changed contract.

A complete single-host setup (database, migration, API, portals and HTTPS proxy) is in [`../staging`](../staging/README.md). After every deployment, run the read-only checks:

```bash
node infrastructure/scripts/smoke.mjs --api https://… --store https://… --admin https://… --sellers https://…
```
