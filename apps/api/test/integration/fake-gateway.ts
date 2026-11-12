import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What a transaction looks like at the fake gateway, keyed by our reference. */
export interface FakeTransaction {
  status: string;
  /** Paystack: integer kobo. Flutterwave: major units, as the real APIs return them. */
  amount: number;
  currency: string;
  id: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string;
  body: Record<string, unknown> | null;
}

/**
 * A local stand-in for Paystack and Flutterwave, shaped after their documented APIs, so the
 * whole payment flow runs in tests without network access or real keys.
 */
export class FakeGateway {
  readonly requests: RecordedRequest[] = [];
  readonly transactions = new Map<string, FakeTransaction>();
  acceptedKeys = new Set<string>();
  failNext = false;
  private server!: Server;
  base = '';

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request).then(([status, body]) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    }));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  calls(path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.path.startsWith(path));
  }

  private async handle(request: IncomingMessage): Promise<[number, unknown]> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const url = new URL(request.url ?? '/', 'http://fake');
    const authorization = String(request.headers.authorization ?? '');
    this.requests.push({ method: request.method ?? 'GET', path: url.pathname, authorization, body: text ? (JSON.parse(text) as Record<string, unknown>) : null });

    if (this.failNext) {
      this.failNext = false;
      return [500, { status: false, message: 'Internal error' }];
    }
    if (!this.acceptedKeys.has(authorization.replace(/^Bearer /, ''))) return [401, { status: false, message: 'Invalid key' }];
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    // Paystack
    if (url.pathname === '/paystack/transaction/initialize') {
      return [200, { status: true, message: 'Authorization URL created', data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: 'ac', reference: body.reference } }];
    }
    if (url.pathname.startsWith('/paystack/transaction/verify/')) {
      const reference = decodeURIComponent(url.pathname.split('/').pop()!);
      const tx = this.transactions.get(reference);
      if (!tx) return [200, { status: true, data: { status: 'abandoned', reference } }];
      return [200, { status: true, data: { id: tx.id, status: tx.status, amount: tx.amount, currency: tx.currency, reference } }];
    }
    if (url.pathname === '/paystack/balance') return [200, { status: true, data: [] }];

    // Flutterwave
    if (url.pathname === '/flutterwave/payments') {
      return [200, { status: 'success', message: 'Hosted Link', data: { link: `https://checkout.flutterwave.com/v3/hosted/pay/${body.tx_ref}` } }];
    }
    if (url.pathname === '/flutterwave/transactions/verify_by_reference') {
      const reference = url.searchParams.get('tx_ref') ?? '';
      const tx = this.transactions.get(reference);
      if (!tx) return [400, { status: 'error', message: 'No transaction was found for this id', data: null }];
      return [200, { status: 'success', data: { id: tx.id, tx_ref: reference, status: tx.status, amount: tx.amount, currency: tx.currency } }];
    }
    if (url.pathname === '/flutterwave/balances') return [200, { status: 'success', data: [] }];
    return [404, { status: false, message: 'Not found' }];
  }
}
