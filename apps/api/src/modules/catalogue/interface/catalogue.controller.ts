import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { CatalogueService } from '../application/catalogue.service';
import { BrandView, CategoryView, ProductState, ProductSummary, Variant } from '../application/ports';
import { z } from 'zod';
import {
  AddVariantDto,
  addVariantSchema,
  BrandResponse,
  CategoryResponse,
  CreateBrandDto,
  createBrandSchema,
  CreateCategoryDto,
  createCategorySchema,
  CreateProductDto,
  createProductSchema,
  listProductsSchema,
  ProductDetailsDto,
  ProductResponse,
  ProductSummaryResponse,
  UpdateCategoryDto,
  updateCategorySchema,
  updateProductSchema,
  VariantResponse,
} from './dto';

const id = new ZodPipe(z.uuid());

@ApiTags('admin catalogue')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('catalogue.manage')
@Controller({ path: 'admin', version: '1' })
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('categories')
  @ApiOperation({ operationId: 'adminListCategories' })
  @ApiOkResponse({ type: [CategoryResponse] })
  categories(): Promise<CategoryView[]> {
    return this.catalogue.listCategories();
  }

  @Post('categories')
  @ApiOperation({ operationId: 'adminCreateCategory' })
  @ApiCreatedResponse({ type: CategoryResponse })
  createCategory(
    @CurrentPrincipal() actor: Principal,
    @Body(new ZodPipe(createCategorySchema)) body: CreateCategoryDto,
  ): Promise<CategoryView> {
    return this.catalogue.createCategory(actor, body);
  }

  @Patch('categories/:id')
  @ApiOperation({ operationId: 'adminUpdateCategory' })
  @ApiOkResponse({ type: CategoryResponse })
  updateCategory(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) categoryId: string,
    @Body(new ZodPipe(updateCategorySchema)) body: UpdateCategoryDto,
  ): Promise<CategoryView> {
    return this.catalogue.updateCategory(actor, categoryId, body);
  }

  @Get('brands')
  @ApiOperation({ operationId: 'adminListBrands' })
  @ApiOkResponse({ type: [BrandResponse] })
  brands(): Promise<BrandView[]> {
    return this.catalogue.listBrands();
  }

  @Post('brands')
  @ApiOperation({ operationId: 'adminCreateBrand' })
  @ApiCreatedResponse({ type: BrandResponse })
  createBrand(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(createBrandSchema)) body: CreateBrandDto): Promise<BrandView> {
    return this.catalogue.createBrand(actor, body.name);
  }

  @Get('products')
  @ApiOperation({ operationId: 'adminListProducts' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'published', 'archived'] })
  @ApiOkResponse({ type: [ProductSummaryResponse] })
  products(@Query(new ZodPipe(listProductsSchema)) query: z.infer<typeof listProductsSchema>): Promise<ProductSummary[]> {
    return this.catalogue.listProducts(query);
  }

  @Post('products')
  @ApiOperation({ operationId: 'adminCreateProduct' })
  @ApiCreatedResponse({ type: ProductResponse })
  createProduct(
    @CurrentPrincipal() actor: Principal,
    @Body(new ZodPipe(createProductSchema)) body: CreateProductDto,
  ): Promise<ProductState> {
    return this.catalogue.createProduct(actor, body);
  }

  @Get('products/:id')
  @ApiOperation({ operationId: 'adminGetProduct' })
  @ApiOkResponse({ type: ProductResponse })
  product(@Param('id', id) productId: string): Promise<ProductState> {
    return this.catalogue.getProduct(productId);
  }

  @Patch('products/:id')
  @ApiOperation({ operationId: 'adminUpdateProduct' })
  @ApiOkResponse({ type: ProductResponse })
  updateProduct(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) productId: string,
    @Body(new ZodPipe(updateProductSchema)) body: ProductDetailsDto,
  ): Promise<ProductState> {
    return this.catalogue.updateProduct(actor, productId, body);
  }

  @Post('products/:id/variants')
  @ApiOperation({ operationId: 'adminAddVariant' })
  @ApiCreatedResponse({ type: VariantResponse })
  addVariant(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) productId: string,
    @Body(new ZodPipe(addVariantSchema)) body: AddVariantDto,
  ): Promise<Variant> {
    return this.catalogue.addVariant(actor, productId, body);
  }

  @Post('products/:id/publish')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminPublishProduct' })
  @ApiOkResponse({ type: ProductResponse })
  publish(@CurrentPrincipal() actor: Principal, @Param('id', id) productId: string): Promise<ProductState> {
    return this.catalogue.publish(actor, productId);
  }

  @Post('products/:id/archive')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminArchiveProduct' })
  @ApiOkResponse({ type: ProductResponse })
  archive(@CurrentPrincipal() actor: Principal, @Param('id', id) productId: string): Promise<ProductState> {
    return this.catalogue.archive(actor, productId);
  }
}
