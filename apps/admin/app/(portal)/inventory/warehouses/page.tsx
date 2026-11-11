import { ActionForm, Card, EmptyState, Field, Input, PageHeader, Select, SubmitButton, Table, Td } from '@vendra/ui';
import type { FormState } from '@vendra/ui';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { text, toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Warehouses · Vendra Admin' };

const STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

async function createWarehouse(_state: FormState, data: FormData): Promise<FormState> {
  'use server';
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/warehouses', {
      body: { name: text(data, 'name'), address: { line1: text(data, 'line1'), city: text(data, 'city'), state: text(data, 'state') } },
    }),
  );
  revalidatePath('/inventory/warehouses');
  return toFormState(result, 'Warehouse added');
}

export default async function WarehousesPage() {
  const warehouses = await session.read((api) => api.GET('/v1/admin/warehouses'));
  return (
    <>
      <PageHeader title="Warehouses" description="Where Vendra holds stock. Record stock from each product's page." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {warehouses.length === 0 ? (
          <EmptyState title="No warehouses yet">Add the location that holds the opening stock.</EmptyState>
        ) : (
          <Table caption="Warehouses" head={['Warehouse', 'Address']}>
            {warehouses.map((warehouse) => (
              <tr key={warehouse.id}>
                <Td className="font-medium">{warehouse.name}</Td>
                <Td className="text-muted">
                  {warehouse.address.line1}, {warehouse.address.city}, {warehouse.address.state}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Card>
          <h2 className="mb-3 font-semibold">Add a warehouse</h2>
          <ActionForm action={createWarehouse} className="space-y-3">
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={100} placeholder="Ikeja fulfilment centre" />
            </Field>
            <Field label="Street address">
              <Input name="line1" required minLength={3} maxLength={200} />
            </Field>
            <Field label="City">
              <Input name="city" required minLength={2} maxLength={100} />
            </Field>
            <Field label="State">
              <Select name="state" defaultValue="Lagos" required>
                {STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton>Add warehouse</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
