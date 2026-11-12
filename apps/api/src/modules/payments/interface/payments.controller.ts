import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, Public, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { ApplicationError, Principal } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { GATEWAY_TYPES, GatewayService, GatewayState } from '../application/gateways';
import { PaymentService } from '../application/payment.service';
import { InvalidWebhookSignature, ProviderUnavailable } from '../application/ports';

const uuid = new ZodPipe(z.uuid());
const reference = new ZodPipe(z.string().regex(/^[A-Za-z0-9]{6,40}$/));
const gatewaySchema = z.object({
  name: z.string().max(100),
  enabled: z.boolean(),
  mode: z.enum(['test', 'live']),
  position: z.number().int().min(0).max(100),
  config: z.record(z.string().max(40), z.string().max(500)).default({}),
  credentials: z.record(z.string().max(40), z.string().max(500)).default({}),
});
const createSchema = gatewaySchema.extend({ type: z.string().max(40) });
const startSchema = z.object({ gatewayId: z.uuid() });
const listSchema = z.object({ status: z.enum(['initiated', 'succeeded', 'failed', 'requires_review', 'partially_refunded', 'refunded']).optional() });

class FieldDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() help!: string;
  @ApiPropertyOptional() default?: string;
}

export class GatewayTypeResponse {
  @ApiProperty() type!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [FieldDto] }) credentials!: FieldDto[];
  @ApiProperty({ type: [FieldDto] }) config!: FieldDto[];
  @ApiProperty() webhookNote!: string;
}

export class GatewayResponse {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() name!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['test', 'live'] }) mode!: string;
  @ApiProperty() position!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) config!: Record<string, string>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Last 4 characters of each saved credential' })
  credentialHints!: Record<string, string>;
  @ApiProperty({ description: 'Enter this in the gateway dashboard' }) webhookUrl!: string;
}

export class GatewayDto {
  @ApiProperty() name!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['test', 'live'] }) mode!: 'test' | 'live';
  @ApiProperty() position!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) config!: Record<string, string>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Leave a field blank to keep the saved value' })
  credentials!: Record<string, string>;
}

export class CreateGatewayDto extends GatewayDto {
  @ApiProperty({ enum: GATEWAY_TYPES.map((entry) => entry.type) }) type!: string;
}

export class TestResultResponse {
  @ApiProperty() ok!: boolean;
  @ApiProperty() message!: string;
}

export class PaymentListItem {
  @ApiProperty() id!: string;
  @ApiProperty() reference!: string;
  @ApiProperty() checkoutId!: string;
  @ApiProperty() provider!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) gatewayId!: string | null;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: Date;
}

export class PaymentOptionResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() type!: string;
}

export class StartPaymentDto {
  @ApiProperty() gatewayId!: string;
}

export class StartedPaymentResponse {
  @ApiProperty() reference!: string;
  @ApiProperty({ description: 'Send the customer here to pay' }) redirectUrl!: string;
}

export class VerifyResponse {
  @ApiProperty({ enum: ['initiated', 'succeeded', 'failed', 'requires_review', 'partially_refunded', 'refunded'] }) status!: string;
  @ApiProperty() checkoutId!: string;
}

async function toResponse(gateway: GatewayState, settings: SettingsReader): Promise<GatewayResponse> {
  return {
    id: gateway.id,
    type: gateway.type,
    name: gateway.name,
    enabled: gateway.enabled,
    mode: gateway.mode,
    position: gateway.position,
    config: { ...gateway.config },
    credentialHints: { ...gateway.secretHints },
    webhookUrl: `${await settings.get('payments.apiUrl')}/v1/webhooks/payments/${gateway.id}`,
  };
}

@ApiTags('admin payments')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('settings.manage')
@Controller({ path: 'admin/payment-gateways', version: '1' })
export class GatewaysController {
  constructor(
    private readonly gateways: GatewayService,
    private readonly settings: SettingsReader,
  ) {}

  @Get('types')
  @ApiOperation({ operationId: 'adminListGatewayTypes' })
  @ApiOkResponse({ type: [GatewayTypeResponse] })
  types(): GatewayTypeResponse[] {
    return GATEWAY_TYPES.map((entry) => ({ ...entry, credentials: entry.credentials.map(({ key, label, help }) => ({ key, label, help })), config: [...entry.config] }));
  }

