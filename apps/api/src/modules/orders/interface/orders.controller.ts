import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Money, Principal } from '../../../shared-kernel';
import { CANCEL_REASON_MAX, Order, OrderService } from '../application/orders.service';

const uuid = new ZodPipe(z.uuid());
const STATUSES = ['placed', 'stock_issue', 'cancelled', 'fulfilled'] as const;
const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  number: z.string().trim().regex(/^\d{1,12}$/).optional(),
  toSend: z.enum(['true']).transform(() => true).optional(),
});
const cancelSchema = z.object({
  reason: z.string().trim().min(3).max(CANCEL_REASON_MAX),
  version: z.number().int().nonnegative().optional(),
});

class CancelOrderRequest {
  @ApiProperty({ minLength: 3, maxLength: CANCEL_REASON_MAX, description: 'Why, for the audit log and other staff' }) reason!: string;
  @ApiPropertyOptional({ description: 'The order version the staff member was looking at' }) version?: number;
}

class CancellationDto {
  @ApiProperty() reason!: string;
  @ApiProperty() by!: string;
  @ApiProperty() at!: Date;
}

class MoneyDto {
  @ApiProperty({ example: '1500000' }) amountMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}

class OrderAddressDto {
  @ApiProperty() recipient!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() line1!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) line2!: string | null;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
}

class OrderLineDto {
  @ApiProperty() listingId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: MoneyDto }) unitPrice!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) lineTotal!: MoneyDto;
}

class SellerOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() sellerId!: string;
  @ApiProperty({ enum: ['pending', 'cancelled', 'dispatched', 'delivered'] }) status!: string;
  @ApiProperty({ type: [OrderLineDto] }) lines!: OrderLineDto[];
}

export class OrderSummaryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty() placedAt!: Date;
  @ApiProperty({ type: MoneyDto }) total!: MoneyDto;
  @ApiProperty({ description: 'Units, counting each quantity' }) itemCount!: number;
  @ApiProperty({ description: 'Different items' }) lineCount!: number;
  @ApiProperty({ description: 'The first item, for a short description' }) firstItem!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty({ description: 'Paid, with items not yet handed to a courier' }) toSend!: boolean;
}

export class OrderResponse extends OrderSummaryResponse {
  @ApiPropertyOptional({ type: Date, nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ type: MoneyDto }) subtotal!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) delivery!: MoneyDto;
  @ApiProperty({ type: OrderAddressDto }) address!: OrderAddressDto;
  @ApiProperty({ type: [SellerOrderDto] }) sellerOrders!: SellerOrderDto[];
}

export class AdminOrderResponse extends OrderResponse {
  @ApiProperty() paymentId!: string;
  @ApiProperty() checkoutId!: string;
  @ApiProperty() customerId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) customerEmail!: string | null;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: CancellationDto, nullable: true }) cancellation!: CancellationDto | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Why staff cannot cancel it now; null when they can' }) cannotCancelBecause!: string | null;
}

export class OrderCountsResponse {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, description: 'Orders in each status' }) byStatus!: Record<string, number>;
  @ApiProperty({ description: 'Paid orders with items not yet handed to a courier' }) toSend!: number;
}

const money = (value: Money): MoneyDto => ({ amountMinor: value.minor.toString(), currency: value.currency });

function summary(order: Order): OrderSummaryResponse {
  const state = order.snapshot;
  const first = state.sellerOrders[0]?.lines[0];
  return {
    id: state.id,
    number: state.number,
    status: state.status,
    placedAt: state.placedAt,
    total: money(state.total),
    itemCount: order.itemCount,
    lineCount: state.sellerOrders.reduce((sum, seller) => sum + seller.lines.length, 0),
    firstItem: first?.productName ?? '',
    city: state.address.city,
    state: state.address.state,
    toSend: state.status === 'placed' && state.sellerOrders.some((seller) => seller.status === 'pending'),
  };
}

