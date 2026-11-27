import { session } from '../../../../lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The API's ceiling (100 MB) plus room for the form around the file. */
const MAX_BODY_BYTES = 101 * 1024 * 1024;

const problem = (status: number, detail: string) =>
  Response.json({ status, title: 'Upload refused', detail }, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Streams a product video to the API. Videos are too large for a Server Action, so this route
 * passes the upload through without holding it, after the same checks a Server Action makes:
 * a signed-in session and a request from Admin's own pages.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return problem(404, 'Product not found');

  // Only Admin's own pages may post here (a form on another site cannot).
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return problem(403, 'Uploads must come from Admin');

  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) return problem(400, 'Send the video as a form upload');
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return problem(413, 'Videos can be up to 100 MB');
  if (!request.body) return problem(400, 'Choose a video to upload');

  let token: string | null;
  try {
    token = await session.actionAccessToken();
  } catch {
    return problem(503, 'We could not reach the store. Please try again in a moment.');
  }
  if (!token) return problem(401, 'Your session has ended. Sign in again.');

  const base = (process.env.API_BASE_URL ?? '').replace(/\/+$/, '');
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/v1/admin/products/${id}/videos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': type, ...(length ? { 'content-length': String(length) } : {}) },
      body: request.body,
      // Streams the body as it arrives instead of buffering it.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  } catch {
    return problem(503, 'We could not reach the store. Please try again in a moment.');
  }
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}
