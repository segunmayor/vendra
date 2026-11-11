# Storefront and search

## What a customer can see

A product appears on the storefront only when both of these are true:

1. The product is **published**. Drafts and archived products are hidden.
2. At least one variant has an **active listing**, that is, a price that is on sale.

Out-of-stock products stay visible, marked "Out of stock", so shoppers can still find them. Variants without an active listing are left off the product page.

This rule also covers archiving: an archived product disappears from the storefront even if its listing was left active.

| Stock available | Customer sees |
| --- | --- |
| 0 | Out of stock |
| 1 to 5 | Only N left |
| More than 5 | In stock, with no number |

Exact stock levels, seller IDs and internal fields are never returned.

## Modules

`storefront` owns no data. It reads three contracts and combines them:

| Contract | Owner | Gives |
| --- | --- | --- |
| `StorefrontCatalogue` | `catalogue` | Published products, search, category tree, product details |
| `ListingQueries.activeOffers` | `listings` | Active price per variant (the cheapest, if several sellers) |
| `InventoryQueries.availableByListing` | `inventory` | Units available, reservations already subtracted |

Endpoints, all public and cacheable for 30 to 60 seconds:

- `GET /v1/store/categories`: categories that have published products, with counts that include subcategories.
- `GET /v1/store/products?q=&category=&brand=&cursor=&limit=`: newest first, or by relevance when `q` is set. A category includes its subcategories.
- `GET /v1/store/products/{slug}`: the product page.

Because catalogue search cannot see listings, `storefront` filters each batch and reads up to 4 batches to fill a page. The `nextCursor` always points just after the last product returned, so nothing is skipped or repeated. Cursors are opaque, and a tampered one is rejected with 422.

## Search

**Decision, 11 November 2026:** launch search runs on PostgreSQL instead of Meilisearch. Postgres search is always consistent with the catalogue, needs no index-sync job, and adds no service to host. It suits a launch-size catalogue of thousands of products.

- Full-text search (`english` configuration) over the product name (weight A) and description (weight C), in a generated `searchVector` column with a GIN index.
- Typo tolerance: `pg_trgm` word similarity on the name, with a threshold of 0.5. Tested: "ankra" finds Ankara, "agbda" finds Agbada, "tecnno" finds Tecno, and "shoe" does not match "shirt".
- Brand and category names also match.
- Accents and case are ignored (`unaccent`).

Ranking is full-text rank, plus name similarity, plus a boost for a brand match.

`ProductSearch` is a port. A Meilisearch adapter can replace `PostgresProductSearch` later without changing the API or the portal. That would also need the outbox relay to keep the index current.

**Limits at launch:** no price sorting or price filters, no facet counts, and search paging stops after 1,000 results.

## Customer portal

- Pages: `/` (home), `/products`, `/c/[slug]` (category), `/search?q=`, `/p/[slug]` (product, `?v=SKU` selects an option).
- Server-rendered, and option choice works without JavaScript.
- Catalogue data is cached for up to 30 seconds. Cart and checkout must re-check live price and stock (Step 5).
- Pages read data at request time through `connection()`, so building the portal needs no running API.
- Product pages include schema.org `Product` data, so search engines can show price and stock.
- Search result pages are marked `noindex`.
