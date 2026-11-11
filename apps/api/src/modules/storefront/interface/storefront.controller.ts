import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { ApplicationError, Money } from '../../../shared-kernel';
import { Availability, Offer, ProductCard, ProductPage, StorefrontService } from '../application/storefront.service';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const browseSchema = z.object({
  q: z.string().max(200).optional(),
  category: slug.optional(),
  brand: slug.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

const AVAILABILITY = ['in_stock', 'low_stock', 'out_of_stock'];

class MoneyDto {
  @ApiProperty({ example: '1500000', description: 'Integer minor units (kobo), as a string' }) amountMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
}

class RefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class StoreCategoryResponse extends RefDto {
  @ApiPropertyOptional({ type: String, nullable: true }) parentId!: string | null;
  @ApiProperty() productCount!: number;
}

export class ProductCardResponse {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: RefDto, nullable: true }) brand!: RefDto | null;
  @ApiProperty({ type: RefDto }) category!: RefDto;
  @ApiPropertyOptional({ type: String, nullable: true }) image!: string | null;
  @ApiProperty({ type: MoneyDto }) priceFrom!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) priceTo!: MoneyDto;
  @ApiProperty({ enum: AVAILABILITY }) availability!: Availability;
}

export class ProductPageResponse {
  @ApiProperty({ type: [ProductCardResponse] }) items!: ProductCardResponse[];
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Pass as ?cursor= for the next page' }) nextCursor!: string | null;
}

class OfferDto {
  @ApiProperty() listingId!: string;
  @ApiProperty({ type: MoneyDto }) price!: MoneyDto;
  @ApiProperty({ enum: AVAILABILITY }) availability!: Availability;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Set only when stock is low' }) lowStockQuantity!: number | null;
}

class StoreVariantDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
  @ApiProperty({ type: OfferDto }) offer!: OfferDto;
}

class AttributeDto {
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
}

export class ProductDetailResponse {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ type: RefDto, nullable: true }) brand!: RefDto | null;
  @ApiProperty({ type: RefDto }) category!: RefDto;
  @ApiProperty({ type: [RefDto] }) breadcrumb!: RefDto[];
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ type: [AttributeDto] }) attributes!: AttributeDto[];
  @ApiProperty({ type: MoneyDto }) priceFrom!: MoneyDto;
  @ApiProperty({ type: MoneyDto }) priceTo!: MoneyDto;
  @ApiProperty({ enum: AVAILABILITY }) availability!: Availability;
  @ApiProperty({ type: [StoreVariantDto] }) variants!: StoreVariantDto[];
}

const money = (value: Money): MoneyDto => ({ amountMinor: value.minor.toString(), currency: value.currency });
const offer = (value: Offer): OfferDto => ({ ...value, price: money(value.price) });
const card = (value: ProductCard): ProductCardResponse => ({ ...value, priceFrom: money(value.priceFrom), priceTo: money(value.priceTo) });
const detail = (value: ProductPage): ProductDetailResponse => ({
  ...value,
  images: [...value.images],
  breadcrumb: [...value.breadcrumb],
  attributes: [...value.attributes],
  priceFrom: money(value.priceFrom),
  priceTo: money(value.priceTo),
  variants: value.variants.map((variant) => ({ id: variant.id, sku: variant.sku, options: { ...variant.options }, offer: offer(variant.offer) })),
});

/** Public catalogue reads for the customer portal. No account needed. */
@ApiTags('store catalogue')
@Public()
@Controller({ path: 'store', version: '1' })
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ operationId: 'storeListCategories' })
  @ApiOkResponse({ type: [StoreCategoryResponse] })
  categories(): Promise<StoreCategoryResponse[]> {
    return this.storefront.categories();
  }

  @Get('products')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ operationId: 'storeListProducts', summary: 'Browse newest first, or search by relevance with ?q=' })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String, description: 'Category slug; includes subcategories' })
  @ApiQuery({ name: 'brand', required: false, type: String, description: 'Brand slug' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: ProductPageResponse })
  async products(@Query(new ZodPipe(browseSchema)) query: z.infer<typeof browseSchema>): Promise<ProductPageResponse> {
    const page = await this.storefront.browse({
      text: query.q,
      categorySlug: query.category,
      brandSlug: query.brand,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { items: page.items.map(card), nextCursor: page.nextCursor };
  }

  @Get('products/:slug')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ operationId: 'storeGetProduct' })
  @ApiOkResponse({ type: ProductDetailResponse })
  async product(@Param('slug', new ZodPipe(slug)) productSlug: string): Promise<ProductDetailResponse> {
    const page = await this.storefront.product(productSlug);
    if (!page) throw new ApplicationError('not_found', 'storefront.product_not_found', 'This product is not available');
    return detail(page);
  }
}
