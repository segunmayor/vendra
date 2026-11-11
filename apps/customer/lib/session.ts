import 'server-only';
import { createPortalSession } from '@vendra/portal-session/server';
import { mergeGuestCart } from './cart-cookie';

export const session = createPortalSession('store', { homePath: '/account', onSignedIn: mergeGuestCart });
