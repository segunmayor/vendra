import { EmptyState } from '@vendra/ui';

export default function ApplicationPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sell on Vendra</h1>
      <div className="mt-6">
        <EmptyState title="Start your seller application">
          Applications open soon. You will register your business and submit documents for verification here.
        </EmptyState>
      </div>
    </>
  );
}
