# File storage

Uploaded files (product photos, seller documents) are kept either in the database or in a
storage service that staff choose in Admin, under Settings, File storage. Nothing about a
particular account is in code or environment variables.

## Locations

- **This server's database** is built in. With no active location, each module keeps file bytes
  in its own table (`catalogue.product_media.content`, `sellers.seller_documents.content`).
- **Storage locations** (`storage.locations`) are services staff add: Amazon S3, S3-compatible
  services (Cloudflare R2, DigitalOcean Spaces, Backblaze B2, Wasabi, MinIO), Google Cloud
  Storage (through its S3 interface with HMAC keys), Azure Blob Storage and MEGA. Credentials
  are sealed with `SETTINGS_ENCRYPTION_KEY` (AES-256-GCM) and only their last four characters
  are ever returned.
- At most one location is active (a partial unique index). It must pass a live check (write,
  read back, delete a small file inside its folder) before it becomes active, and an active
  location's changed settings are checked before they are saved.

## Writing and reading

- `FileStorage.put` (the `storage` module's public contract) writes to the active location and
  records the file in `storage.objects`; the owning row then holds `storageObjectId` instead of
  bytes. A check constraint requires one or the other.
- If the active location fails, the upload fails with `storage.write_failed`. It never falls back
  to the database: staff chose to keep files off this server.
- A file is always read from where it was written, so changing the active location never breaks
  existing files. A location holding files cannot be removed.
- Keys are `<folder>/<purpose>/<yyyy>/<mm>/<id>.<ext>`. A name a person chose never reaches the
  bucket.
- Every file is served through the API (`/v1/store/media/:file` for photos, permission-checked
  routes for seller documents), so buckets and containers stay private. The portals pass photos
  through at `/media/:file`, cached for a year (a new photo always gets a new name).

## Drivers

`modules/storage/infrastructure`: `S3Driver` (`@aws-sdk/client-s3`), `AzureBlobDriver`
(`@azure/storage-blob`, shared key; the container is created private on first use) and
`MegaDriver` (`megajs`; one sign-in kept per location, operations one at a time, accounts with
two-step sign-in cannot be used). Drivers turn service errors into plain reasons for staff.

`test/integration/storage-drivers.int-spec.ts` runs the real drivers against real services or
emulators when `STORAGE_TEST_*` variables are set (see the file), and is skipped otherwise.

## Moving existing files

Admin, File storage, Move existing files (`/v1/admin/storage/moves`) moves every file not yet in
the active location (still in the database, or in an earlier location) into it, in the
background (`StorageMovePoller`, every `STORAGE_MOVE_POLL_MS`; 0 turns it off).

- The storage module never reads other modules' tables. Each module that keeps files registers a
  `FileHolder` (catalogue: product photos; vendors: seller documents) with `FileHolders`, which
  lists its files, reads bytes still in the database, and switches a row to a stored object.
- Each file is copied, read back and compared by sha256 with the checksum recorded at upload.
  Only then is the row switched (and only if it still points where it did); bytes in the
  database are cleared at the same moment. A file is never left without a working copy.
- Old copies in other locations are deleted afterwards if staff ask (the default), or kept and
  marked `supersededAt` (not counted as in use; a location holding only such copies can be
  removed).
- Staff choose how many files are copied at the same time (1 to 10, default 4). Outcomes are
  recorded in file order: the saved position only passes a file once every file before it is
  done, so a restart never skips one (a file finished but not yet recorded is simply found to be
  in place, and skipped). MEGA's driver still runs one request at a time.
- Progress is saved as files finish, so a restart resumes where it stopped; a lease lets
  another API instance take over a crashed move. One move at a time (partial unique index).
- A move stops if staff stop it, if another location becomes active, or after 10 files in a row
  fail (the target is probably down). Files that fail stay where they are and keep working;
  starting another move retries them.
- Bytes cleared from the database are returned to PostgreSQL by autovacuum; the database file on
  disk shrinks only after a `VACUUM FULL` of those tables, done in a maintenance window.

## Not yet

- Moving files back into the database.
- Serving photos straight from a CDN or public bucket address.
