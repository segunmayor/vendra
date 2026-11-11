import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { requireIdempotencyKey } from '../../../platform/http/request';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { ADJUSTMENT_REASONS, AdjustmentReason, InventoryService, StockView, WarehouseView } from '../application/inventory';

const addressSchema = z.object({
  line1: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
});
const warehouseSchema = z.object({ name: z.string().max(200), address: addressSchema });
const adjustmentSchema = z.object({
  listingId: z.uuid(),
  warehouseId: z.uuid(),
  delta: z.number().int(),
  reason: z.enum(ADJUSTMENT_REASONS as [AdjustmentReason, ...AdjustmentReason[]]),
});

export class AddressDto {
  @ApiProperty() line1!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
}

export class WarehouseResponse {
  @ApiProperty() id!: string;
  @ApiProperty() sellerId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: AddressDto }) address!: AddressDto;
}

export class CreateWarehouseDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: AddressDto }) address!: AddressDto;
}

export class StockResponse {
  @ApiProperty() listingId!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() onHand!: number;
  @ApiProperty() reserved!: number;
  @ApiProperty() available!: number;
}

export class StockAdjustmentDto {
  @ApiProperty() listingId!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ description: 'Positive to add stock, negative to remove it' }) delta!: number;
  @ApiProperty({ enum: ADJUSTMENT_REASONS }) reason!: AdjustmentReason;
}

@ApiTags('admin inventory')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('inventory.manage')
@Controller({ path: 'admin', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('warehouses')
  @ApiOperation({ operationId: 'adminListWarehouses' })
  @ApiOkResponse({ type: [WarehouseResponse] })
  warehouses(): Promise<WarehouseView[]> {
    return this.inventory.listWarehouses();
  }

  @Post('warehouses')
  @ApiOperation({ operationId: 'adminCreateWarehouse' })
  @ApiCreatedResponse({ type: WarehouseResponse })
  createWarehouse(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(warehouseSchema)) body: CreateWarehouseDto): Promise<WarehouseView> {
    return this.inventory.createWarehouse(actor, body);
  }

  @Get('stock')
  @ApiOperation({ operationId: 'adminListStock' })
  @ApiOkResponse({ type: [StockResponse] })
  stock(@Query('productId', new ZodPipe(z.uuid())) productId: string): Promise<StockView[]> {
    return this.inventory.stockForProduct(productId);
  }

  @Post('stock/adjustments')
  @ApiOperation({ operationId: 'adminAdjustStock' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'A unique key per adjustment, reused on retry' })
  @ApiCreatedResponse({ type: StockResponse })
  adjust(
    @CurrentPrincipal() actor: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(adjustmentSchema)) body: StockAdjustmentDto,
  ): Promise<StockView> {
    return this.inventory.adjust(actor, { ...body, idempotencyKey: requireIdempotencyKey(key) });
  }
}
