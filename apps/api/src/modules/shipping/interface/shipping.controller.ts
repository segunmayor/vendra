import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { OpenShipmentView, ShipmentView, ShippingService } from '../application/shipping.service';

const STATUSES = ['created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returning', 'returned', 'cancelled'] as const;
const uuid = new ZodPipe(z.uuid());

const sendSchema = z.object({
  courier: z.string().trim().min(2).max(80),
  trackingReference: z.string().trim().max(60).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'Use letters, numbers, spaces and . _ / -').optional().or(z.literal('').transform(() => undefined)),
  note: z.string().trim().max(300).optional(),
});
const statusSchema = z
  .object({
    status: z.enum(STATUSES),
    note: z.string().trim().max(300).optional(),
    version: z.number().int().min(0).optional(),
  })
  .refine((body) => body.status !== 'delivery_failed' || (body.note?.length ?? 0) >= 3, { message: 'Say why the delivery failed', path: ['note'] });
const listSchema = z.object({ status: z.enum(STATUSES).optional() });

class SendShipmentDto {
  @ApiProperty({ example: 'GIG Logistics', description: 'Who is delivering: a rider, company or courier' }) courier!: string;
  @ApiPropertyOptional({ description: "The courier's tracking number. Leave out and Vendra issues a reference." }) trackingReference?: string;
  @ApiPropertyOptional() note?: string;
}

class ShipmentStatusDto {
  @ApiProperty({ enum: STATUSES }) status!: (typeof STATUSES)[number];
  @ApiPropertyOptional({ description: 'Required when a delivery fails: why' }) note?: string;
  @ApiPropertyOptional({ description: 'The version you were looking at. A newer one means someone else changed it.' }) version?: number;
}

class ShipmentItemDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty() quantity!: number;
}

class StatusChangeDto {
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty() at!: Date;
}

class StaffStatusChangeDto extends StatusChangeDto {
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
}

class DeliveryAttemptDto {
  @ApiProperty() attemptNumber!: number;
  @ApiProperty() at!: Date;
  @ApiProperty() successful!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) reason!: string | null;
}

/** What a customer sees: where the parcel is and who has it. No staff notes. */
export class TrackingResponse {
  @ApiProperty() id!: string;
  @ApiProperty() sellerOrderId!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) courier!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) trackingReference!: string | null;
  @ApiProperty({ type: [ShipmentItemDto] }) items!: ShipmentItemDto[];
  @ApiProperty({ type: [StatusChangeDto] }) history!: StatusChangeDto[];
}

export class ShipmentResponse extends TrackingResponse {
  @ApiProperty() provider!: string;
  @ApiProperty({ type: [StaffStatusChangeDto] }) declare history: StaffStatusChangeDto[];
  @ApiProperty({ type: [DeliveryAttemptDto] }) attempts!: DeliveryAttemptDto[];
  @ApiProperty({ enum: STATUSES, isArray: true, description: 'Where it can go next' }) nextStatuses!: string[];
  @ApiProperty() version!: number;
}

class ShipmentOrderDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() recipient!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty({ description: 'Units in the shipment' }) itemCount!: number;
}

export class OpenShipmentResponse extends ShipmentResponse {
  @ApiProperty({ type: ShipmentOrderDto }) order!: ShipmentOrderDto;
}

const staff = (shipment: ShipmentView): ShipmentResponse => ({
  id: shipment.id,
  sellerOrderId: shipment.sellerOrderId,
  status: shipment.status,
  provider: shipment.provider,
  courier: shipment.courier,
  trackingReference: shipment.trackingReference,
  items: shipment.items.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })),
  history: shipment.history.map(({ status, at, note }) => ({ status, at, note })),
  attempts: shipment.attempts.map((attempt) => ({ ...attempt })),
  nextStatuses: [...shipment.nextStatuses],
  version: shipment.version,
});

const open = (shipment: OpenShipmentView): OpenShipmentResponse => ({
  ...staff(shipment),
  order: {
    orderId: shipment.order.orderId,
    orderNumber: shipment.order.orderNumber,
    recipient: shipment.order.address.recipient,
    phone: shipment.order.address.phone,
    city: shipment.order.address.city,
    state: shipment.order.address.state,
    itemCount: shipment.items.reduce((sum, item) => sum + item.quantity, 0),
  },
});

const tracking = (shipment: ShipmentView): TrackingResponse => ({
  id: shipment.id,
  sellerOrderId: shipment.sellerOrderId,
  status: shipment.status,
  courier: shipment.courier,
  trackingReference: shipment.trackingReference,
  items: shipment.items.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })),
  history: shipment.history.map(({ status, at }) => ({ status, at })),
});

@ApiTags('admin shipments')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('shipments.manage')
@Controller({ version: '1' })
export class AdminShipmentsController {
  constructor(private readonly shipping: ShippingService) {}

  @Post('admin/seller-orders/:id/shipments')
  @ApiOperation({ operationId: 'adminSendSellerOrder', summary: "Hand a seller order's items to a courier" })
  @ApiCreatedResponse({ type: ShipmentResponse })
  async send(@CurrentPrincipal() actor: Principal, @Param('id', uuid) sellerOrderId: string, @Body(new ZodPipe(sendSchema)) body: SendShipmentDto): Promise<ShipmentResponse> {
    return staff(await this.shipping.send(actor, sellerOrderId, body));
  }

  @Post('admin/shipments/:id/status')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminUpdateShipmentStatus', summary: 'Record the next step of a delivery' })
  @ApiOkResponse({ type: ShipmentResponse })
  async status(@CurrentPrincipal() actor: Principal, @Param('id', uuid) id: string, @Body(new ZodPipe(statusSchema)) body: ShipmentStatusDto): Promise<ShipmentResponse> {
    return staff(await this.shipping.update(actor, id, body));
  }

  @Get('admin/shipments')
  @ApiOperation({ operationId: 'adminListShipments', summary: 'Shipments on their way, longest waiting first' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiOkResponse({ type: [OpenShipmentResponse] })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>): Promise<OpenShipmentResponse[]> {
    return (await this.shipping.open(query.status)).map(open);
  }
}

@ApiTags('admin orders')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('orders.manage')
@Controller({ path: 'admin/orders', version: '1' })
export class AdminOrderShipmentsController {
  constructor(private readonly shipping: ShippingService) {}

  @Get(':id/shipments')
  @ApiOperation({ operationId: 'adminOrderShipments' })
  @ApiOkResponse({ type: [ShipmentResponse] })
  async list(@Param('id', uuid) orderId: string): Promise<ShipmentResponse[]> {
    return (await this.shipping.forOrder(orderId)).map(staff);
  }
}

@ApiTags('store orders')
@ApiBearerAuth()
@Surface('store')
@Controller({ path: 'store/orders', version: '1' })
export class StoreTrackingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get(':id/shipments')
  @ApiOperation({ operationId: 'storeOrderShipments', summary: 'Where your order is' })
  @ApiOkResponse({ type: [TrackingResponse] })
  async list(@CurrentPrincipal() principal: Principal, @Param('id', uuid) orderId: string): Promise<TrackingResponse[]> {
    return (await this.shipping.forMyOrder(principal, orderId)).map(tracking);
  }
}
