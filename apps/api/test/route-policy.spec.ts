import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { RequestMethod, Type } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { IS_PUBLIC, REQUIRE_MFA, REQUIRED_PERMISSION, SURFACE, GUEST_ALLOWED } from '../src/platform/http/auth.decorators';

interface Route {
  readonly route: string;
  readonly surface?: string;
  readonly permission?: string;
  readonly public: boolean;
  readonly guest: boolean;
  readonly mfa: boolean;
}

function controllersOf(module: Type, seen = new Set<Type>()): Type[] {
  if (seen.has(module)) return [];
  seen.add(module);
  const own: Type[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) ?? [];
  const imports: Type[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? [];
  return [...own, ...imports.flatMap((imported) => controllersOf(imported, seen))];
}

const meta = <T>(key: string, method: object, controller: Type): T | undefined => Reflect.getMetadata(key, method) ?? Reflect.getMetadata(key, controller);

function routes(): Route[] {
  return controllersOf(AppModule).flatMap((controller) => {
    const base = [Reflect.getMetadata(PATH_METADATA, controller)].flat().filter(Boolean).join('/');
    return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      const handler = controller.prototype[name];
      if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) return [];
      const path = [Reflect.getMetadata(PATH_METADATA, handler)].flat().filter((part) => part && part !== '/').join('/');
      const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      return [
        {
          route: `${verb} /${[base, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
          surface: meta<string>(SURFACE, handler, controller),
          permission: meta<string>(REQUIRED_PERMISSION, handler, controller),
          public: meta<boolean>(IS_PUBLIC, handler, controller) === true,
          guest: meta<boolean>(GUEST_ALLOWED, handler, controller) === true,
          mfa: meta<boolean>(REQUIRE_MFA, handler, controller) === true,
        },
      ];
    });
  });
}

/**
 * Staff routes any signed-in staff member may use: their own session, password and
 * two-step sign-in. Every other staff route must name a permission.
 */
const STAFF_SELF_SERVICE = /^(GET|POST|PUT|DELETE) \/admin\/auth\//;

/** Every route anyone can call without signing in. Adding one is a security decision. */
const PUBLIC_ROUTES = [
  'GET /health',
  'GET /health/ready',
  'GET /store/settings',
  'GET /store/categories',
  'GET /store/products',
  'GET /store/products/:slug',
  'POST /admin/auth/login',
  'POST /admin/auth/refresh',
  'POST /admin/auth/logout',
  'POST /admin/auth/mfa/verify',
  'POST /store/auth/login',
  'POST /store/auth/refresh',
  'POST /store/auth/logout',
  'POST /store/auth/register',
  'POST /vendor/auth/login',
  'POST /vendor/auth/refresh',
  'POST /vendor/auth/logout',
  'POST /vendor/auth/register',
  'POST /webhooks/payments/:gatewayId',
];

describe('route access policy', () => {
  const all = routes();

  it('finds the routes', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it('gives every route a policy: public, or a surface', () => {
    expect(all.filter((route) => !route.public && !route.surface).map((route) => route.route)).toEqual([]);
  });

  it('keeps the public routes to a reviewed list', () => {
    const open = all.filter((route) => route.public).map((route) => route.route).sort();
    expect({ unexpected: open.filter((route) => !PUBLIC_ROUTES.includes(route)), missing: PUBLIC_ROUTES.filter((route) => !open.includes(route)) }).toEqual({ unexpected: [], missing: [] });
  });

  it('requires a permission on every staff route except staff self-service', () => {
    const unguarded = all.filter((route) => route.surface === 'admin' && !route.permission && !STAFF_SELF_SERVICE.test(route.route)).map((route) => route.route);
    expect(unguarded).toEqual([]);
  });

  it('serves each surface only under its own path prefix', () => {
    const prefix: Record<string, RegExp> = { admin: /^\w+ \/admin\//, store: /^\w+ \/store\//, vendor: /^\w+ \/vendor\// };
    expect(all.filter((route) => route.surface && !prefix[route.surface]!.test(route.route)).map((route) => `${route.surface}: ${route.route}`)).toEqual([]);
  });

  it('needs a verified second factor for refunds and gateway keys', () => {
    const mfa = all.filter((route) => route.mfa).map((route) => route.route);
    expect(mfa).toEqual(expect.arrayContaining([expect.stringMatching(/refunds/), expect.stringMatching(/payment-gateways/)]));
  });
});
