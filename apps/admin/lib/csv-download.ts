import 'server-only';

/** Passes a CSV file from the API to the browser as a download, never shown inline. */
export function csvDownload(body: ArrayBuffer, headers: Headers): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': headers.get('content-disposition') ?? 'attachment; filename="products.csv"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