function detail(order: Order): OrderResponse {
  const state = order.snapshot;
  return {
    ...summary(order),
    cancelledAt: state.cancellation?.at ?? null,
    subtotal: money(state.subtotal),
    delivery: money(state.delivery),
    address: { ...state.address },
    sellerOrders: state.sellerOrders.map((seller) => ({
      id: seller.id,
      sellerId: seller.sellerId,
      status: seller.status,
      lines: seller.lines.map((line) => ({
        listingId: line.listingId,
        sku: line.sku,
        productName: line.productName,
        options: { ...line.options },
        quantity: line.quantity,
        unitPrice: money(line.unitPrice),
        lineTotal: money(line.lineTotal),
      })),
    })),
  };
}

function adminDetail(order: Order, customerEmail: string | null): AdminOrderResponse {
  const state = order.snapshot;
  return {
    ...detail(order),
    paymentId: state.paymentId,
    checkoutId: state.checkoutId,
    customerId: state.customerId,
    customerEmail,
    version: state.version,
    cancellation: state.cancellation ? { ...state.cancellation } : null,
    cannotCancelBecause: order.cannotCancelBecause,
  };
}

@ApiTags('store orders')
@ApiBearerAuth()
@Surface('store')
@Controller({ path: 'store/orders', version: '1' })
export class StoreOrdersController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  @ApiOperation({ operationId: 'storeListOrders', summary: 'Your orders, newest first' })
  @ApiOkResponse({ type: [OrderSummaryResponse] })
  async list(@CurrentPrincipal() principal: Principal): Promise<OrderSummaryResponse[]> {
    return (await this.orders.listMine(principal)).map(summary);
  }

  @Get('by-checkout/:checkoutId')
  @ApiOperation({ operationId: 'storeOrderForCheckout', summary: 'The order a paid checkout became' })
  @ApiOkResponse({ type: OrderResponse })
  async byCheckout(@CurrentPrincipal() principal: Principal, @Param('checkoutId', uuid) checkoutId: string): Promise<OrderResponse> {
    return detail(await this.orders.getMineByCheckout(principal, checkoutId));
  }

  @Get(':id')
  @ApiOperation({ operationId: 'storeGetOrder' })
  @ApiOkResponse({ type: OrderResponse })
  async get(@CurrentPrincipal() principal: Principal, @Param('id', uuid) id: string): Promise<OrderResponse> {
    return detail(await this.orders.getMine(principal, id));
  }
}

@ApiTags('admin orders')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('orders.manage')
@Controller({ path: 'admin/orders', version: '1' })
export class AdminOrdersController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListOrders', summary: 'Latest 100 orders, optionally by status or order number' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'number', required: false, type: String })
  @ApiQuery({ name: 'toSend', required: false, enum: ['true'], description: 'Only orders with items waiting to be sent' })
  @ApiOkResponse({ type: [OrderSummaryResponse] })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>): Promise<OrderSummaryResponse[]> {
    return (await this.orders.list(query)).map(summary);
  }

  @Get('counts')
  @ApiOperation({ operationId: 'adminOrderCounts' })
  @ApiOkResponse({ type: OrderCountsResponse })
  async counts(): Promise<OrderCountsResponse> {
    return this.orders.counts();
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetOrder' })
  @ApiOkResponse({ type: AdminOrderResponse })
  async get(@Param('id', uuid) id: string): Promise<AdminOrderResponse> {
    const { order, customerEmail } = await this.orders.get(id);
    return adminDetail(order, customerEmail);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminCancelOrder', summary: 'Cancel an order before anything leaves with a courier. Stock goes back on sale; refund separately.' })
  @ApiOkResponse({ type: AdminOrderResponse })
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(cancelSchema)) body: CancelOrderRequest,
  ): Promise<AdminOrderResponse> {
    await this.orders.cancel(principal, id, body.reason, body.version);
    const { order, customerEmail } = await this.orders.get(id);
    return adminDetail(order, customerEmail);
  }
}
