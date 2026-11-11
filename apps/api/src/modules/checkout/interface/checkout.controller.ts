import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, Surface } from '../../../platform/http/auth.decorators';
import { requireIdempotencyKey } from '../../../platform/http/request';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Money, NIGERIAN_STATES, Principal } from '../../../shared-kernel';
import { CheckoutService, CheckoutSession, DeliveryAddress, DeliveryPreview } from '../application/checkout.service';

const field = (max: number) => z.string().max(max);
const addressSchema = z.object({
  recipient: field(200),
  phone: field(40),
  line1: field(300),
  line2: field(300).nullish(),
  city: field(200),
  state: field(40),
});
const startSchema = z.object({ address: addressSchema });
const quoteSchema = z.object({ state: z.enum(NIGERIAN_STATES) });
const id = new ZodPipe(z.uuid());

class MoneyDto {
  @ApiProperty({ example: '1500000' }) amountMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}

export class AddressDto {
  @ApiProperty() recipient!: string;
  @ApiProperty({ example: '08031234567' }) phone!: string;
  @ApiProperty() line1!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) line2?: string | null;
  @ApiProperty() city!: string;
  @ApiProperty({ enum: NIGERIAN_STATES }) state!: string;
}

export class StartCheckoutDto {
  @ApiProperty({ type: AddressDto }) address!: AddressDto;
}

export class QuoteDto {
  @ApiProperty({ enum: NIGERIAN_STATES }) state!: string;
}

export class DeliveryQuoteResponse {
  @ApiProperty({ type: MoneyDto }) subtotal!: MoneyDto;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) delivery!: MoneyDto | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) total!: MoneyDto | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Why delivery cannot be quoted' }) problem!: string | null;
}

class CheckoutLineDto {
  @ApiProperty() listingId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: MoneyDto }) unitPrice!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) lineTotal!: MoneyDto;
}

export class SavedAddressResponse {
  @ApiProperty() recipient!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() line1!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) line2!: string | null;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
}

export class CheckoutResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['awaiting_payment', 'cancelled', 'expired', 'paid'] }) status!: string;
  @ApiProperty({ type: [CheckoutLineDto] }) lines!: CheckoutLineDto[];
  @ApiProperty({ type: SavedAddressResponse }) address!: SavedAddressResponse;
  @ApiProperty({ type: MoneyDto }) subtotal!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) delivery!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) total!: MoneyDto;
  @ApiProperty({ description: 'Stock is held until this time' }) expiresAt!: Date;
}

export class LastAddressResponse {
  @ApiPropertyOptional({ type: SavedAddressResponse, nullable: true }) address!: SavedAddressResponse | null;
}

const money = (value: Money): MoneyDto => ({ amountMinor: value.minor.toString(), currency: value.currency });
const address = (value: DeliveryAddress): SavedAddressResponse => ({ ...value });

/** Builds the response as of now, so an expired session always reads as expired. */
function respond(session: CheckoutSession, now: Date): CheckoutResponse {
  const state = session.snapshot;
  return {
    id: state.id,
    status: session.statusAt(now),
    lines: state.lines.map((line) => ({
      listingId: line.listingId,
      sku: line.sku,
      productName: line.productName,
      options: { ...line.options },
      quantity: line.quantity,
      unitPrice: money(line.unitPrice),
      lineTotal: money(line.lineTotal),
    })),
    address: address(state.address),
    subtotal: money(state.subtotal),
    delivery: money(state.delivery),
    total: money(state.total),
    expiresAt: state.expiresAt,
  };
}

const preview = (value: DeliveryPreview): DeliveryQuoteResponse => ({
  subtotal: money(value.subtotal),
  delivery: value.delivery ? money(value.delivery) : null,
  total: value.total ? money(value.total) : null,
  problem: value.problem,
});

/** Checkout needs a signed-in customer: their order history and delivery tracking depend on it. */
@ApiTags('store checkout')
@ApiBearerAuth()
@Surface('store')
@Controller({ path: 'store/checkout', version: '1' })
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  @HttpCode(200)
  @ApiOperation({ operationId: 'storeQuoteDelivery', summary: 'Delivery fee for the basket to a state. Reserves nothing.' })
  @ApiOkResponse({ type: DeliveryQuoteResponse })
  async quote(@CurrentPrincipal() principal: Principal, @Body(new ZodPipe(quoteSchema)) body: QuoteDto): Promise<DeliveryQuoteResponse> {
    return preview(await this.checkout.preview(principal, body.state));
  }

  @Post()
  @ApiOperation({ operationId: 'storeStartCheckout', summary: 'Prices the basket and holds its stock for payment' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'One key per checkout attempt, reused on retry' })
  @ApiCreatedResponse({ type: CheckoutResponse })
  async start(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(startSchema)) body: StartCheckoutDto,
  ): Promise<CheckoutResponse> {
    const session = await this.checkout.start(principal, requireIdempotencyKey(key), body.address);
    return respond(session, this.checkout.now());
  }

  @Get('last-address')
  @ApiOperation({ operationId: 'storeLastCheckoutAddress' })
  @ApiOkResponse({ type: LastAddressResponse })
  async lastAddress(@CurrentPrincipal() principal: Principal): Promise<LastAddressResponse> {
    const found = await this.checkout.lastAddress(principal);
    return { address: found ? address(found) : null };
  }

  @Get(':id')
  @ApiOperation({ operationId: 'storeGetCheckout' })
  @ApiOkResponse({ type: CheckoutResponse })
  async get(@CurrentPrincipal() principal: Principal, @Param('id', id) checkoutId: string): Promise<CheckoutResponse> {
    return respond(await this.checkout.get(principal, checkoutId), this.checkout.now());
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'storeCancelCheckout', summary: 'Cancels the checkout and returns its stock to sale' })
  @ApiOkResponse({ type: CheckoutResponse })
  async cancel(@CurrentPrincipal() principal: Principal, @Param('id', id) checkoutId: string): Promise<CheckoutResponse> {
    return respond(await this.checkout.cancel(principal, checkoutId), this.checkout.now());
  }
}
