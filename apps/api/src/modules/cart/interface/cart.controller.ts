import { Body, Controller, createParamDecorator, Delete, ExecutionContext, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { GuestAllowed, OptionalPrincipal, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { ApplicationError, Money, Principal } from '../../../shared-kernel';
import { CartCaller, CartResult, CartService } from '../application/cart.service';
import type { PricedCart, PricedLine } from '../application/pricing';

/** Reads the optional guest token. A plain @Headers() would make the contract mark it as required. */
const CartToken = createParamDecorator((_data: unknown, context: ExecutionContext): string | undefined => {
  const value = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>().headers['x-cart-token'];
  return typeof value === 'string' ? value : undefined;
});
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const addSchema = z.object({ listingId: z.uuid(), quantity: z.number().int().min(1).max(100) });
const setSchema = z.object({ quantity: z.number().int().min(0).max(100) });
const listingId = new ZodPipe(z.uuid());

export class MoneyDto {
  @ApiProperty({ example: '1500000' }) amountMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}

export class CartLineResponse {
  @ApiProperty() listingId!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) productSlug!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
  @ApiPropertyOptional({ type: String, nullable: true }) image!: string | null;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) unitPrice!: MoneyDto | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) lineTotal!: MoneyDto | null;
  @ApiPropertyOptional({ enum: ['unavailable', 'out_of_stock', 'insufficient_stock'], nullable: true }) issue!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) availableQuantity!: number | null;
}

export class CartResponse {
  @ApiProperty({ type: [CartLineResponse] }) lines!: CartLineResponse[];
  @ApiProperty() itemCount!: number;
  @ApiProperty({ type: MoneyDto, description: 'Total of the lines that can be bought now' }) subtotal!: MoneyDto;
  @ApiProperty({ description: 'False if the cart is empty or any line has an issue' }) canCheckout!: boolean;
  @ApiPropertyOptional({ description: 'Returned once, when a guest cart is created. Send it back as X-Cart-Token.' }) guestToken?: string;
  @ApiPropertyOptional({ description: 'On merge: true if some quantities were reduced to the per-order limit' }) capped?: boolean;
}

export class AddItemDto {
  @ApiProperty() listingId!: string;
  @ApiProperty({ minimum: 1 }) quantity!: number;
}

export class SetQuantityDto {
  @ApiProperty({ minimum: 0, description: '0 removes the line' }) quantity!: number;
}

const money = (value: Money | null): MoneyDto | null => (value ? { amountMinor: value.minor.toString(), currency: value.currency } : null);
const line = (value: PricedLine): CartLineResponse => ({
  listingId: value.listingId,
  productName: value.productName,
  productSlug: value.productSlug,
  sku: value.sku,
  options: { ...value.options },
  image: value.image,
  quantity: value.quantity,
  unitPrice: money(value.unitPrice),
  lineTotal: money(value.lineTotal),
  issue: value.issue,
  availableQuantity: value.availableQuantity,
});
const respond = (cart: PricedCart & { guestToken?: string; capped?: boolean }): CartResponse => ({
  lines: cart.lines.map(line),
  itemCount: cart.itemCount,
  subtotal: money(cart.subtotal)!,
  canCheckout: cart.canCheckout,
  ...(cart.guestToken ? { guestToken: cart.guestToken } : {}),
  ...(cart.capped !== undefined ? { capped: cart.capped } : {}),
});

function caller(principal: Principal | undefined, header: string | undefined): CartCaller {
  if (principal) return { principal };
  // A malformed token is treated as no token, so a guest simply starts a fresh cart.
  return token.safeParse(header).success ? { guestToken: header } : {};
}

/** The basket. Works for guests (X-Cart-Token) and signed-in customers (Bearer token). */
@ApiTags('store cart')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Cart-Token', required: false, description: 'Guest cart token, when not signed in' })
@Surface('store')
@GuestAllowed()
@Controller({ path: 'store/cart', version: '1' })
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Get()
  @ApiOperation({ operationId: 'storeGetCart' })
  @ApiOkResponse({ type: CartResponse })
  async get(@OptionalPrincipal() principal: Principal | undefined, @CartToken() header?: string): Promise<CartResponse> {
    return respond(await this.carts.view(caller(principal, header)));
  }

  @Post('items')
  @HttpCode(200)
  @ApiOperation({ operationId: 'storeAddCartItem' })
  @ApiOkResponse({ type: CartResponse })
  async add(
    @OptionalPrincipal() principal: Principal | undefined,
    @CartToken() header: string | undefined,
    @Body(new ZodPipe(addSchema)) body: AddItemDto,
  ): Promise<CartResponse> {
    const result: CartResult = await this.carts.add(caller(principal, header), body.listingId, body.quantity);
    return respond(result);
  }

  @Put('items/:listingId')
  @ApiOperation({ operationId: 'storeSetCartItem' })
  @ApiOkResponse({ type: CartResponse })
  async set(
    @OptionalPrincipal() principal: Principal | undefined,
    @CartToken() header: string | undefined,
    @Param('listingId', listingId) id: string,
    @Body(new ZodPipe(setSchema)) body: SetQuantityDto,
  ): Promise<CartResponse> {
    return respond(await this.carts.set(caller(principal, header), id, body.quantity));
  }

  @Delete('items/:listingId')
  @ApiOperation({ operationId: 'storeRemoveCartItem' })
  @ApiOkResponse({ type: CartResponse })
  async remove(
    @OptionalPrincipal() principal: Principal | undefined,
    @CartToken() header: string | undefined,
    @Param('listingId', listingId) id: string,
  ): Promise<CartResponse> {
    return respond(await this.carts.set(caller(principal, header), id, 0));
  }

  /** Called by the portal right after sign-in, with the guest token it was holding. */
  @Post('merge')
  @HttpCode(200)
  @ApiOperation({ operationId: 'storeMergeCart' })
  @ApiOkResponse({ type: CartResponse })
  async merge(@OptionalPrincipal() principal: Principal | undefined, @CartToken() header?: string): Promise<CartResponse> {
    if (!principal) throw new ApplicationError('unauthenticated', 'auth.token_required', 'Sign in to keep your basket');
    if (!token.safeParse(header).success) return respond(await this.carts.view({ principal }));
    return respond(await this.carts.merge(principal, header!));
  }
}
