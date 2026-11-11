import 'server-only';
import { createPortalSession } from '@vendra/portal-session/server';

export const session = createPortalSession('store', { homePath: '/account' });
