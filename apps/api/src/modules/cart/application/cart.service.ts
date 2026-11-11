import { ApplicationError, ConcurrencyConflict, Principal } from '../../../shared-kernel';
import { Cart, CartOwner } from '../domain/cart';
import { CartPricing, PricedCart } from './pricing';

export interface CartRepository {
  findByCustomer(customerId: string): Promise<Cart | null>;
  findByTokenHash(tokenHash: string): Promise<Cart | null>;
  /** Throws ConcurrencyConflict if the cart changed since it was read. */
  save(cart: Cart): Promise<void>;
  delete(cart: Cart): Promise<void>;
}

export interface CartTokens {
  /** A new random guest token, and the hash that is stored instead of it. */
  issue(): { token: string; hash: string };
  hash(token: string): string;
}

/** Who is asking: a signed-in customer, or a guest with (or without yet) a cart token. */
export interface CartCaller {
  readonly principal?: Principal;
  readonly guestToken?: string;
}

export interface CartResult extends PricedCart {
  /** Set only when this request created a guest cart. The client must send it back as X-Cart-Token. */
  readonly guestToken?: string;
}

const ATTEMPTS = 3;
const notOnSale = () => new ApplicationError('conflict', 'cart.item_unavailable', 'This item is not on sale');

export class CartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly pricing: CartPricing,
    private readonly tokens: CartTokens,
    private readonly ids: { uuid(): string },
  ) {}

  async view(caller: CartCaller): Promise<PricedCart> {
    const cart = await this.find(caller);
    return this.pricing.price(cart?.snapshot.lines ?? []);
  }

  /** The cart's raw lines, for checkout. */
  async linesOf(customerId: string) {
    return (await this.carts.findByCustomer(customerId))?.snapshot.lines ?? [];
  }

  async add(caller: CartCaller, listingId: string, quantity: number): Promise<CartResult> {
    return this.mutate(caller, async (cart) => {
      const wanted = cart.quantityOf(listingId) + quantity;
      await this.assertCanHold(listingId, wanted);
      cart.add(listingId, quantity);
    });
  }

  async set(caller: CartCaller, listingId: string, quantity: number): Promise<CartResult> {
    return this.mutate(caller, async (cart) => {
      // Lowering a quantity or removing a line is always allowed, even if the item went off sale.
      if (quantity > cart.quantityOf(listingId)) await this.assertCanHold(listingId, quantity);
      cart.set(listingId, quantity);
    });
  }

  /** Moves a guest cart into the customer's cart when they sign in. Safe to repeat. */
  async merge(principal: Principal, guestToken: string): Promise<PricedCart & { capped: boolean }> {
    for (let attempt = 1; ; attempt += 1) {
      const guest = await this.carts.findByTokenHash(this.tokens.hash(guestToken));
      const mine = (await this.carts.findByCustomer(principal.accountId)) ?? Cart.open(this.ids.uuid(), { kind: 'customer', customerId: principal.accountId });
      if (!guest) return { ...(await this.pricing.price(mine.snapshot.lines)), capped: false };
      const { capped } = mine.absorb(guest);
      try {
        await this.carts.save(mine);
        await this.carts.delete(guest);
        return { ...(await this.pricing.price(mine.snapshot.lines)), capped };
      } catch (error) {
        if (!(error instanceof ConcurrencyConflict) || attempt >= ATTEMPTS) throw error;
      }
    }
  }

  private async assertCanHold(listingId: string, quantity: number): Promise<void> {
    const [line] = (await this.pricing.price([{ listingId, quantity }])).lines;
    if (!line || line.issue === 'unavailable') throw notOnSale();
    if (line.issue === 'out_of_stock') throw new ApplicationError('conflict', 'cart.out_of_stock', 'This item is out of stock');
    if (line.issue === 'insufficient_stock') {
      throw new ApplicationError('conflict', 'cart.insufficient_stock', `Only ${line.availableQuantity} available`);
    }
  }

  private find(caller: CartCaller): Promise<Cart | null> {
    if (caller.principal) return this.carts.findByCustomer(caller.principal.accountId);
    if (caller.guestToken) return this.carts.findByTokenHash(this.tokens.hash(caller.guestToken));
    return Promise.resolve(null);
  }

  /** Loads or opens the caller's cart, applies a change and saves, retrying if another request won the race. */
  private async mutate(caller: CartCaller, change: (cart: Cart) => Promise<void>): Promise<CartResult> {
    for (let attempt = 1; ; attempt += 1) {
      let issued: { token: string; hash: string } | undefined;
      let cart = await this.find(caller);
      if (!cart) {
        let owner: CartOwner;
        if (caller.principal) {
          owner = { kind: 'customer', customerId: caller.principal.accountId };
        } else {
          // An unknown or expired guest token gets a fresh cart and token rather than an error.
          issued = this.tokens.issue();
          owner = { kind: 'guest', tokenHash: issued.hash };
        }
        cart = Cart.open(this.ids.uuid(), owner);
      }
      await change(cart);
      try {
        await this.carts.save(cart);
      } catch (error) {
        if (!(error instanceof ConcurrencyConflict) || attempt >= ATTEMPTS) throw error;
        continue;
      }
      const priced = await this.pricing.price(cart.snapshot.lines);
      return issued ? { ...priced, guestToken: issued.token } : priced;
    }
  }
}
