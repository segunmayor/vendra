import { Prisma, type PrismaClient } from '@prisma/client';
import { JournalRepository } from '../application/ports';
import { JournalEntry } from '../domain/journal-entry';

export class PrismaJournalRepository implements JournalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: JournalEntry): Promise<'posted' | 'duplicate'> {
    try {
      await this.prisma.journalEntry.create({
        data: {
          id: entry.id,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          paymentId: entry.paymentId,
          postedAt: entry.postedAt,
          lines: {
            create: entry.lines.map((line) => ({
              accountCode: line.accountCode,
              side: line.side,
              amountMinor: line.amount.minor,
              currency: line.amount.currency,
            })),
          },
        },
      });
      return 'posted';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate';
      }
      throw error;
    }
  }

  async balanceFor(paymentId: string, accountCode: string): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<{ balance: bigint | null }[]>`
      SELECT COALESCE(SUM(CASE WHEN l.side = 'credit' THEN l."amountMinor" ELSE -l."amountMinor" END), 0)::bigint AS balance
      FROM ledger.journal_lines l JOIN ledger.journal_entries e ON e.id = l."entryId"
      WHERE e."paymentId" = ${paymentId}::uuid AND l."accountCode" = ${accountCode}`;
    return BigInt(row?.balance ?? 0n);
  }
}
