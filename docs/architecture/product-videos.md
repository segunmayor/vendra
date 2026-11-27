# Product videos

Staff add videos to a product in Admin (Products, a product, Videos). The Store shows them under
the photos on the product page, with the main photo as the poster.

## Files

- MP4 (including M4V), QuickTime MOV and WebM, judged by their first bytes, never the name.
  MP4 (H.264) plays in every browser; MOV and WebM in most.
- Limits are settings (Settings, Product videos): largest video (default 50 MB) and most videos
  per product (default 3; 0 turns videos off). The system ceiling is 100 MB and 5 videos. Both
  settings are public, so Admin can show them to staff without settings.manage.
- Videos are `catalogue.product_media` rows like photos (`/media/<id>.mp4`), stored once per
  sha256, in the database or the active storage location. Moves and the CDN option (see
  file-storage.md) apply to them as to photos.
- A product's videos are `catalogue.products.videos` (JSON, display order). Reorder and remove
  only accept videos the product already has.

## Uploading

Videos are too large for Server Actions (21 MB). Admin's uploader posts to
`/uploads/product-videos/<productId>`, a route handler outside the session proxy (which would
buffer the body). It checks the request came from Admin's own pages (Origin), refreshes the
session if needed, and streams the body to `POST /v1/admin/products/:id/videos`. The browser
shows upload progress.

The API holds the upload in memory while it checks and stores it (at most 100 MB per request).

## Playback

`GET /v1/store/media/:file` answers byte ranges (206, `Content-Range`, `Accept-Ranges: bytes`;
416 past the end), so videos start quickly and shoppers can skip ahead. An open-ended range is
answered in pieces of at most 4 MB. Only the bytes asked for are read: `substring()` in
PostgreSQL, a ranged GET in S3, an offset read in Azure, a ranged download in MEGA. The portals'
`/media/` route passes ranges through. Videos in a location with a CDN redirect there, and the
CDN serves the ranges.

The portals' Content-Security-Policy allows `media-src 'self' blob: https:`.

## Not yet

- Videos in CSV product imports.
- Server-side transcoding or thumbnails: videos are served as uploaded.
- Links to YouTube or other video hosts.
