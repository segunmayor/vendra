# Orders

Built 12 Nov 2026 (Step 7).

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
| `cancelled`, `fulfilled` | Reserved for staff cancellation and delivery (later steps) |

Each `SellerOrder` starts `pending`. `dispatched` and `delivered` come with Step 8 (dispatch and tracking).

## Not built yet

- Cancelling an order, which would return stock and refund in one step.
- Customer notifications (email or SMS) on `OrderPlaced`.
- Orders are only placed for checkouts paid after this step. Checkouts paid before migration 0011 have no order. On a fresh server there are none.
