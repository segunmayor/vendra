import { Money } from '../../../shared-kernel';
import { Payment, ProviderVerification } from '../domain/payment';
import {
  InvalidWebhookSignature,
  PaymentProviderPort,
  PaymentRepository,
  WebhookInbox,
} from './ports';
import { ProcessPaymentWebhook } from './process-webhook';

const amount = Money.of(10_000n, 'NGN');
const body = new Uint8Array();

function setup() {
  const payment = Payment.initiate({ id: 'p1', orderId: 'o1', reference: 'ref1', provider: 'test', amount });
  const verification: ProviderVerification = { outcome: 'succeeded', amount, providerTransactionId: 'tx1' };
  const verify = jest.fn(async () => verification);
  const provider: PaymentProviderPort = {
    name: 'test',
    initialize: jest.fn(),
    refund: jest.fn(),
    verify,
    parseWebhook: (_raw, headers) => {
      if (headers['x-signature'] !== 'good') throw new InvalidWebhookSignature();
      return { eventId: 'e1', reference: headers['x-reference'] ?? 'ref1' };
    },
  };
  const save = jest.fn(async () => undefined);
  const payments: PaymentRepository = {
    findByReference: async (reference) => (reference === 'ref1' ? payment : null),
    save,
  };
  const done = new Set<string>();
  const inbox: WebhookInbox = {
    begin: async (_p, id) => !done.has(id),
    complete: async (_p, id) => void done.add(id),
  };
  const useCase = new ProcessPaymentWebhook(provider, payments, inbox, { now: () => new Date() });
  return { useCase, payment, verify, save };
}

const good = { 'x-signature': 'good' };

describe('ProcessPaymentWebhook', () => {
  it('rejects an invalid signature before doing anything', async () => {
    const { useCase, verify, save } = setup();
    await expect(useCase.execute(body, { 'x-signature': 'forged' })).rejects.toThrow(InvalidWebhookSignature);
    expect(verify).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('settles from the provider verification', async () => {
    const { useCase, payment, verify } = setup();
    await expect(useCase.execute(body, good)).resolves.toBe('processed');
    expect(verify).toHaveBeenCalledWith('ref1');
    expect(payment.snapshot.status).toBe('succeeded');
  });

  it('does not settle when the provider says the payment failed, whatever the webhook claimed', async () => {
    const { useCase, payment, verify } = setup();
    verify.mockResolvedValueOnce({ outcome: 'failed', amount, providerTransactionId: 'tx1' });
    await useCase.execute(body, good);
    expect(payment.snapshot.status).toBe('failed');
  });

  it('ignores a duplicate delivery', async () => {
    const { useCase, verify } = setup();
    await useCase.execute(body, good);
    await expect(useCase.execute(body, good)).resolves.toBe('duplicate');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('reprocesses a retry after a transient failure', async () => {
    const { useCase, payment, verify } = setup();
    verify.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(useCase.execute(body, good)).rejects.toThrow('provider timeout');
    await expect(useCase.execute(body, good)).resolves.toBe('processed');
    expect(payment.snapshot.status).toBe('succeeded');
  });

  it('reports an unknown payment without verifying', async () => {
    const { useCase, verify } = setup();
    await expect(useCase.execute(body, { ...good, 'x-reference': 'nope' })).resolves.toBe('unknown_payment');
    expect(verify).not.toHaveBeenCalled();
  });
});
