import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { NIGERIAN_STATES, Principal } from '../../../shared-kernel';
import { DeliveryZoneState, LogisticsService } from '../application/logistics';

const zoneSchema = z.object({
  code: z.string().max(40),
  name: z.string().max(100),
  states: z.array(z.string().max(40)).max(40),
  rates: z
    .array(z.object({ maxWeightGrams: z.number().int(), priceMinor: z.string().regex(/^\d{1,12}$/, 'priceMinor must be whole kobo, as a string') }))
    .max(20),
});

class RateDto {
  @ApiProperty() maxWeightGrams!: number;
  @ApiProperty({ example: '250000', description: 'Kobo, as a string' }) priceMinor!: string;
}

export class DeliveryZoneDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String], enum: NIGERIAN_STATES }) states!: string[];
  @ApiProperty({ type: [RateDto] }) rates!: RateDto[];
}

export class DeliveryZoneResponse extends DeliveryZoneDto {
  @ApiProperty() id!: string;
}

const toResponse = (zone: DeliveryZoneState): DeliveryZoneResponse => ({
  id: zone.id,
  code: zone.code,
  name: zone.name,
  states: [...zone.states],
  rates: zone.rates.map((rate) => ({ maxWeightGrams: rate.maxWeightGrams, priceMinor: rate.price.minor.toString() })),
});

const id = new ZodPipe(z.uuid());

/** Delivery pricing set by staff. Checkout quotes from these tables. */
@ApiTags('admin delivery')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('settings.manage')
@Controller({ path: 'admin/delivery-zones', version: '1' })
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListDeliveryZones' })
  @ApiOkResponse({ type: [DeliveryZoneResponse] })
  async list(): Promise<DeliveryZoneResponse[]> {
    return (await this.logistics.list()).map(toResponse);
  }

  @Post()
  @ApiOperation({ operationId: 'adminCreateDeliveryZone' })
  @ApiCreatedResponse({ type: DeliveryZoneResponse })
  async create(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(zoneSchema)) body: DeliveryZoneDto): Promise<DeliveryZoneResponse> {
    return toResponse(await this.logistics.create(actor, body));
  }

  @Put(':id')
  @ApiOperation({ operationId: 'adminUpdateDeliveryZone' })
  @ApiOkResponse({ type: DeliveryZoneResponse })
  async update(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) zoneId: string,
    @Body(new ZodPipe(zoneSchema)) body: DeliveryZoneDto,
  ): Promise<DeliveryZoneResponse> {
    return toResponse(await this.logistics.update(actor, zoneId, body));
  }
}
