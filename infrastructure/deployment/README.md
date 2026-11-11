# Deployment

The hosting provider is not yet chosen. Every unit is a container, so the design does not depend on one.

| Unit | Image build | Runtime configuration |
| --- | --- | --- |
| customer, admin, vendor | `portal.Dockerfile`, `--build-arg APP=<name>` | `API_BASE_URL` |
| api | `backend.Dockerfile`, `--build-arg APP=api` | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `CORS_ORIGINS`, `PORT` |
| worker | `backend.Dockerfile`, `--build-arg APP=worker` | `REDIS_URL` |

Release order for a backend change:

1. Run `prisma migrate deploy` using `DIRECT_DATABASE_URL`.
2. Deploy the API and check `GET /v1/health/ready`.
3. Deploy the worker.
4. Deploy any portal consuming a changed contract.
