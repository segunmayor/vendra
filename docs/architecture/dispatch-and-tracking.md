# Dispatch and tracking

Built 13 Nov 2026 (Step 8). Launch uses **manual dispatch**: staff arrange the courier or rider and record each step in Admin. A carrier adapter can replace `ManualDispatchAdapter` later without touching the `Shipment` aggregate.

## Sending an order

1. **Admin → Orders → To send** lists paid orders with items still at Vendra.
2. On the order page, **Delivery → Hand to courier**: the courier or rider's name, and the courier's tracking number. Leave the number blank and Vendra issues one (`MD-…`).
3. Shipping asks orders whether the items can be sent (`assertShippable`): only a `placed` order, and only a seller order still `pending`. An order with a stock issue cannot be sent.
4. One shipment is created with every item of the seller order, status `allocated` (with the courier, waiting for collection).
5. Staff press the next step as news comes in. Each button shows only where the shipment can go next:

```
allocated → picked_up → in_transit → out_for_delivery → delivered
   └ cancelled                              │  ▲
                                            ▼  │
                                     delivery_failed → returning → returned
```

A failed attempt needs a reason. Each attempt is recorded and numbered.

**Admin → Deliveries** lists parcels still on their way, least recently updated first, filterable by status. The dashboard counts **Failed deliveries** for follow-up.

## What follows from each step

Every step records `ShipmentStatusChanged` in the same transaction, and the API delivers it at once:

- **orders** moves the seller order along (see [orders.md](orders.md)). Delivery of everything fulfils the order.
- **ledger** reacts to `OrderFulfilled`: debit customer prepayments with the total paid, credit sales with the item prices and delivery charges with the delivery fee. One entry per order, however often the event arrives. The three accounts are settings (**Settings → Payments and accounting**); defaults 2100, 4000, 4100.

## Safeguards

- **Sent once at a time.** A partial unique index allows one shipment per seller order that is not cancelled or returned. Two staff pressing send together get one shipment and one "already on its way" message.
- **Tracking numbers unique per courier.**
- **No change on top of an unseen one.** Each step carries the version the staff member was looking at. If someone else moved the shipment since, the change is refused with "reload".
- **Same button twice is harmless.**
- **Audited.** Every send and step is in the audit log with who did it.
- **Customers see progress, not notes.** `GET /v1/store/orders/{id}/shipments` returns status, courier, tracking number and the time of each step, for the customer's own order only. Staff notes and failure reasons stay in Admin.

## Permissions

- `shipments.manage`: send, record steps, see Deliveries.
- `orders.manage`: see an order's shipments on its page (read-only without `shipments.manage`).

## Not built yet

- Splitting one seller order across several parcels sent at the same time. The data model allows many shipments per seller order. Only the "one open at a time" index would need to become a per-item check.
- Customer notifications (email or SMS) on each step: no provider chosen yet.
- A live carrier integration (quotes, booking, tracking feed).
