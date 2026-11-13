import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ProcessPaymentWebhook } from '../../src/modules/payments/application/process-webhook';
import { PaymentProviderPort } from '../../src/modules/payments/application/ports';
import { Payment, ProviderVerification } from '../../src/modules/payments/domain/payment';
import { PrismaPaymentRepository } from '../../src/modules/payments/infrastructure/prisma-payment.repository';
import { PrismaWebhookInbox } from '../../src/modules/payments/infrastructure/prisma-webhook-inbox';
import { JournalEntry } from '../../src/modules/ledger/domain/journal-entry';
import { PrismaJournalRepository } from '../../src/modules/ledger/infrastructure/prisma-journal.repository';
import { Shipment } from '../../src/modules/shipping/domain/shipment';
import { PrismaShipmentRepository } from '../../src/modules/shipping/infrastructure/prisma-shipment.repository';
import * as outbox from '../../src/platform/outbox/outbox';
import { OutboxHandler, OutboxRelay } from '../../src/platform/outbox/outbox-relay';
import { ConcurrencyConflict, Money } from '../../src/shared-kernel';

// Rows use random IDs and are left in place, because ledger tables cannot be deleted from.
const prisma = new PrismaClient();
const now = new Date('2026-11-11T10:00:00Z');
const ngn = (minor: bigint) => Money.of(minor, 'NGN');

const newPayment = (amount = ngn(10_000n)) =>
  Payment.initiate({
    id: randomUUID(),
    checkoutId: randomUUID(),
    reference: `ref_${randomUUID()}`,
    provider: 'test',
    amount,
  });
const success = (amount = ngn(10_000n)): ProviderVerification => ({
  outcome: 'succeeded',
  amount,
  providerTransactionId: `tx_${randomUUID()}`,
});
const eventTypes = async (aggregateId: string) =>
  (await prisma.outboxEvent.findMany({ where: { aggregateId } })).map((event) => event.type);

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
});

afterAll(async () => {
  // These payments belong to no real checkout. Mark their events delivered so other suites'
  // reactions (which would rightly fail on a missing checkout) never pick them up.
  await prisma.outboxEvent.updateMany({
    where: { publishedAt: null, type: { startsWith: 'Payment' }, occurredAt: new Date('2026-11-11T10:00:00Z') },
    data: { publishedAt: new Date() },
  });
  await prisma.$disconnect();
});

describe('PrismaPaymentRepository', () => {
  const repo = new PrismaPaymentRepository(prisma);

  it('round-trips amounts beyond float precision', async () => {
    const payment = newPayment(ngn(9_007_199_254_740_993n));
    await repo.save(payment);
    const loaded = await repo.findByReference(payment.snapshot.reference);
    expect(loaded?.snapshot.amount.minor).toBe(9_007_199_254_740_993n);
    expect(loaded?.snapshot.version).toBe(1);
  });

  it('commits state and its event together', async () => {
    const payment = newPayment();
    await repo.save(payment);
    payment.applyVerification(success(), now);
    await repo.save(payment);
    expect((await repo.findByReference(payment.snapshot.reference))?.snapshot.status).toBe('succeeded');
    expect(await eventTypes(payment.snapshot.id)).toEqual(['PaymentSucceeded']);
  });

  it('allows saving the same instance repeatedly', async () => {
    const payment = newPayment();
    await repo.save(payment);
    await repo.save(payment);
    await repo.save(payment);
    expect((await repo.findByReference(payment.snapshot.reference))?.snapshot.version).toBe(3);
  });

  it('rejects a stale write and records no event', async () => {
    const payment = newPayment();
    await repo.save(payment);
    const first = (await repo.findByReference(payment.snapshot.reference))!;
    const stale = (await repo.findByReference(payment.snapshot.reference))!;
    first.applyVerification(success(), now);
    await repo.save(first);
    stale.applyVerification({ ...success(), outcome: 'failed' }, now);
    await expect(repo.save(stale)).rejects.toThrow(ConcurrencyConflict);
    expect(await eventTypes(payment.snapshot.id)).toEqual(['PaymentSucceeded']);
  });

  it('lets exactly one of two concurrent writers win', async () => {
    const payment = newPayment();
    await repo.save(payment);
    const writers = await Promise.all([
      repo.findByReference(payment.snapshot.reference),
      repo.findByReference(payment.snapshot.reference),
    ]);
    const results = await Promise.allSettled(
      writers.map((writer) => {
        writer!.applyVerification(success(), now);
        return repo.save(writer!);
      }),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await eventTypes(payment.snapshot.id)).toEqual(['PaymentSucceeded']);
  });

  it('rolls back the event when the state cannot be written', async () => {
    const original = newPayment();
    await repo.save(original);
    const clash = Payment.initiate({
      id: randomUUID(),
      checkoutId: randomUUID(),
      reference: original.snapshot.reference,
      provider: 'test',
      amount: ngn(10_000n),
    });
    clash.applyVerification(success(), now);
    await expect(repo.save(clash)).rejects.toThrow();
    expect(await eventTypes(clash.snapshot.id)).toEqual([]);
  });
});

