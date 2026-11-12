import { getPublicSettings, text } from '@vendra/portal-session/server';
import { EmptyState } from '@vendra/ui';

export default async function ApplicationPage() {
  const name = text(await getPublicSettings(), 'store.name');
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sell on {name}</h1>
      <div className="mt-6">
        <EmptyState title="Start your seller application">
          Applications open soon. You will register your business and submit documents for verification here.
        </EmptyState>
      </div>
    </>
  );
}
