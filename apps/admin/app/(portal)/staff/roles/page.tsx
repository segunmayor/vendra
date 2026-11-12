import { ActionForm, Card, Field, Input, PageHeader, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../../lib/session';
import { addRole } from '../actions';
import { PERMISSION_LABEL } from '../permissions';

export const metadata: Metadata = { title: 'Roles' };

export default async function RolesPage() {
  const [roles, permissions] = await Promise.all([session.read((api) => api.GET('/v1/admin/roles')), session.read((api) => api.GET('/v1/admin/permissions'))]);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/staff" className="text-muted underline underline-offset-2">
          Staff
        </Link>
      </p>
      <PageHeader title="Roles" description="A role is a named set of permissions, such as Packer or Finance." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Table caption="Roles" head={['Role', 'Can']}>
          {roles.map((role) => (
            <tr key={role.id}>
              <Td className="font-medium">{role.name}</Td>
              <Td>
                <ul className="space-y-0.5 text-sm">
                  {role.permissions.map((permission) => (
                    <li key={permission}>{PERMISSION_LABEL[permission] ?? permission}</li>
                  ))}
                </ul>
              </Td>
            </tr>
          ))}
        </Table>
        <Card className="h-fit p-6">
          <h2 className="text-lg font-semibold">Add a role</h2>
          <ActionForm action={addRole} className="mt-4 space-y-4">
            <Field label="Name">
              <Input name="name" minLength={2} maxLength={64} required />
            </Field>
            <fieldset>
              <legend className="text-sm font-medium">Can</legend>
              <div className="mt-2 space-y-2">
                {permissions.map((permission) => (
                  <label key={permission} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="permissions" value={permission} className="mt-0.5 size-4" />
                    <span>{PERMISSION_LABEL[permission] ?? permission}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <SubmitButton pendingLabel="Adding…">Add role</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
