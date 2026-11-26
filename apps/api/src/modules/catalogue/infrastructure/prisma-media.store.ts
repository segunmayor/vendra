import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Hasher, MediaStore, StoredMedia } from '../application/ports';
import { IMAGE_EXTENSIONS } from '../domain/image-file';
import { FileHolder, FileStorage, HeldFile } from '../../storage';

const extensionOf = (contentType: string): string =>
  Object.entries(IMAGE_EXTENSIONS).find(([, type]) => type === contentType)?.[0] ?? 'bin';

const view = (row: { id: string; contentType: string }): StoredMedia => ({ id: row.id, contentType: row.contentType, extension: extensionOf(row.contentType) });

/** Photos in PostgreSQL for launch. Object storage can implement MediaStore later without changing callers. */
export class PrismaMediaStore implements MediaStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly files: FileStorage,
  ) {}

  async findBySourceUrl(url: string): Promise<StoredMedia | null> {
    const row = await this.prisma.productMedia.findFirst({ where: { sourceUrl: url }, select: { id: true, contentType: true }, orderBy: { createdAt: 'desc' } });
    return row ? view(row) : null;
  }

  async save(media: { id: string; sha256: string; contentType: string; content: Uint8Array; sourceUrl: string | null }): Promise<StoredMedia> {
    const existing = await this.prisma.productMedia.findUnique({ where: { sha256: media.sha256 }, select: { id: true, contentType: true } });
    if (existing) return view(existing);
    // To the active storage location, if there is one; otherwise the bytes stay in this table.
    const stored = await this.files.put({ purpose: 'product-media', contentType: media.contentType, extension: extensionOf(media.contentType), content: media.content, sha256: media.sha256 });
    try {
      await this.prisma.productMedia.create({
        data: {
          id: media.id,
          sha256: media.sha256,
          contentType: media.contentType,
          sizeBytes: media.content.length,
          content: stored ? null : Buffer.from(media.content),
          storageObjectId: stored?.objectId ?? null,
          sourceUrl: media.sourceUrl,
        },
      });
      return view(media);
    } catch (error) {
      // Another import stored the same file at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.productMedia.findUniqueOrThrow({ where: { sha256: media.sha256 }, select: { id: true, contentType: true } });
        return view(winner);
      }
      throw error;
    }
  }

  async objectIdsOf(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.productMedia.findMany({ where: { id: { in: [...ids] }, storageObjectId: { not: null } }, select: { id: true, storageObjectId: true } });
    return new Map(rows.map((row) => [row.id, row.storageObjectId!]));
  }

  async read(id: string): Promise<{ contentType: string; content: Uint8Array } | null> {
    const row = await this.prisma.productMedia.findUnique({ where: { id }, select: { contentType: true, content: true, storageObjectId: true } });
    if (!row) return null;
    if (row.content) return { contentType: row.contentType, content: new Uint8Array(row.content) };
    const content = row.storageObjectId ? await this.files.get(row.storageObjectId) : null;
    return content ? { contentType: row.contentType, content } : null;
  }
}

export const sha256Hasher: Hasher = { sha256: (bytes) => createHash('sha256').update(bytes).digest('hex') };

/** Lets the storage module move product photos between the database and storage locations. */
export class ProductMediaFiles implements FileHolder {
  readonly purpose = 'product-media' as const;

  constructor(private readonly prisma: PrismaClient) {}

  async scan(afterRowId: string | null, limit: number): Promise<HeldFile[]> {
    const rows = await this.prisma.productMedia.findMany({
      where: afterRowId ? { id: { gt: afterRowId } } : {},
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, storageObjectId: true, contentType: true, sizeBytes: true, sha256: true },
    });
    return rows.map((row) => ({ rowId: row.id, objectId: row.storageObjectId, contentType: row.contentType, sizeBytes: row.sizeBytes, sha256: row.sha256 }));
  }

  async inlineUsage(): Promise<{ files: number; bytes: number }> {
    const row = await this.prisma.productMedia.aggregate({ where: { content: { not: null } }, _count: { _all: true }, _sum: { sizeBytes: true } });
    return { files: row._count._all, bytes: row._sum.sizeBytes ?? 0 };
  }

  async readInline(rowId: string): Promise<Uint8Array | null> {
    const row = await this.prisma.productMedia.findUnique({ where: { id: rowId }, select: { content: true } });
    return row?.content ? new Uint8Array(row.content) : null;
  }

  async repoint(rowId: string, from: string | null, to: string): Promise<boolean> {
    const where = from ? { id: rowId, storageObjectId: from } : { id: rowId, storageObjectId: null, content: { not: null } };
    const { count } = await this.prisma.productMedia.updateMany({ where, data: { content: null, storageObjectId: to } });
    return count === 1;
  }
}
