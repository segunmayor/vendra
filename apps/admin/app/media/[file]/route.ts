import { mediaFile } from '@vendra/portal-session/server';

/** Product photos, passed through from the API. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  return mediaFile((await params).file);
}
