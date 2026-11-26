import { Body, Controller, HttpCode, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { DomainError, Principal } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { CatalogueService, MAX_IMAGES } from '../application/catalogue.service';
import { IMAGE_HARD_LIMIT_BYTES, ProductMediaService } from '../application/media';
import { DownloadLimits, ProductState } from '../application/ports';
import { ProductResponse } from './dto';

const id = new ZodPipe(z.uuid());
const fromUrlSchema = z.object({ url: z.string().trim().min(1).max(2000) });
const arrangeSchema = z.object({ images: z.array(z.string().max(2100)).max(MAX_IMAGES) });

class UploadPhotoDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'A JPEG, PNG, GIF, WebP or AVIF photo' }) file!: unknown;
}

class PhotoFromUrlDto {
  @ApiProperty({ description: 'A direct https:// link to the photo file' }) url!: string;
}

class ArrangePhotosDto {
  @ApiProperty({ type: [String], description: 'The photos to keep, in display order. Only photos the product already has.' }) images!: string[];
}

interface UploadedPhoto {
  readonly buffer: Buffer;
}

/** Photos on a product: upload from the computer, fetch from a web address, reorder and remove. */
@ApiTags('admin catalogue')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('catalogue.manage')
@Controller({ path: 'admin/products/:id/images', version: '1' })
export class ProductPhotosController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly media: ProductMediaService,
    private readonly settings: SettingsReader,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_HARD_LIMIT_BYTES, files: 1, fields: 0, parts: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadPhotoDto })
  @ApiOperation({ operationId: 'adminUploadProductImage', summary: 'Add a photo from the computer, after the others' })
  @ApiOkResponse({ type: ProductResponse })
  async upload(@CurrentPrincipal() actor: Principal, @Param('id', id) productId: string, @UploadedFile() file: UploadedPhoto | undefined): Promise<ProductState> {
    if (!file) throw new DomainError('media.no_file', 'Choose a photo to upload');
    await this.catalogue.assertRoomForImage(productId);
    const { maxBytes } = await this.limits();
    const image = await this.media.upload(new Uint8Array(file.buffer), maxBytes);
    return this.catalogue.addImage(actor, productId, image);
  }

  @Post('from-url')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminAddProductImageFromUrl', summary: 'Download a photo from a web address and add it after the others' })
  @ApiOkResponse({ type: ProductResponse })
  async fromUrl(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) productId: string,
    @Body(new ZodPipe(fromUrlSchema)) body: PhotoFromUrlDto,
  ): Promise<ProductState> {
    await this.catalogue.assertRoomForImage(productId);
    const image = await this.media.importFromUrl(body.url, await this.limits());
    return this.catalogue.addImage(actor, productId, image);
  }

  @Put()
  @ApiOperation({ operationId: 'adminArrangeProductImages', summary: 'Reorder or remove photos. The first is the main photo.' })
  @ApiOkResponse({ type: ProductResponse })
  arrange(
    @CurrentPrincipal() actor: Principal,
    @Param('id', id) productId: string,
    @Body(new ZodPipe(arrangeSchema)) body: ArrangePhotosDto,
  ): Promise<ProductState> {
    return this.catalogue.arrangeImages(actor, productId, body.images);
  }

  private async limits(): Promise<DownloadLimits> {
    const [maxImageMb, timeoutSeconds, allowHttp] = await this.settings.getMany(['imports.maxImageMb', 'imports.imageTimeoutSeconds', 'imports.allowHttpImages'] as const);
    return { maxBytes: maxImageMb * 1024 * 1024, timeoutMs: timeoutSeconds * 1000, allowHttp };
  }
}
