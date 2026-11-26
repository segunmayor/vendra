import { PrismaClient } from '@prisma/client';

/**
 * Every suite signs up many customers from 127.0.0.1, and the per-address sign-up limit counts
 * the last hour across runs. Each suite starts with a clean count so test runs in quick
 * succession cannot trip it. The limit itself is tested in identity.int-spec.ts.
 */
beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:register:' } } });
    // Files stay in the database unless a suite chooses a storage location (storage.int-spec.ts).
    await prisma.storageLocation.updateMany({ where: { active: true }, data: { active: false } });
  } finally {
    await prisma.$disconnect();
  }
});
