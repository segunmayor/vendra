import { session } from '../../../../../../lib/session';

const UUID = /^[0-9a-f-]{36}$/i;

/** Streams an applicant's document from the API, as a download. Never shown inline. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }): Promise<Response> {
  const { id, documentId } = await params;
  if (!UUID.test(id) || !UUID.test(documentId)) return new Response('Not found', { status: 404 });
  let headers: Headers | undefined;
  const body = await session.find(async (api) => {
    const result = await api.GET('/v1/admin/sellers/{id}/documents/{documentId}', { params: { path: { id, documentId } }, parseAs: 'arrayBuffer' });
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
