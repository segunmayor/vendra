import { csvDownload } from '../../../../../../lib/csv-download';
import { isUuid } from '../../../../../../lib/catalogue';
import { session } from '../../../../../../lib/session';

/** Every problem and warning in an import, as CSV to fix in a spreadsheet. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!isUuid(id)) return new Response('Not found', { status: 404 });
  let headers: Headers | undefined;
  const body = await session.find(async (api) => {
    const result = await api.GET('/v1/admin/product-imports/{id}/report', { params: { path: { id } }, parseAs: 'arrayBuffer' });
    headers = result.response.headers;
    return result;
  });
  if (!body || !headers) return new Response('Not found', { status: 404 });
  return csvDownload(body as ArrayBuffer, headers);
}