describe('atomicity of state and events', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes payment events on the transaction, not the shared client', async () => {
    const append = jest.spyOn(outbox, 'appendToOutbox');
    await new PrismaPaymentRepository(prisma).save(newPayment());
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).not.toBe(prisma);
  });

  it('writes shipment events on the transaction, not the shared client', async () => {
    const append = jest.spyOn(outbox, 'appendToOutbox');
    await new PrismaShipmentRepository(prisma).save(
      Shipment.create({
        id: randomUUID(),
        sellerOrderId: randomUUID(),
        mode: 'carrier',
        provider: 'test',
        items: [{ orderLineId: randomUUID(), quantity: 1 }],
        now,
      }),
    );
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).not.toBe(prisma);
  });

  it('does not persist the payment when its event cannot be written', async () => {
    const repo = new PrismaPaymentRepository(prisma);
    const payment = newPayment();
    jest
      .spyOn(payment, 'pullEvents')
      .mockReturnValue([{ type: 'Broken', aggregateId: 'not-a-uuid', occurredAt: now, payload: {} }]);
    await expect(repo.save(payment)).rejects.toThrow();
    await expect(repo.findByReference(payment.snapshot.reference)).resolves.toBeNull();
  });
});

describe('ProcessPaymentWebhook against the database', () => {
  async function setup() {
    const repo = new PrismaPaymentRepository(prisma);
    const payment = newPayment();
    await repo.save(payment);
    const reference = payment.snapshot.reference;
    const eventId = randomUUID();
    const verification = success();
    const verify = jest.fn(async () => verification);
    const provider: PaymentProviderPort = {
      name: 'test',
      initialize: jest.fn(),
      refund: jest.fn(),
      refundStatus: jest.fn(),
    testConnection: jest.fn(),
      verify,
      parseWebhook: () => ({ eventId, reference }),
    };
    const useCase = new ProcessPaymentWebhook(provider, repo, new PrismaWebhookInbox(prisma), {
      now: () => now,
    });
    return { useCase, verify, payment, repo, reference };
  }
  const body = new Uint8Array();

  it('settles once across duplicate deliveries', async () => {
    const { useCase, verify, payment, repo, reference } = await setup();
    await expect(useCase.execute(body, {})).resolves.toBe('processed');
    await expect(useCase.execute(body, {})).resolves.toBe('duplicate');
    expect(verify).toHaveBeenCalledTimes(1);
    expect((await repo.findByReference(reference))?.snapshot.status).toBe('succeeded');
    expect(await eventTypes(payment.snapshot.id)).toEqual(['PaymentSucceeded']);
  });

  it('settles on retry after a transient failure', async () => {
    const { useCase, verify, payment, repo, reference } = await setup();
    verify.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(useCase.execute(body, {})).rejects.toThrow('provider timeout');
    expect((await repo.findByReference(reference))?.snapshot.status).toBe('initiated');
    await expect(useCase.execute(body, {})).resolves.toBe('processed');
    expect(await eventTypes(payment.snapshot.id)).toEqual(['PaymentSucceeded']);
  });

  it('emits one success when the same event arrives concurrently', async () => {
    const { useCase, payment, repo, reference } = await setup();
    await Promise.allSettled([useCase.execute(body, {}), useCase.execute(body, {})]);
    expect((await repo.findByReference(reference))?.snapshot.status).toBe('succeeded');
    expect(await eventTypes(payment.snapshot.id)).toEqual(['PaymentSucceeded']);
  });
});

