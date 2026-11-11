-- Storefront search on PostgreSQL (decided 11 Nov 2026, instead of Meilisearch for launch).
-- Full-text search ranks results; trigram similarity on the name tolerates typos.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- unaccent() is not IMMUTABLE, so indexes and generated columns need a fixed-dictionary wrapper.
CREATE FUNCTION catalogue.search_text(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, value)) $$;

ALTER TABLE "catalogue"."products" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, catalogue.search_text("name")), 'A') ||
  setweight(to_tsvector('english'::regconfig, catalogue.search_text("description")), 'C')
) STORED;

CREATE INDEX "products_searchVector_idx" ON "catalogue"."products" USING GIN ("searchVector");
CREATE INDEX "products_name_trgm_idx" ON "catalogue"."products" USING GIN (catalogue.search_text("name") public.gin_trgm_ops);
-- Newest-first browsing of what customers can see.
CREATE INDEX "products_published_newest_idx" ON "catalogue"."products" ("createdAt" DESC, "id" DESC) WHERE "status" = 'published';
