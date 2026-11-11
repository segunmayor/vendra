import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  /** Shared with the portals so they can pass on the visitor's IP address. */
  PORTAL_SHARED_SECRET: z.string().min(32).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof schema>;

/** Injection token for the validated environment. */
export const ENV = Symbol('ENV');

/** Fails at startup, naming the bad variables but never their values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
