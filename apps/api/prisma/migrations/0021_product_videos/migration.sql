-- Product videos, in display order. The files are product_media rows, like photos.
ALTER TABLE "catalogue"."products" ADD COLUMN "videos" JSONB NOT NULL DEFAULT '[]';
