import { Controller, Get, Headers, NotFoundException, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../platform/http/auth.decorators';
import { ProductMediaService } from '../application/media';

/** The most sent for one open-ended range ("bytes=0-"): players ask again for the rest. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** A single "bytes=start-end", "bytes=start-" or "bytes=-suffix" range, or null when absent. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Several ranges, or another unit: answer with the whole file, as HTTP allows.
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : Math.min(start + CHUNK_BYTES - 1, size - 1);
  }
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/**
 * Product photos and videos for the portals, which serve them from their own /media/ path. A file
 * never changes once stored (a new file gets a new name), so it may be cached for a year. Videos
 * are sent in ranges, so they start playing quickly and shoppers can skip ahead.
 */
@ApiTags('store catalogue')
@Public()
@Controller({ path: 'store/media', version: '1' })
export class MediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Get(':file')
  @ApiOperation({ operationId: 'storeGetMedia', summary: 'A product photo or video, by the file name in its address. Supports byte ranges.' })
  @ApiProduces('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 206, description: 'Part of the file, for a Range request' })
  async file(@Param('file') file: string, @Headers('range') rangeHeader: string | undefined, @Res({ passthrough: true }) response: Response): Promise<StreamableFile | undefined> {
    // Kept in a location serving files from a CDN: send the browser there instead. Short-lived,
    // as staff may change the address or move the file.
    const address = await this.media.publicAddressOf(file).catch(() => null);
    if (address) {
      response.setHeader('Cache-Control', 'public, max-age=3600');
      response.redirect(302, address);
      return undefined;
    }
    const info = await this.media.info(file);
    if (!info) throw new NotFoundException();
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('content-type', info.contentType);
    response.setHeader('content-security-policy', "default-src 'none'; sandbox");
    response.setHeader('accept-ranges', 'bytes');

    const range = parseRange(rangeHeader, info.sizeBytes);
    if (range === 'unsatisfiable') {
      response.status(416);
      response.setHeader('content-range', `bytes */${info.sizeBytes}`);
      return undefined;
    }
    if (range) {
      const part = await this.media.readRange(file, range.start, range.end);
      if (!part) throw new NotFoundException();
      response.status(206);
      response.setHeader('content-range', `bytes ${range.start}-${range.start + part.length - 1}/${info.sizeBytes}`);
      return new StreamableFile(Buffer.from(part));
    }
    const media = await this.media.read(file);
    if (!media) throw new NotFoundException();
    return new StreamableFile(Buffer.from(media.content));
  }
}
