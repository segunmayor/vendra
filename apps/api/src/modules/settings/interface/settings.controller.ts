import { Body, Controller, Get, Header, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, Public, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { ApplicationError, Principal } from '../../../shared-kernel';
import { SettingsService, UnknownSetting } from '../application/settings';

const updateSchema = z.object({ values: z.record(z.string().max(80), z.union([z.string().max(2000), z.number(), z.boolean()])) });

class SettingResponse {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['integer', 'decimal', 'text', 'longtext', 'email', 'phone', 'url', 'boolean'] }) kind!: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] }) value!: string | number | boolean;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] }) defaultValue!: string | number | boolean;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() public!: boolean;
  @ApiPropertyOptional() min?: number;
  @ApiPropertyOptional() max?: number;
  @ApiPropertyOptional() step?: number;
  @ApiPropertyOptional() maxLength?: number;
  @ApiPropertyOptional() unit?: string;
  @ApiPropertyOptional() optional?: boolean;
}

export class SettingGroupResponse {
  @ApiProperty() group!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [SettingResponse] }) settings!: SettingResponse[];
}

export class UpdateSettingsDto {
  @ApiProperty({ type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] }, example: { 'shopping.holdMinutes': 20 } })
  values!: Record<string, string | number | boolean>;
}

export class PublicSettingsResponse {
  @ApiProperty({ type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } })
  values!: Record<string, string | number | boolean>;
}

@ApiTags('admin settings')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('settings.manage')
@Controller({ path: 'admin/settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListSettings' })
  @ApiOkResponse({ type: [SettingGroupResponse] })
  async list(): Promise<SettingGroupResponse[]> {
    return (await this.settings.list()).map((group) => ({
      group: group.group,
      label: group.label,
      description: group.description,
      settings: group.settings.map(({ key, definition, value, isDefault }) => ({
        key,
        label: definition.label,
        description: definition.description,
        kind: definition.kind,
        value,
        defaultValue: definition.default,
        isDefault,
        public: 'public' in definition && definition.public === true,
        ...('min' in definition ? { min: definition.min, max: definition.max } : {}),
        ...('step' in definition ? { step: definition.step } : {}),
        ...('maxLength' in definition ? { maxLength: definition.maxLength } : {}),
        ...('unit' in definition && definition.unit ? { unit: definition.unit } : {}),
        ...('optional' in definition ? { optional: definition.optional } : {}),
      })),
    }));
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ operationId: 'adminUpdateSettings', summary: 'Changes several settings at once. All are validated before any is saved.' })
  async update(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(updateSchema)) body: UpdateSettingsDto): Promise<void> {
    try {
      await this.settings.update(actor, body.values);
    } catch (error) {
      if (error instanceof UnknownSetting) throw new ApplicationError('not_found', 'settings.unknown', error.message);
      throw error;
    }
  }
}

/** Store name, headline, support contacts and similar, for the customer portal. */
@ApiTags('store settings')
@Public()
@Controller({ path: 'store/settings', version: '1' })
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ operationId: 'storePublicSettings' })
  @ApiOkResponse({ type: PublicSettingsResponse })
  async values(): Promise<PublicSettingsResponse> {
    return { values: await this.settings.publicValues() };
  }
}
