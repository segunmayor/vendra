import { mediaFile } from '@vendra/portal-session/server';

/** Product photos and videos, passed through from the API (videos in byte ranges). */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  return mediaFile((await params).file, request);
}