  @Get()
  @ApiOperation({ operationId: 'adminListGateways' })
  @ApiOkResponse({ type: [GatewayResponse] })
  async list(): Promise<GatewayResponse[]> {
    return Promise.all((await this.gateways.list()).map((gateway) => toResponse(gateway, this.settings)));
  }

  @Post()
  @ApiOperation({ operationId: 'adminCreateGateway' })
  @ApiCreatedResponse({ type: GatewayResponse })
  async create(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(createSchema)) body: CreateGatewayDto): Promise<GatewayResponse> {
    const { type, ...input } = body;
    return toResponse(await this.gateways.create(actor, type, input), this.settings);
  }

  @Put(':id')
  @ApiOperation({ operationId: 'adminUpdateGateway' })
  @ApiOkResponse({ type: GatewayResponse })
  async update(@CurrentPrincipal() actor: Principal, @Param('id', uuid) id: string, @Body(new ZodPipe(gatewaySchema)) body: GatewayDto): Promise<GatewayResponse> {
    return toResponse(await this.gateways.update(actor, id, body), this.settings);
  }

  @Post(':id/test')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminTestGateway', summary: 'Checks the saved credentials with the gateway' })
  @ApiOkResponse({ type: TestResultResponse })
  async test(@Param('id', uuid) id: string): Promise<TestResultResponse> {
    try {
      await this.gateways.test(id);
      return { ok: true, message: 'Connected. The gateway accepted these credentials.' };
    } catch (error) {
      if (error instanceof ProviderUnavailable) return { ok: false, message: error.message };
      throw error;
    }
  }
}

@ApiTags('admin payments')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('payments.read')
@Controller({ path: 'admin/payments', version: '1' })
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListPayments' })
  @ApiQuery({ name: 'status', required: false, enum: ['initiated', 'succeeded', 'failed', 'requires_review', 'partially_refunded', 'refunded'] })
  @ApiOkResponse({ type: [PaymentListItem] })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>): Promise<PaymentListItem[]> {
    return (await this.payments.recent(query.status)).map((row) => ({ ...row, amountMinor: row.amountMinor.toString() }));
  }
}

@ApiTags('store payments')
@ApiBearerAuth()
@Surface('store')
@Controller({ path: 'store', version: '1' })
export class StorePaymentsController {
  constructor(private readonly payments: PaymentService) {}

  @Get('payment-options')
  @ApiOperation({ operationId: 'storePaymentOptions' })
  @ApiOkResponse({ type: [PaymentOptionResponse] })
  options(): Promise<PaymentOptionResponse[]> {
    return this.payments.options();
  }

  @Post('checkout/:id/payments')
  @ApiOperation({ operationId: 'storeStartPayment', summary: 'Starts payment for an open checkout. Repeating it reuses the same payment.' })
  @ApiCreatedResponse({ type: StartedPaymentResponse })
  start(@CurrentPrincipal() principal: Principal, @Param('id', uuid) checkoutId: string, @Body(new ZodPipe(startSchema)) body: StartPaymentDto): Promise<StartedPaymentResponse> {
    return this.payments.start(principal, checkoutId, body.gatewayId);
  }

  @Post('payments/:reference/verify')
  @HttpCode(200)
  @ApiOperation({ operationId: 'storeVerifyPayment', summary: 'Asks the gateway for the payment result. Call on return from the gateway.' })
  @ApiOkResponse({ type: VerifyResponse })
  verify(@CurrentPrincipal() principal: Principal, @Param('reference', reference) ref: string): Promise<VerifyResponse> {
    return this.payments.verify(principal, ref);
  }
}

/** One address per configured gateway, shown in the admin portal for pasting into the gateway's dashboard. */
@Public()
@Controller({ path: 'webhooks/payments', version: '1' })
export class WebhooksController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':gatewayId')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(@Param('gatewayId', uuid) gatewayId: string, @Req() request: Request & { rawBody?: Buffer }): Promise<{ received: true }> {
    if (!request.rawBody) throw new ApplicationError('unauthenticated', 'webhook.no_body', 'Missing body');
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] ?? '' : value ?? '']));
    try {
      await this.payments.webhook(gatewayId, request.rawBody, headers);
    } catch (error) {
      if (error instanceof InvalidWebhookSignature) throw new ApplicationError('unauthenticated', 'webhook.invalid_signature', 'Invalid signature');
      throw error;
    }
    return { received: true };
  }
}
