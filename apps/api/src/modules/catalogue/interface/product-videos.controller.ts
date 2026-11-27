import { Body, Controller, HttpCode, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { DomainError, Principal } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { CatalogueService, MAX_VIDEOS } from '../application/catalogue.service';
import { ProductMediaService, VIDEO_HARD_LIMIT_BYTES } from '../application/media';
import { ProductState } from '../application/ports';
import { ProductResponse } from './dto';

const id = new ZodPipe(z.uuid());
const arrangeSchema = z.object({ videos: z.array(z.string().max(200)).max(MAX_VIDEOS) });

class UploadVideoDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'An MP4, MOV or WebM video' }) file!: unknown;
}

class ArrangeVideosDto {
  @ApiProperty({ type: [String], description: 'The videos to keep, in display order. Only videos the product already has.' }) videos!: string[];
}

interface UploadedVideo {
  readonly buffer: Buffer;
}

/** Videos on a product: upload, reorder and remove. */
@ApiTags('admin catalogue')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('catalogue.manage')
@Controller({ path: 'admin/products/:id/videos', version: '1' })
export class ProductVideosController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly media: ProductMediaService,
    private readonly settings: SettingsReader,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VIDEO_HARD_LIMIT_BYTES, files: 1, fields: 0, parts: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadVideoDto })
  @ApiOperation({ operationId: 'adminUploadProductVideo', summary: 'Add a video, after the others' })
  @ApiOkResponse({ type: ProductResponse })
  async upload(@CurrentPrincipal() actor: Principal, @Param('id', id) productId: string, @UploadedFile() file: UploadedVideo | undefined): Promise<ProductState> {
    if (!file) throw new DomainError('media.no_file', 'Choose a video to upload');
    const [maxMb, maxVideos] = await this.settings.getMany(['media.maxVideoMb', 'media.maxVideosPerProduct'] as const);
    await this.catalogue.assertRoomForVideo(productId, maxVideos);
    const video = await this.media.uploadVideo(new Uint8Array(file.buffer), maxMb * 1024 * 1024);
    return this.catalogue.addVideo(actor, productId, video);
  }

  @Put()
  @ApiOperation({ operationId: 'adminArrangeProductVideos', summary: 'Reorder or remove videos' })
  @ApiOkResponse({ type: ProductResponse })
  arrange(@CurrentPrincipal() actor: Principal, @Param('id', id) productId: string, @Body(new ZodPipe(arrangeSchema)) body: ArrangeVideosDto): Promise<ProductState> {
    return this.catalogue.arrangeVideos(actor, productId, body.videos);
  }
}
