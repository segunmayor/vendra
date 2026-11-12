import { base32Decode, hotp } from '../../src/modules/identity/infrastructure/totp';

export interface Reply {
  status: number;
  body: any;
}
type Call = (method: string, path: string, options?: { token?: string; body?: unknown }) => Promise<Reply>;

/** The code an authenticator app would show, `offset` 30-second steps from now. */
export function totpCode(secret: string, offset = 0): string {
  return hotp(base32Decode(secret), Math.floor(Date.now() / 30_000) + offset);
}

/**
 * Turns on two-step sign-in for a signed-in staff member, as the admin portal does. Their
 * current session becomes verified, so `token` can be used for anything afterwards.
 */
export async function enrolMfa(call: Call, token: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await call('POST', 'admin/auth/mfa/setup', { token });
  if (setup.status !== 200) throw new Error(`MFA setup failed: ${setup.status} ${JSON.stringify(setup.body)}`);
  const confirm = await call('POST', 'admin/auth/mfa/confirm', { token, body: { code: totpCode(setup.body.secret) } });
  if (confirm.status !== 200) throw new Error(`MFA confirm failed: ${confirm.status} ${JSON.stringify(confirm.body)}`);
  return { secret: setup.body.secret, recoveryCodes: confirm.body.recoveryCodes };
}

/** Signs a staff member in with password, and enrols them so the session is verified. */
export async function verifiedStaffToken(call: Call, email: string, password: string): Promise<string> {
  const login = await call('POST', 'admin/auth/login', { body: { email, password } });
  if (login.status !== 200 || !login.body.accessToken) throw new Error(`Staff login failed: ${login.status} ${JSON.stringify(login.body)}`);
  await enrolMfa(call, login.body.accessToken);
  return login.body.accessToken;
}
