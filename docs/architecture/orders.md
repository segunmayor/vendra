# Orders

Built 12 Nov 2026 (Step 7). Staff cancellation added 14 Nov 2026.

## How an order is placed

1. The gateway confirms a payment. Payments records `PaymentSucceeded` (see [settings-and-payments.md](settings-and-payments.md)).
2. Checkout reacts: it commits the held stock as a sale, or flags a stock issue, then marks the session paid. **In the same transaction** it records `CheckoutPaid`.
3. The **orders** module reacts to `CheckoutPaid`. It reads the paid checkout through checkout's contract (`paidCheckout`) and places the order:
   - prices, delivery charge and address exactly as the customer agreed at checkout;
   - lines grouped into one `SellerOrder` per seller (at launch, only Vendra);
   - status `placed`, or `stock_issue` when the stock could not be secured;
   - a number from a database sequence (100001, 100002, …), short enough to read out on the phone.
4. `OrderPlaced` is recorded with the order, ready for notifications in a later step.

All of this runs while the API delivers events straight after verifying the payment. So by the time the customer's browser loads the return page, the order exists and the page shows its number.

Safeguards:
- **One order per checkout.** A unique index on `checkoutId` makes a repeated or concurrent delivery of `CheckoutPaid` harmless: the second attempt finds the first order.
- **Totals checked twice.** The order refuses lines whose total is not price × quantity, or totals that do not add up. Database checks enforce the same.
- **No order without a confirmed payment.** A payment of the wrong amount (`requires_review`) never marks the checkout paid, so no order is placed. It appears on the staff dashboard instead.

## Who sees what

- **Customers** see only their own orders, under **My account**: the list, each order, and a link from the "payment confirmed" page.
- **Staff with `orders.manage`** see **Admin → Orders**: filter by status, find by number, and open an order. The order page shows the items, totals, address, customer email, and a link to the payment for refunds (with `payments.read`).
- **Dashboard → Needs attention** counts orders to send, orders with a stock issue, and payments to review. Each count links to its list.

## Statuses

| Order | Meaning |
|---|---|
| `placed` | Paid, waiting to be sent |
| `stock_issue` | Paid, but an item sold out. Refund the customer from the payment page |
| `fulfilled` | Every seller order delivered. The sale is recognised in the ledger |
| `cancelled` | Staff cancelled it before anything left with a courier. Refund separately |

Each `SellerOrder` starts `pending` and follows its shipments (see [dispatch-and-tracking.md](dispatch-and-tracking.md)):

| Seller order | Set when a shipment is |
|---|---|
| `pending` | not yet collected, or cancelled or returned (the items are back with Vendra) |
| `dispatched` | collected, on the way, out for delivery, failed an attempt, or coming back |
| `delivered` | delivered. Final |

Orders apply these from `ShipmentStatusChanged` and only ever move forward, so a repeated or late event changes nothing. The only step back is to `pending` after a cancellation or return. When every seller order that is not cancelled is delivered, the order becomes `fulfilled` and records `OrderFulfilled`, once.

"To send" (admin list filter, dashboard tile, `toSend` on each order) means `placed` with at least one seller order still `pending`.

## Cancelling an order

Staff with `orders.manage` cancel from the order page, giving a reason. It is allowed while the order is `placed` or `stock_issue` and **no seller order has left with a courier** (all `pending`). Once a courier has collected the items, the order must be delivered or come back first; a delivered order is refunded from the payment instead.

1. The order and every seller order become `cancelled`, with who, when and why stored on the order and in the audit log. `OrderCancelled` is recorded in the same transaction. The request carries the order version the staff member saw, so a change they have not seen is never cancelled over (409).
2. **Inventory** reacts: stock the order took goes back on hand, with an `order_cancelled` stock movement. The reservations move from `committed` to `returned`, so a repeated event gives nothing back twice. A `stock_issue` order took no stock, so nothing changes.
3. **Shipping** reacts: a shipment still waiting for collection is cancelled. Marking a shipment collected is refused once its order is cancelled, which closes the gap before the reaction runs.
4. The API delivers these events before answering, so the page staff return to already shows the stock back.

Cancelling does **not** move money. Refunds need `orders.refund` and two-step sign-in, which not everyone who manages orders has. The order page shows how much of the payment has not been refunded, with a link to the payment page. The refund then posts against prepayments in the ledger, since no sale was recognised.

Customers see "Cancelled" and a note that they will be refunded. The staff reason is not shown to them. Customers cannot cancel orders themselves at launch.

## Not built yet

- Customer self-service cancellation.
- Customer notifications (email or SMS) on `OrderPlaced`.
- Orders are only placed for checkouts paid after this step. Checkouts paid before migration 0011 have no order. On a fresh server there are none.
