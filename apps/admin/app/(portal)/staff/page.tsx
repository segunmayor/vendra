import { ActionForm, Badge, Card, Field, Input, PageHeader, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { can, session } from '../../../lib/session';
import { addStaff } from './actions';

export const metadata: Metadata = { title: 'Staff' };

export default async function StaffPage() {
  const manageRoles = await can('roles.manage');
  const [staff, roles] = await Promise.all([session.read((api) => api.GET('/v1/admin/staff')), manageRoles ? session.read((api) => api.GET('/v1/admin/roles')) : null]);

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who can sign in to Admin. What each person can do comes from their roles."
        actions={
          manageRoles ? (
            <Link href="/staff/roles" className="text-sm font-medium underline underline-offset-2">
              Roles
            </Link>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Table caption="Staff" head={['Email', 'Roles', 'Two-step sign-in', 'Status']}>
          {staff.map((person) => (
            <tr key={person.id}>
              <Td>
                <Link href={`/staff/${person.id}`} className="underline underline-offset-2">
                  {person.email}
                </Link>
              </Td>
              <Td>{person.roles.map((role) => role.name).join(', ') || <span className="text-muted">None</span>}</Td>
              <Td>{person.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Not set up</Badge>}</Td>
              <Td>{person.status === 'active' ? 'Active' : <Badge>Suspended</Badge>}</Td>
            </tr>
          ))}
        </Table>
        <Card className="h-fit p-6">
          <h2 className="text-lg font-semibold">Add a staff member</h2>
          <ActionForm action={addStaff} className="mt-4 space-y-4">
            <Field label="Email">
              <Input type="email" name="email" autoComplete="off" required />
            </Field>
            <Field label="Starting password" hint="Give it to them privately. They set up two-step sign-in when they first sign in.">
              <Input type="password" name="password" autoComplete="new-password" minLength={8} maxLength={128} required />
            </Field>
            {roles ? (
              <fieldset>
                <legend className="text-sm font-medium">Roles</legend>
                <div className="mt-2 space-y-2">
                  {roles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="roleIds" value={role.id} className="size-4" />
                      {role.name}
                    </label>
                  ))}
                  {roles.length === 0 ? <p className="text-sm text-muted">No roles yet. Create one first.</p> : null}
                </div>
              </fieldset>
            ) : (
              <p className="text-sm text-muted">You can add people without roles. Someone with permission to manage roles assigns them.</p>
            )}
            <SubmitButton pendingLabel="Adding…">Add staff member</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
