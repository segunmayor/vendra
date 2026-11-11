import { session } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return session.refreshRoute(request);
}
