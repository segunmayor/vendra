import { ActionForm, Card, Field, SubmitButton, Textarea } from '@vendra/ui';
import { cancelOrder } from '../actions';

/** Staff cancel an order before anything leaves with a courier. The refund is a separate step. */
export function CancelOrder({ orderId, version, stockIssue }: { orderId: string; version: number; stockIssue: boolean }) {
  return (
    <Card className="p-6 text-sm">
      <h2 className="font-semibold">Cancel order</h2>
      <p className="mt-2 text-muted">
        {stockIssue
          ? 'Closes the order. No stock was taken for it.'
          : 'The items go back on sale, and a shipment waiting for collection is cancelled.'}{' '}
        This does not refund the customer: refund them from the payment.
      </p>
      <ActionForm action={cancelOrder.bind(null, orderId, version)} className="mt-4 space-y-3">
        <Field label="Reason" hint="Staff see this. The customer does not.">
          <Textarea name="reason" required minLength={3} maxLength={300} rows={2} />
        </Field>
        <SubmitButton variant="outline" pendingLabel="Cancelling…">
          Cancel order
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
