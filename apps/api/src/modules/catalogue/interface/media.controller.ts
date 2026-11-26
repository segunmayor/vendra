import { Controller, Get, Header, NotFoundException, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../platform/http/auth.decorators';
import { ProductMediaService } from '../application/media';

/**
 * Product photos for the portals, which serve them from their own /media/ path. A file never
 * changes once stored (a new photo gets a new name), so it may be cached for a year.
 */
@ApiTags('store catalogue')
@Public()
@Controller({ path: 'store/media', version: '1' })
export class MediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Get(':file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @ApiOperation({ operationId: 'storeGetMedia', summary: 'A product photo, by the file name in a product image address' })
  @ApiProduces('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async file(@Param('file') file: string, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const media = await this.media.read(file);
    if (!media) throw new NotFoundException();
    response.setHeader('content-type', media.contentType);
    response.setHeader('content-security-policy', "default-src 'none'; sandbox");
    return new StreamableFile(Buffer.from(media.content));
  }
}
