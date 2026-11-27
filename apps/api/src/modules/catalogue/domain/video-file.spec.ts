import { DomainError } from '../../../shared-kernel';
import { checkVideo, VIDEO_HARD_LIMIT_BYTES } from './image-file';

const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from(brand), 0, 0, 0, 0]);

describe('product video files', () => {
  it.each([
    ['isom', 'video/mp4', 'mp4'],
    ['mp42', 'video/mp4', 'mp4'],
    ['M4V ', 'video/mp4', 'mp4'],
    ['qt  ', 'video/quicktime', 'mov'],
  ])('recognises an MP4 family file with brand %s', (brand, contentType, extension) => {
    expect(checkVideo(ftyp(brand), 1024)).toEqual({ contentType, extension });
  });

  it('recognises WebM', () => {
    expect(checkVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), 1024)).toEqual({ contentType: 'video/webm', extension: 'webm' });
  });

  it('refuses anything else, whatever it is called', () => {
    expect(() => checkVideo(new Uint8Array(Buffer.from('<html>not a video</html>')), 1024)).toThrow('not an MP4, MOV or WebM video');
    expect(() => checkVideo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1024)).toThrow(DomainError);
    expect(() => checkVideo(new Uint8Array(), 1024)).toThrow('empty');
  });

  it('applies the configured size, and never more than the hard ceiling', () => {
    expect(() => checkVideo(new Uint8Array(2048).fill(1), 1024)).toThrow('Videos can be up to 0 MB');
    const big = { length: VIDEO_HARD_LIMIT_BYTES + 1 } as unknown as Uint8Array;
    expect(() => checkVideo(big, VIDEO_HARD_LIMIT_BYTES * 2)).toThrow('Videos can be up to 100 MB');
  });
});
