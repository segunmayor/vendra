import { session } from '../../../lib/session';

/** Streams one of the applicant's own documents from the API, as a download. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  let headers: Headers | undefined;
  const body = await session.find(async (api) => {
    const result = await api.GET('/v1/vendor/application/documents/{documentId}', { params: { path: { documentId: id } }, parseAs: 'arrayBuffer' });
    headers = result.response.headers;
    return result;
  });
  if (!body || !headers) return new Response('Not found', { status: 404 });
  return new Response(body as ArrayBuffer, {
    headers: {
      'content-type': headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': headers.get('content-disposition') ?? 'attachment',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
