import { Alert, Badge, Card, PageHeader } from '@vendra/ui';
import type { Metadata } from 'next';
import { session } from '../../../../lib/session';
import { MfaSetup, ReplaceRecoveryCodes } from './mfa-forms';

export const metadata: Metadata = { title: 'Two-step sign-in' };

export default async function SecurityPage() {
  const profile = await session.requireProfile();
  const status = await session.read((api) => api.GET('/v1/admin/auth/mfa'));

  return (
    <>
      <PageHeader
        title="Two-step sign-in"
        description="After your password, Admin asks for a code from an app on your phone, so a stolen password alone cannot get in."
      />
      {profile.mfa.setupRequired ? (
        <div className="mb-4">
          <Alert tone="warning">Set up two-step sign-in to start using Admin.</Alert>
        </div>
      ) : null}
      <Card className="max-w-2xl p-6">
        {status.enabled ? (
          <div className="space-y-6">
            <p className="flex items-center gap-2 text-sm">
              <Badge tone="success">On</Badge> Your account asks for a code from your authenticator app.
            </p>
            <p className="text-sm">
              Recovery codes left: <strong className="tabular-nums">{status.recoveryCodesLeft}</strong> of 10.
              {status.recoveryCodesLeft <= 3 ? ' Make new ones soon.' : ''}
            </p>
            {status.verified ? (
              <ReplaceRecoveryCodes />
            ) : (
              <Alert tone="warning">Sign out and sign in again with your code to make new recovery codes.</Alert>
            )}
            <p className="text-sm text-muted">Lost your phone and your recovery codes? Ask another administrator to reset your two-step sign-in.</p>
          </div>
        ) : (
          <MfaSetup />
        )}
      </Card>
    </>
  );
}