describe('PrismaJournalRepository', () => {
  const repo = new PrismaJournalRepository(prisma);
  const entry = (sourceId: string) =>
    JournalEntry.post({
      id: randomUUID(),
      sourceType: 'test_payment',
      sourceId,
      postedAt: now,
      lines: [
        { accountCode: 'test_cash', side: 'debit', amount: ngn(100n) },
        { accountCode: 'test_revenue', side: 'credit', amount: ngn(100n) },
      ],
    });

  beforeAll(async () => {
    for (const code of ['test_cash', 'test_revenue']) {
      await prisma.ledgerAccount.upsert({ where: { code }, create: { code, name: code, type: 'test' }, update: {} });
    }
  });

  it('posts an entry with its lines', async () => {
    const posted = entry(randomUUID());
    await expect(repo.append(posted)).resolves.toBe('posted');
    await expect(prisma.journalLine.count({ where: { entryId: posted.id } })).resolves.toBe(2);
  });

  it('reports a duplicate source and writes nothing more', async () => {
    const sourceId = randomUUID();
    await repo.append(entry(sourceId));
    const second = entry(sourceId);
    await expect(repo.append(second)).resolves.toBe('duplicate');
    await expect(prisma.journalLine.count({ where: { entryId: second.id } })).resolves.toBe(0);
  });

  it('cannot be edited, even directly', async () => {
    const posted = entry(randomUUID());
    await repo.append(posted);
    await expect(
      prisma.journalLine.updateMany({ where: { entryId: posted.id }, data: { amountMinor: 1n } }),
    ).rejects.toThrow('append-only');
  });
});

describe('PrismaShipmentRepository', () => {
  const repo = new PrismaShipmentRepository(prisma);
  const newShipment = (sellerOrderId: string = randomUUID()) =>
    Shipment.create({
      id: randomUUID(),
      sellerOrderId,
      mode: 'vendra_dispatch',
      provider: 'manual_dispatch',
      items: [{ orderLineId: randomUUID(), quantity: 2 }],
      now,
    });

  it('round-trips the lifecycle across several saves, keeping history order', async () => {
    const created = newShipment();
    created.assignTracking(`MD-${created.id}`);
    await repo.save(created);

    let shipment = (await repo.findById(created.id))!;
    for (const status of ['allocated', 'picked_up', 'in_transit', 'out_for_delivery'] as const) {
      shipment.transitionTo(status, now);
    }
    shipment.recordDeliveryAttempt(false, now, 'Customer unavailable');
    await repo.save(shipment);

    shipment = (await repo.findById(created.id))!;
    shipment.transitionTo('out_for_delivery', now);
    shipment.recordDeliveryAttempt(true, now);
    await repo.save(shipment);

    const loaded = (await repo.findById(created.id))!;
    expect(loaded.currentStatus).toBe('delivered');
    expect(loaded.trackingReference).toBe(`MD-${created.id}`);
    expect(loaded.items[0]?.quantity).toBe(2);
    expect(loaded.history.map((h) => h.status)).toEqual([
      'created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery',
      'delivery_failed', 'out_for_delivery', 'delivered',
    ]);
    expect(loaded.deliveryAttempts.map((a) => [a.attemptNumber, a.successful])).toEqual([[1, false], [2, true]]);
  });

  it('stores several shipments for one seller order, one on its way at a time', async () => {
    const sellerOrderId = randomUUID();
    const first = newShipment(sellerOrderId);
    await repo.save(first);
    await expect(repo.save(newShipment(sellerOrderId))).rejects.toThrow('already have a shipment');
    first.transitionTo('cancelled', now);
    await repo.save(first);
    await repo.save(newShipment(sellerOrderId));
    await expect(prisma.shipment.count({ where: { sellerOrderId } })).resolves.toBe(2);
  });

  it('rejects a stale write without adding history', async () => {
    const created = newShipment();
    await repo.save(created);
    const first = (await repo.findById(created.id))!;
    const stale = (await repo.findById(created.id))!;
    first.transitionTo('allocated', now);
    await repo.save(first);
    stale.transitionTo('cancelled', now);
    await expect(repo.save(stale)).rejects.toThrow(ConcurrencyConflict);
    const loaded = (await repo.findById(created.id))!;
    expect(loaded.history.map((h) => h.status)).toEqual(['created', 'allocated']);
  });
});

