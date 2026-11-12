import { ActionForm, Card, Field, Input, PageHeader, SubmitButton } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { session } from '../../../../../lib/session';
import { testGateway, updateGateway } from '../actions';

export const metadata: Metadata = { title: 'Payment gateway' };

export default async function GatewayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [gateways, types] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/payment-gateways')),
    session.read((api) => api.GET('/v1/admin/payment-gateways/types')),
  ]);
  const gateway = gateways.find((entry) => entry.id === id);
  const type = gateway && types.find((entry) => entry.type === gateway.type);
  if (!gateway || !type) notFound();

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/settings/payments" className="text-muted underline underline-offset-2">
          Payment gateways
        </Link>
      </p>
      <PageHeader title={gateway.name} description={`${type.label}. ${type.description}`} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <ActionForm action={updateGateway.bind(null, gateway.id)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name customers see">
                <Input name="name" defaultValue={gateway.name} required minLength={2} maxLength={60} />
              </Field>
              <Field label="Order" hint="Lower numbers are shown first.">
                <Input name="position" type="number" min={0} max={100} defaultValue={gateway.position} className="w-24" />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Mode</legend>
              <div className="flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" value="test" defaultChecked={gateway.mode === 'test'} /> Test: no real money
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" value="live" defaultChecked={gateway.mode === 'live'} /> Live: real payments
                </label>
              </div>
              <p className="mt-1 text-xs text-muted">Keys must match the mode. Switching mode needs the other mode&apos;s keys.</p>
            </fieldset>
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold">Credentials</legend>
              {type.credentials.map((credential) => {
                const saved = gateway.credentialHints[credential.key];
                return (
                  <Field key={credential.key} label={credential.label} hint={`${credential.help} ${saved ? `Saved (${saved}). Leave blank to keep it.` : 'Not saved yet.'}`}>
                    <Input name={`credential.${credential.key}`} type="password" autoComplete="off" placeholder={saved ? `Saved ${saved}` : ''} maxLength={500} />
                  </Field>
                );
              })}
            </fieldset>
            {type.config.map((config) => (
              <Field key={config.key} label={config.label} hint={config.help}>
                <Input name={`config.${config.key}`} type="url" defaultValue={gateway.config[config.key] ?? config.default} />
              </Field>
            ))}
            <label className="flex items-center gap-3 rounded-brand border border-border bg-background px-4 py-3 text-sm font-medium">
              <input type="checkbox" name="enabled" defaultChecked={gateway.enabled} className="size-5" />
              On: customers can pay with this gateway
            </label>
            <SubmitButton>Save gateway</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Webhook</h2>
            <p className="mt-1 text-sm text-muted">{type.webhookNote}</p>
            <code className="mt-3 block rounded-brand bg-background px-3 py-2 text-xs break-all">{gateway.webhookUrl}</code>
            <p className="mt-2 text-xs text-muted">
              The address comes from Settings, API address. Payments are confirmed with the gateway directly, so a missing webhook only delays confirmation.
            </p>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Check the connection</h2>
            <p className="mb-3 text-sm text-muted">Makes a harmless call to the gateway with the saved keys.</p>
            <ActionForm action={testGateway.bind(null, gateway.id)}>
              <SubmitButton variant="outline" pendingLabel="Checking…">
                Test connection
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
