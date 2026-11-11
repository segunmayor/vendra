import 'server-only';
import { createPortalSession } from '@vendra/portal-session/server';

export const session = createPortalSession('admin');

/** Pages hide what a staff member cannot use. The API enforces it regardless. */
export async function can(permission: string): Promise<boolean> {
  return (await session.requireProfile()).permissions.includes(permission);
}
