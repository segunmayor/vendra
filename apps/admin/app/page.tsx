import { EmptyState, PortalShell, Wordmark } from '@vendra/ui';

const navigation = ['Dashboard', 'Catalogue', 'Inventory', 'Orders', 'Payments', 'Shipments', 'Vendors', 'Staff', 'Audit log'];

export default function DashboardPage() {
  return (
    <PortalShell brand={<Wordmark suffix="Admin" />} navigation={navigation}>
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <div className="mt-6">
        <EmptyState title="No activity yet">Business metrics will appear here once orders are being placed.</EmptyState>
      </div>
    </PortalShell>
  );
}
