import { csvDownload } from '../../../../../lib/csv-download';
import { session } from '../../../../../lib/session';

/** The CSV template, with example rows, from the API. */
export async function GET(): Promise<Response> {
  let headers: Headers | undefined;
  const body = await session.find(async (api) => {
    const result = await api.GET('/v1/admin/product-imports/template', { parseAs: 'arrayBuffer' });
    headers = result.response.headers;
    return result;
  });
  if (!body || !headers) return new Response('Not found', { status: 404 });
  return csvDownload(body as ArrayBuffer, headers);
}