describe('OutboxRelay', () => {
  const addEvent = async (type: string) => {
    const aggregateId = randomUUID();
    await prisma.outboxEvent.create({ data: { type, aggregateId, payload: {}, occurredAt: now } });
    return aggregateId;
  };
  const row = async (aggregateId: string) => prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId } });
  const uniqueType = () => `Test.${randomUUID()}`;

  it('delivers and marks an event published, and does not deliver it again', async () => {
    const type = uniqueType();
    const id = await addEvent(type);
    const handler = jest.fn<ReturnType<OutboxHandler>, Parameters<OutboxHandler>>(async () => undefined);
    const relay = new OutboxRelay(prisma, { [type]: [handler] });
    await expect(relay.runOnce()).resolves.toEqual({ published: 1, failed: 0 });
    await expect(relay.runOnce()).resolves.toEqual({ published: 0, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await row(id)).publishedAt).not.toBeNull();
  });

  it('keeps a failed event for retry, and processes the others', async () => {
    const badType = uniqueType();
    const goodType = uniqueType();
    const bad = await addEvent(badType);
    const good = await addEvent(goodType);
    const failing = jest
      .fn<ReturnType<OutboxHandler>, Parameters<OutboxHandler>>()
      .mockRejectedValueOnce(new Error('consumer down'))
      .mockResolvedValue(undefined);
    const relay = new OutboxRelay(prisma, { [badType]: [failing], [goodType]: [async () => undefined] });

    await expect(relay.runOnce()).resolves.toEqual({ published: 1, failed: 1 });
    expect((await row(bad)).publishedAt).toBeNull();
    expect((await row(bad)).attempts).toBe(1);
    expect((await row(bad)).lastError).toBe('consumer down');
    expect((await row(good)).publishedAt).not.toBeNull();

    await expect(relay.runOnce()).resolves.toEqual({ published: 1, failed: 0 });
    expect((await row(bad)).publishedAt).not.toBeNull();
  });

  it('stops retrying after the maximum attempts', async () => {
    const type = uniqueType();
    const id = await addEvent(type);
    await prisma.outboxEvent.updateMany({ where: { aggregateId: id }, data: { attempts: 10 } });
    const handler = jest.fn<ReturnType<OutboxHandler>, Parameters<OutboxHandler>>(async () => undefined);
    await expect(new OutboxRelay(prisma, { [type]: [handler] }).runOnce()).resolves.toEqual({ published: 0, failed: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves event types with no consumer unpublished', async () => {
    const id = await addEvent(uniqueType());
    await new OutboxRelay(prisma, { [uniqueType()]: [async () => undefined] }).runOnce();
    expect((await row(id)).publishedAt).toBeNull();
  });

  it('delivers each event once across concurrent relays', async () => {
    const type = uniqueType();
    for (let i = 0; i < 12; i += 1) await addEvent(type);
    const handler = jest.fn<ReturnType<OutboxHandler>, Parameters<OutboxHandler>>(async () => undefined);
    const relays = [1, 2, 3].map(() => new OutboxRelay(prisma, { [type]: [handler] }));
    const results = await Promise.all(relays.map((relay) => relay.runOnce()));
    expect(results.reduce((sum, r) => sum + r.published, 0)).toBe(12);
    expect(handler).toHaveBeenCalledTimes(12);
    expect(new Set(handler.mock.calls.map(([message]) => message.id)).size).toBe(12);
  });
});
