# Brand and design system

Status: proposed direction, awaiting the project owner's approval. No logo exists yet. The wordmark is typeset.

## Direction

Vendra should feel **trustworthy, warm and unmistakably Nigerian**, without using flag colours or clichés. Trust is the main job: many shoppers are wary of paying online and of whether the item will arrive.

The palette comes from **adire**, the indigo-dyed Yoruba textile. Deep indigo is the brand colour, marigold is the accent, and a warm paper neutral replaces stark white. It also separates Vendra visually from the orange and magenta already associated with large Nigerian retailers.

## Tokens

Defined once in `packages/ui/src/styles.css`.

| Token | Value | Use |
| --- | --- | --- |
| Adire indigo | `#232F7A` | Brand, primary actions |
| Marigold | `#F4B02A` | Highlights, offers. Dark text only |
| Palm | `#0B6B52` | Vendor portal primary, success |
| Paper | `#FBF9F4` | Customer background |
| Ink | `#191C2B` | Text |

Typeface: Plus Jakarta Sans, for its legible numerals and friendly shape.

## Portal experiences

The portals share tokens and components. `data-portal` on `<html>` adjusts them.

| Portal | Character | Differences |
| --- | --- | --- |
| Customer | Warm, spacious, mobile-first | Paper background, larger radius, marigold offers |
| Admin | Calm, dense, information-first | Cool neutral background, compact radius, sidebar shell |
| Vendor | Practical, encouraging | Palm primary, sidebar shell, guided empty states |

## Principles

1. Design for mid-range Android phones on unreliable networks: small payloads, server rendering, no layout shift.
2. Always show prices as full naira amounts (`₦15,000.00`) with no ambiguity about delivery fees.
3. Every payment and delivery state is shown in plain language with what happens next.
4. Meet WCAG 2.2 AA contrast. Marigold is never used as a text colour on light backgrounds.
5. Admin and vendor tables must work with a keyboard.
