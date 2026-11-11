import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const attributeValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const createCategorySchema = z.object({
  name: z.string().max(200),
  slug: z.string().max(100).optional(),
  parentId: z.uuid().nullable().default(null),
  attributes: z.array(z.unknown()).max(50).default([]),
});
export const updateCategorySchema = z.object({ name: z.string().max(200), attributes: z.array(z.unknown()).max(50) });
export const createBrandSchema = z.object({ name: z.string().max(200) });

const productDetails = {
  name: z.string().max(300),
  description: z.string().max(10_000).default(''),
  brandId: z.uuid().nullable().default(null),
  attributes: z.record(z.string(), attributeValue).default({}),
};
export const createProductSchema = z.object({ ...productDetails, categoryId: z.uuid(), slug: z.string().max(100).optional() });
export const updateProductSchema = z.object(productDetails);
export const addVariantSchema = z.object({
  sku: z.string().max(100),
  weightGrams: z.number().int(),
  options: z.record(z.string(), z.string()).default({}),
});
export const listProductsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

export class AttributeDefinitionResponse {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['text', 'number', 'boolean', 'select'] }) type!: string;
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({ type: [String] }) options?: string[];
}

export class CategoryResponse {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) parentId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: [AttributeDefinitionResponse] }) attributes!: AttributeDefinitionResponse[];
}

export class CreateCategoryDto {
  @ApiProperty() name!: string;
  @ApiPropertyOptional() slug?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) parentId!: string | null;
  @ApiProperty({ type: [AttributeDefinitionResponse] }) attributes!: unknown[];
}

export class UpdateCategoryDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: [AttributeDefinitionResponse] }) attributes!: unknown[];
}

export class BrandResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class CreateBrandDto {
  @ApiProperty() name!: string;
}

export class VariantResponse {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() weightGrams!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
}

export class ProductResponse {
  @ApiProperty() id!: string;
  @ApiProperty() categoryId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) brandId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } })
  attributes!: Record<string, string | number | boolean>;
  @ApiProperty({ enum: ['draft', 'published', 'archived'] }) status!: string;
  @ApiProperty({ type: [VariantResponse] }) variants!: VariantResponse[];
  @ApiProperty() version!: number;
}

export class ProductSummaryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: ['draft', 'published', 'archived'] }) status!: string;
  @ApiProperty() categoryId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) brandId!: string | null;
  @ApiProperty() variantCount!: number;
  @ApiProperty() updatedAt!: Date;
}

export class ProductDetailsDto {
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) brandId!: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) attributes!: Record<string, string | number | boolean | null>;
}

export class CreateProductDto extends ProductDetailsDto {
  @ApiProperty() categoryId!: string;
  @ApiPropertyOptional() slug?: string;
}

export class AddVariantDto {
  @ApiProperty() sku!: string;
  @ApiProperty() weightGrams!: number;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
}
