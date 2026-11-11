import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { ListingService, ListingState } from '../application/listings';

const priceSchema = z.object({
  priceMinor: z.string().regex(/^\d{1,15}$/, 'priceMinor must be a whole number of kobo, as a string'),
  currency: z.string().length(3),
});
const createSchema = priceSchema.extend({ variantId: z.uuid() });
const id = new ZodPipe(z.uuid());

export class MoneyResponse {
  @ApiProperty({ example: '1500000', description: 'Integer minor units (kobo), as a string' }) amountMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}

export class ListingResponse {
  @ApiProperty() id!: string;
  @ApiProperty() variantId!: string;
  @ApiProperty() sellerId!: string;
  @ApiProperty({ type: MoneyResponse }) price!: MoneyResponse;
  @ApiProperty({ enum: ['draft', 'active', 'inactive'] }) status!: string;
  @ApiProperty() version!: number;
}

export class PriceDto {
  @ApiProperty({ example: '1500000' }) priceMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}

export class CreateListingDto extends PriceDto {
  @ApiProperty() variantId!: string;
}

const toResponse = (state: ListingState): ListingResponse => ({
  id: state.id,
  variantId: state.variantId,
  sellerId: state.sellerId,
  price: { amountMinor: state.price.minor.toString(), currency: state.price.currency },
  status: state.status,
  version: state.version,
});

@ApiTags('admin listings')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('catalogue.manage')
@Controller({ path: 'admin/listings', version: '1' })
export class ListingsController {
  constructor(private readonly listings: ListingService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListListings' })
  @ApiOkResponse({ type: [ListingResponse] })
  async list(@Query('productId', id) productId: string): Promise<ListingResponse[]> {
    return (await this.listings.listForProduct(productId)).map(toResponse);
  }

  @Post()
  @ApiOperation({ operationId: 'adminCreateListing' })
  @ApiCreatedResponse({ type: ListingResponse })
  async create(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(createSchema)) body: CreateListingDto): Promise<ListingResponse> {
    return toResponse(await this.listings.create(actor, body));
  }

  @Put(':id/price')
  @ApiOperation({ operationId: 'adminSetListingPrice' })
  @ApiOkResponse({ type: ListingResponse })
  async price(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) listingId: string,
    @Body(new ZodPipe(priceSchema)) body: PriceDto,
  ): Promise<ListingResponse> {
    return toResponse(await this.listings.changePrice(actor, listingId, body));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminActivateListing' })
  @ApiOkResponse({ type: ListingResponse })
  async activate(@CurrentPrincipal() actor: Principal, @Param('id', id) listingId: string): Promise<ListingResponse> {
    return toResponse(await this.listings.activate(actor, listingId));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminDeactivateListing' })
  @ApiOkResponse({ type: ListingResponse })
  async deactivate(@CurrentPrincipal() actor: Principal, @Param('id', id) listingId: string): Promise<ListingResponse> {
    return toResponse(await this.listings.deactivate(actor, listingId));
  }
}
