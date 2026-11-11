import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { ConcurrencyConflict } from '../../../shared-kernel';
import type { CartRepository, CartTokens } from '../application/cart.service';
import { Cart, CartOwner } from '../domain/cart';

const include = { items: { orderBy: { position: 'asc' as const } } } satisfies Prisma.CartInclude;
type Row = Prisma.CartGetPayload<{ include: typeof include }>;

function toCart(row: Row): Cart {
  const owner: CartOwner = row.customerId ? { kind: 'customer', customerId: row.customerId } : { kind: 'guest', tokenHash: row.guestToken! };
  return Cart.rehydrate({
    id: row.id,
    owner,
    version: row.version,
    lines: row.items.map((item) => ({ listingId: item.listingId, quantity: item.quantity })),
  });
}

export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCustomer(customerId: string): Promise<Cart | null> {
    const row = await this.prisma.cart.findFirst({ where: { customerId }, include });
    return row ? toCart(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Cart | null> {
    const row = await this.prisma.cart.findUnique({ where: { guestToken: tokenHash }, include });
    return row ? toCart(row) : null;
  }

  async save(cart: Cart): Promise<void> {
    const state = cart.snapshot;
    const owner = state.owner.kind === 'customer' ? { customerId: state.owner.customerId, guestToken: null } : { customerId: null, guestToken: state.owner.tokenHash };
    try {
      await this.prisma.$transaction(async (tx) => {
        if (state.version === 0) {
          await tx.cart.create({ data: { id: state.id, ...owner, version: 1 } });
        } else {
          const { count } = await tx.cart.updateMany({ where: { id: state.id, version: state.version }, data: { version: { increment: 1 } } });
          if (count !== 1) throw new ConcurrencyConflict('Cart', state.id);
          await tx.cartItem.deleteMany({ where: { cartId: state.id } });
        }
        if (state.lines.length > 0) {
          await tx.cartItem.createMany({
            data: state.lines.map((line, position) => ({ cartId: state.id, listingId: line.listingId, quantity: line.quantity, position })),
          });
        }
      });
    } catch (error) {
      // Two first requests racing to open the same customer's cart: the loser retries and finds it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConcurrencyConflict('Cart', state.id);
      throw error;
    }
    cart.markSaved();
  }

  async delete(cart: Cart): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({ where: { cartId: cart.snapshot.id } }),
      this.prisma.cart.deleteMany({ where: { id: cart.snapshot.id } }),
    ]);
  }
}

/** Guest tokens are 256 random bits. Only their SHA-256 hash is stored, so a database leak exposes no usable token. */
export class CryptoCartTokens implements CartTokens {
  issue(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
