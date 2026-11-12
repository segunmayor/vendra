import { DomainError } from '../../../shared-kernel';


export interface RequestedLine {
  readonly listingId: string;
  readonly quantity: number;
}

export interface StockRow {
  readonly stockItemId: string;
  readonly listingId: string;
  readonly available: number;
}

export interface Allocation {
  readonly stockItemId: string;
  readonly listingId: string;
  readonly quantity: number;
}

export interface Shortfall {
  readonly listingId: string;
  readonly requested: number;
  readonly available: number;
}

/**
 * Merges duplicate listings and checks quantities before anything is locked. `maxPerListing`
 * (setting shopping.maxQuantityPerItem) stops one buyer emptying the shelf.
 */
export function normalizeLines(lines: readonly RequestedLine[], maxPerListing: number): RequestedLine[] {
  if (lines.length === 0) throw new DomainError('reservation.empty', 'Nothing to reserve');
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new DomainError('reservation.invalid_quantity', 'Quantities must be whole numbers of at least 1');
    }
    totals.set(line.listingId, (totals.get(line.listingId) ?? 0) + line.quantity);
  }
  for (const [, quantity] of totals) {
    if (quantity > maxPerListing) {
      throw new DomainError('reservation.too_many', `You can buy at most ${maxPerListing} of one item per order`);
    }
  }
  return [...totals].map(([listingId, quantity]) => ({ listingId, quantity }));
}

/**
 * Decides which warehouse supplies each line: the fullest first, so an order splits across
 * as few warehouses as possible. All or nothing: any shortfall means no allocation.
 */
export function allocate(
  lines: readonly RequestedLine[],
  stock: readonly StockRow[],
): { ok: true; allocations: Allocation[] } | { ok: false; shortfalls: Shortfall[] } {
  const allocations: Allocation[] = [];
  const shortfalls: Shortfall[] = [];
  for (const line of lines) {
    const rows = stock
      .filter((row) => row.listingId === line.listingId && row.available > 0)
      .sort((a, b) => b.available - a.available || a.stockItemId.localeCompare(b.stockItemId));
    const available = rows.reduce((sum, row) => sum + row.available, 0);
    if (available < line.quantity) {
      shortfalls.push({ listingId: line.listingId, requested: line.quantity, available });
      continue;
    }
    let remaining = line.quantity;
    for (const row of rows) {
      if (remaining === 0) break;
      const take = Math.min(remaining, row.available);
      allocations.push({ stockItemId: row.stockItemId, listingId: line.listingId, quantity: take });
      remaining -= take;
    }
  }
  return shortfalls.length > 0 ? { ok: false, shortfalls } : { ok: true, allocations };
}
