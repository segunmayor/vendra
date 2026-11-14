# Staging (single host)

Runs the whole of Vendra on one Linux host with Docker:
- PostgreSQL;
- a one-off database migration;
- the API;
- the customer, admin and seller portals;
- Caddy in front, with automatic HTTPS.

The same files can run a first single-host production if the owner chooses that. A managed database and separate hosts are better once traffic grows.

Not yet run end to end: the development machine has no Docker daemon. The compose file is validated (`docker compose config`), and CI builds every image on each push.

## Host

- Ubuntu 24.04 LTS, at least 2 vCPU, 4 GB RAM and 40 GB disk. Choose Lagos or another region near Nigerian users.
- Docker Engine with the compose plugin.
- Firewall: allow 22 (SSH, keys only), 80 and 443. Nothing else.
- DNS: point the four domains in `.env` at the host before the first start, so Caddy can get certificates.

## First start

```bash
git clone <repo> vendra && cd vendra/infrastructure/staging
cp env.example .env && chmod 600 .env    # fill in domains and fresh secrets
docker compose up -d --build             # builds images, migrates, starts everything
docker compose ps                        # migrate: exited (0); others: running/healthy
```

Create the first administrator. They are asked to set up two-step sign-in on first sign-in.

```bash
docker compose run --rm -e ADMIN_EMAIL=you@example.ng -e ADMIN_PASSWORD='a-long-password' api node apps/api/dist/create-admin.js
```

Then check it from any machine:

```bash
node infrastructure/scripts/smoke.mjs --api https://$API_DOMAIN --store https://$STORE_DOMAIN \
  --admin https://$ADMIN_DOMAIN --sellers https://$SELLERS_DOMAIN
```

## Deploying a new version

```bash
git pull
VENDRA_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
```

The migration runs before the new API starts. Migrations only add to the schema, so the old API keeps working while it runs. If a migration fails, the API is not replaced. Read `docker compose logs migrate`.

## Backups

Daily, kept off the host (for example in the provider's object storage):

```bash
docker compose exec -T postgres pg_dump -U vendra -Fc vendra > vendra-$(date +%F).dump
```

Restore into an empty database:

```bash
docker compose exec -T postgres pg_restore -U vendra -d vendra --clean --if-exists < vendra-YYYY-MM-DD.dump
```

Test a restore before launch, and once a month after. A backup that has never been restored is not a backup.

Also keep `SETTINGS_ENCRYPTION_KEY` in the password manager. Without it, a restored database cannot read gateway keys or staff two-step sign-in.

## Useful commands

```bash
docker compose logs -f api                 # API log (JSON from Caddy, text from the API)
docker compose exec postgres psql -U vendra vendra
docker compose restart api
```
