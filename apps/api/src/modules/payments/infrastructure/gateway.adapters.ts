import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { ApplicationError, AuditEntry, ConcurrencyConflict } from '../../../shared-kernel';
import type { GatewayMode, GatewayRepository, GatewayState, ProviderFactory, SecretSealer } from '../application/gateways';
import type { PaymentProviderPort } from '../application/ports';
import { FlutterwaveProvider } from './flutterwave.provider';
import { PaystackProvider } from './paystack.provider';

type Row = Prisma.PaymentGatewayGetPayload<object>;

const toState = (row: Row): GatewayState => ({
  id: row.id,
  type: row.type,
  name: row.name,
  enabled: row.enabled,
  mode: row.mode as GatewayMode,
  position: row.position,
  config: row.config as Record<string, string>,
  secretHints: row.secretHints as Record<string, string>,
  version: row.version,
});

export class PrismaGatewayRepository implements GatewayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<GatewayState[]> {
    return (await this.prisma.paymentGateway.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] })).map(toState);
  }

  async find(id: string): Promise<GatewayState | null> {
    const row = await this.prisma.paymentGateway.findUnique({ where: { id } });
    return row ? toState(row) : null;
  }

  async sealedSecrets(id: string): Promise<string | null> {
    return (await this.prisma.paymentGateway.findUnique({ where: { id }, select: { secrets: true } }))?.secrets ?? null;
  }

  async save(state: GatewayState, sealedSecrets: string | null, isNew: boolean, audit: AuditEntry): Promise<void> {
    const data = {
      type: state.type,
      name: state.name.trim(),
      enabled: state.enabled,
      mode: state.mode,
      position: state.position,
      config: state.config as Prisma.InputJsonValue,
      secrets: sealedSecrets,
      secretHints: state.secretHints as Prisma.InputJsonValue,
    };
    await this.prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.paymentGateway.create({ data: { id: state.id, ...data, version: 1 } });
      } else {
        const { count } = await tx.paymentGateway.updateMany({ where: { id: state.id, version: state.version }, data: { ...data, version: { increment: 1 } } });
        if (count !== 1) throw new ConcurrencyConflict('PaymentGateway', state.id);
      }
      await appendAudit(tx, audit);
    });
  }
}

/** Without SETTINGS_ENCRYPTION_KEY, credentials cannot be saved or read; everything else still works. */
export class GatewayProviderFactory implements ProviderFactory {
  create(type: string, config: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): PaymentProviderPort {
    switch (type) {
      case 'paystack':
        return new PaystackProvider(config.apiBaseUrl!, secrets.secretKey!);
      case 'flutterwave':
        return new FlutterwaveProvider(config.apiBaseUrl!, secrets.secretKey!, secrets.webhookHash!);
      default:
        throw new Error(`No adapter for gateway type ${type}`);
    }
  }
}
