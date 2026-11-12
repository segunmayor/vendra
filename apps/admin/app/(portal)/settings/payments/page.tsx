import { ActionForm, Badge, Card, EmptyState, Field, Input, PageHeader, Select, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../../lib/session';
import { createGateway } from './actions';

export const metadata: Metadata = { title: 'Payment gateways' };

export default async function GatewaysPage() {
  const [gateways, types] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/payment-gateways')),
    session.read((api) => api.GET('/v1/admin/payment-gateways/types')),
  ]);
  const label = new Map(types.map((type) => [type.type, type.label]));
  const live = gateways.filter((gateway) => gateway.enabled);
  return (
    <>
      <PageHeader title="Payment gateways" description="Customers choose from the gateways that are on, in this order. Keys are encrypted and never shown again." />
      {live.length === 0 ? (
        <div className="mb-4 rounded-brand border border-[#f1d9a0] bg-[#fdf3dc] px-4 py-3 text-sm text-[#7a5200]">No gateway is on, so customers cannot pay yet.</div>
      ) : null}
      {gateways.length === 0 ? (
        <EmptyState title="No gateways yet">Add one below, enter its keys, then turn it on.</EmptyState>
      ) : (
        <Table caption="Payment gateways" head={['Gateway', 'Type', 'Mode', 'Status', 'Order']}>
          {gateways.map((gateway) => (
            <tr key={gateway.id}>
              <Td>
                <Link href={`/settings/payments/${gateway.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {gateway.name}
                </Link>
              </Td>
              <Td>{label.get(gateway.type) ?? gateway.type}</Td>
              <Td>
                <Badge tone={gateway.mode === 'live' ? 'danger' : 'neutral'}>{gateway.mode === 'live' ? 'Live: real money' : 'Test'}</Badge>
              </Td>
              <Td>
                <Badge tone={gateway.enabled ? 'success' : 'neutral'}>{gateway.enabled ? 'On' : 'Off'}</Badge>
              </Td>
              <Td>{gateway.position}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Card className="mt-8 max-w-xl">
        <h2 className="mb-3 font-semibold">Add a gateway</h2>
        <ActionForm action={createGateway} className="space-y-3">
          <Field label="Type">
            <Select name="type" required>
              {types.map((type) => (
                <option key={type.type} value={type.type}>
                  {type.label}: {type.description}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name customers see" hint="Such as Paystack or Pay by card.">
            <Input name="name" required minLength={2} maxLength={60} />
          </Field>
          <SubmitButton>Add gateway</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
