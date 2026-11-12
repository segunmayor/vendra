import { ActionForm, Alert, Badge, Card, PageHeader, SubmitButton } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, session } from '../../../../lib/session';
import { resetMfa, setRoles, suspend } from '../actions';

export const metadata: Metadata = { title: 'Staff member' };

export default async function StaffMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const { id } = await params;
  const { added } = await searchParams;
  const [profile, staff, manageRoles] = await Promise.all([session.requireProfile(), session.read((api) => api.GET('/v1/admin/staff')), can('roles.manage')]);
  const person = staff.find((entry) => entry.id === id);
  if (!person) notFound();
  const roles = manageRoles ? await session.read((api) => api.GET('/v1/admin/roles')) : null;
  const self = person.id === profile.id;
  const held = new Set(person.roles.map((role) => role.id));

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/staff" className="text-muted underline underline-offset-2">
          Staff
        </Link>
      </p>
      <PageHeader
        title={person.email}
        actions={person.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge>Suspended</Badge>}
      />
      {added ? (
        <div className="mb-4 max-w-2xl">
          <Alert tone="success">Added. Send them the Admin address and their starting password.</Alert>
        </div>
      ) : null}
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-semibold">Roles</h2>
          {roles ? (
            <ActionForm action={setRoles.bind(null, person.id)} className="mt-4 space-y-3">
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roleIds" value={role.id} defaultChecked={held.has(role.id)} disabled={self} className="size-4" />
                  {role.name}
                </label>
              ))}
              {self ? <p className="text-sm text-muted">You cannot change your own roles.</p> : <SubmitButton size="sm">Save roles</SubmitButton>}
            </ActionForm>
          ) : (
            <p className="mt-2 text-sm">{person.roles.map((role) => role.name).join(', ') || 'None'}</p>
          )}
        </Card>
        <Card className="space-y-6 p-6">
          <div>
            <h2 className="font-semibold">Two-step sign-in</h2>
            <p className="mt-1 text-sm">{person.mfaEnabled ? 'On.' : 'Not set up yet. They will be asked to set it up when they sign in.'}</p>
            {person.mfaEnabled && !self ? (
              <ActionForm action={resetMfa.bind(null, person.id)} className="mt-3 space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="confirm" className="mt-0.5 size-4" />
                  They lost their phone and recovery codes, and I have checked it is really them.
                </label>
                <SubmitButton variant="outline" size="sm">
                  Reset two-step sign-in
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          {person.status === 'active' && !self ? (
            <div>
              <h2 className="font-semibold">Suspend</h2>
              <p className="mt-1 text-sm text-muted">Signs them out everywhere and stops them signing in.</p>
              <ActionForm action={suspend.bind(null, person.id)} className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="confirm" className="size-4" />
                  Suspend {person.email}
                </label>
                <SubmitButton variant="outline" size="sm">
                  Suspend
                </SubmitButton>
              </ActionForm>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
