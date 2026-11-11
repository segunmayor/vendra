import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ApplicationError, AuditEntry, ConcurrencyConflict, Money } from '../../../shared-kernel';
import { ListingRepository } from '../application/listings';
import { Listing, ListingStatus } from '../domain/listing';

type Row = Prisma.ListingGetPayload<object>;

const toListing = (row: Row): Listing =>
  Listing.rehydrate({
    id: row.id,
    variantId: row.variantId,
    sellerId: row.sellerId,
    price: Money.of(row.priceMinor, row.currency),
    status: row.status as ListingStatus,
    version: row.version,
  });

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Listing | null> {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    return row ? toListing(row) : null;
  }

  async listByVariants(variantIds: readonly string[]): Promise<Listing[]> {
    const rows = await this.prisma.listing.findMany({ where: { variantId: { in: [...variantIds] } }, orderBy: { id: 'asc' } });
    return rows.map(toListing);
  }

  async save(listing: Listing, audit: AuditEntry): Promise<void> {
    const state = listing.snapshot;
    const events = listing.pullEvents();
    const fields = { priceMinor: state.price.minor, currency: state.price.currency, status: state.status };
    try {
      await this.prisma.$transaction(async (tx) => {
        if (state.version === 0) {
          await tx.listing.create({ data: { ...fields, id: state.id, variantId: state.variantId, sellerId: state.sellerId, version: 1 } });
        } else {
          const { count } = await tx.listing.updateMany({
            where: { id: state.id, version: state.version },
            data: { ...fields, version: { increment: 1 } },
          });
          if (count !== 1) throw new ConcurrencyConflict('Listing', state.id);
        }
        await appendAudit(tx, audit);
        await appendToOutbox(tx, events);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApplicationError('conflict', 'listing.exists', 'This variant is already listed by this seller');
      }
      throw error;
    }
    listing.markSaved();
  }
}
