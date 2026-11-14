import { ActionForm, Alert, Badge, Card, Field, Input, SubmitButton } from '@vendra/ui';
import { moveShipment, sendItems } from '../actions';
import { dateTime, SHIPMENT_ACTION, SHIPMENT_LABEL, SHIPMENT_TONE, type ShipmentStatus } from '../labels';

interface Shipment {
  id: string;
  sellerOrderId: string;
  status: string;
  courier?: string | null;
  trackingReference?: string | null;
  history: { status: string; at: string; note?: string | null }[];
  attempts: { attemptNumber: number; successful: boolean; reason?: string | null }[];
  nextStatuses: string[];
  version: number;
}

const label = (status: string) => SHIPMENT_LABEL[status as ShipmentStatus] ?? status;

/** One seller order's delivery: its shipments, and what staff can do next. */
export function Delivery({
  orderId,
  orderStatus,
  sellerOrder,
  shipments,
  mayShip,
}: {
  orderId: string;
  orderStatus: string;
  sellerOrder: { id: string; status: string };
  shipments: Shipment[];
  mayShip: boolean;
}) {
  const open = shipments.find((shipment) => shipment.nextStatuses.length > 0);
  const canSend = mayShip && orderStatus === 'placed' && sellerOrder.status === 'pending' && !open;

  return (
    <Card className="p-6">
      <h2 className="font-semibold">Delivery</h2>
      {shipments.length === 0 && !canSend ? (
        <p className="mt-2 text-sm text-muted">{orderStatus === 'cancelled' ? 'Cancelled before it was sent.' : 'Not sent yet.'}</p>
      ) : null}

      {shipments
        .slice()
        .reverse()
        .map((shipment) => (
          <div key={shipment.id} className="mt-4 border-t border-border pt-4 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SHIPMENT_TONE[shipment.status as ShipmentStatus] ?? 'neutral'}>{label(shipment.status)}</Badge>
              <span className="text-sm">
                {shipment.courier ?? 'No courier'} · <span className="font-mono text-xs">{shipment.trackingReference ?? 'no tracking number'}</span>
              </span>
            </div>
            <ol className="mt-3 space-y-1 text-sm">
              {shipment.history.map((change, index) => (
                <li key={index} className="flex gap-3">
                  <span className="w-36 shrink-0 text-muted tabular-nums">{dateTime.format(new Date(change.at))}</span>
                  <span>
                    {label(change.status)}
                    {change.note ? <span className="block text-muted">{change.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
            {mayShip && shipment.nextStatuses.length > 0 ? (
              <ActionForm action={moveShipment.bind(null, orderId, shipment.id, shipment.version)} className="mt-4 space-y-3">
                <Field label="Note" hint={shipment.nextStatuses.includes('delivery_failed') ? 'Needed if the delivery failed: say why.' : 'Optional. Customers do not see it.'}>
                  <Input name="note" maxLength={300} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {shipment.nextStatuses.map((next) => (
                    <SubmitButton key={next} name="status" value={next} size="sm" variant={next === 'cancelled' || next === 'delivery_failed' || next === 'returning' ? 'outline' : 'primary'}>
                      {SHIPMENT_ACTION[next as ShipmentStatus] ?? next}
                    </SubmitButton>
                  ))}
                </div>
              </ActionForm>
            ) : null}
          </div>
        ))}

      {canSend ? (
        <ActionForm action={sendItems.bind(null, orderId, sellerOrder.id)} className="mt-4 space-y-4">
          {shipments.length > 0 ? <Alert tone="warning">The last shipment did not reach the customer. Send the items again when ready.</Alert> : null}
          <Field label="Courier or rider" hint="Who is collecting the parcel, for example GIG Logistics or a rider's name.">
            <Input name="courier" required minLength={2} maxLength={80} />
          </Field>
          <Field label="Tracking number" hint="From the courier's waybill. Leave blank and Vendra issues one.">
            <Input name="trackingReference" maxLength={60} />
          </Field>
          <Field label="Note" hint="Optional. Customers do not see it.">
            <Input name="note" maxLength={300} />
          </Field>
          <SubmitButton pendingLabel="Saving…">Hand to courier</SubmitButton>
        </ActionForm>
      ) : null}
      {mayShip && orderStatus === 'stock_issue' ? <p className="mt-2 text-sm text-muted">Orders with a stock issue cannot be sent. Refund the customer instead.</p> : null}
    </Card>
  );
}
