import { EmptyState, PortalShell, Wordmark } from '@vendra/ui';

const navigation = ['Application', 'Business verification', 'Support'];

export default function ApplicationPage() {
  return (
    <PortalShell brand={<Wordmark suffix="Sellers" />} navigation={navigation}>
      <h1 className="text-2xl font-bold tracking-tight">Sell on Vendra</h1>
      <div className="mt-6">
        <EmptyState title="Start your seller application">
          Applications open soon. You will register your business and submit documents for verification here.
        </EmptyState>
      </div>
    </PortalShell>
  );
}
