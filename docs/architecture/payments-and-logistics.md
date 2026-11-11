# Payments and logistics

## Payments

The domain depends on `PaymentProviderPort` (`modules/payments/application/ports`). Provider SDKs and HTTP calls exist only in adapters.

Flow:

1. `checkout` asks `payments` to initiate. A `Payment` is created with a unique Vendra `reference` and the expected amount.
2. The provider adapter returns a redirect URL and the customer pays.
3. The callback or webhook only **triggers** verification. It is never proof of payment.
4. `payments` asks the provider directly for the transaction's status, compares amount and currency against the `Payment`, then records the outcome.
5. A `PaymentSucceeded` event is committed with the state change. `orders` confirms the order and `ledger` posts the journal entry.

Integrity rules, all covered by tests:

- Verifying the same successful payment again changes nothing and emits nothing.
- A successful result with the wrong amount or currency moves the payment to `requires_review`. It never succeeds automatically.
- A late success after a failure is honoured, because the customer's money was taken.
- Contradictory results on a settled payment raise a conflict event and leave the state unchanged.
- Cumulative refunds cannot exceed the captured amount.
- A webhook with an invalid signature is rejected before any processing.
- A webhook is marked processed only after it succeeds, so a provider retry after a transient failure is processed, while a retry after success is ignored.

Reconciliation is a scheduled worker job that compares provider transactions with `Payment` records and raises discrepancies for staff.

**Provider choice:** the Paystack and Flutterwave evaluation is outstanding, and must be done against current official documentation. Paystack is the provisional choice for launch.

### Ledger

Double-entry. `JournalEntry` refuses to exist unless debits equal credits in a single currency. Marketplace commission and vendor payables use the same ledger when `settlements` is built.

## Logistics

`shipping` depends on `LogisticsProviderPort`. Adapters are replaceable without touching the `Shipment` aggregate.

Fulfilment modes: `vendra_dispatch`, `carrier`, `vendor_managed`, `supplier_managed`.

Lifecycle:

```
created → allocated → picked_up → in_transit → out_for_delivery → delivered
   └ cancelled ┘                                     │  ▲
                                                     ▼  │
                                              delivery_failed → returning → returned
```

- An order has many seller orders, and a seller order has many shipments. Nothing assumes one shipment per order.
- Each status change appends to the shipment's history. A repeated carrier update for the current status is ignored.
- Each delivery attempt is recorded individually.
- Delivery prices come from `logistics` zone and rate tables at launch. A carrier adapter may return a live quote instead.
- The launch adapter is manual dispatch: staff allocate riders and update status from the admin portal.
