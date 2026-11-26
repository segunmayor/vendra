import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { LocationView, StorageLocationService } from '../application/locations';
import { LocationState } from '../application/ports';

const id = new ZodPipe(z.uuid());
const values = z.record(z.string().max(64), z.string().max(2000));
const inputSchema = z.object({ name: z.string().max(100), config: values.default({}), credentials: values.default({}) });
const createSchema = inputSchema.extend({ type: z.string().max(40) });

class FieldSpecResponse {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() help!: string;
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional() default?: string;
  @ApiPropertyOptional() placeholder?: string;
  @ApiPropertyOptional({ enum: ['text', 'url', 'boolean', 'email'] }) kind?: string;
}

export class StorageTypeResponse {
  @ApiProperty() type!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [FieldSpecResponse] }) config!: FieldSpecResponse[];
  @ApiProperty({ type: [FieldSpecResponse], description: 'Never returned once saved; see secretHints' }) credentials!: FieldSpecResponse[];
}

class CheckResponse {
  @ApiProperty() at!: Date;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) message!: string | null;
}

class UsageResponse {
  @ApiProperty() files!: number;
  @ApiProperty() bytes!: number;
}

export class StorageLocationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) config!: Record<string, string>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Last four characters of each saved credential' })
  secretHints!: Record<string, string>;
  @ApiProperty() active!: boolean;
  @ApiPropertyOptional({ type: CheckResponse, nullable: true }) lastCheck!: CheckResponse | null;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: UsageResponse }) usage?: UsageResponse;
}

export class StorageOverviewResponse {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Null while new files are kept in the database' }) activeId!: string | null;
  @ApiProperty({ type: [StorageLocationResponse] }) locations!: StorageLocationResponse[];
}

class LocationInputDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) config!: Record<string, string>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Blank or missing fields keep the saved value' })
  credentials!: Record<string, string>;
}

class CreateLocationDto extends LocationInputDto {
  @ApiProperty() type!: string;
}

const view = (location: LocationState | LocationView): StorageLocationResponse => ({
  ...location,
  config: { ...location.config },
  secretHints: { ...location.secretHints },
  lastCheck: location.lastCheck ? { ...location.lastCheck } : null,
});

/** Where uploaded files are kept: this server's database, or a storage service staff configure. */
@ApiTags('admin storage')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('settings.manage')
@Controller({ path: 'admin/storage', version: '1' })
export class StorageController {
  constructor(private readonly storage: StorageLocationService) {}

  @Get('types')
  @ApiOperation({ operationId: 'adminStorageTypes', summary: 'The storage services Vendra can use, and the settings each needs' })
  @ApiOkResponse({ type: [StorageTypeResponse] })
  types(): StorageTypeResponse[] {
    return this.storage.types().map(({ driver: _driver, ...type }) => ({ ...type, config: [...type.config], credentials: [...type.credentials] }));
  }

  @Get('locations')
  @ApiOperation({ operationId: 'adminStorageOverview' })
  @ApiOkResponse({ type: StorageOverviewResponse })
  async overview(): Promise<StorageOverviewResponse> {
    const overview = await this.storage.overview();
    return { activeId: overview.activeId, locations: overview.locations.map(view) };
  }

  @Post('locations')
  @ApiOperation({ operationId: 'adminCreateStorageLocation', summary: 'Adds a location. It is not used until it is made active.' })
  @ApiCreatedResponse({ type: StorageLocationResponse })
  async create(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(createSchema)) body: CreateLocationDto): Promise<StorageLocationResponse> {
    return view(await this.storage.create(actor, body.type, body));
  }

  @Get('locations/:id')
  @ApiOperation({ operationId: 'adminGetStorageLocation' })
  @ApiOkResponse({ type: StorageLocationResponse })
  async get(@Param('id', id) locationId: string): Promise<StorageLocationResponse> {
    return view(await this.storage.get(locationId));
  }

  @Put('locations/:id')
  @ApiOperation({ operationId: 'adminUpdateStorageLocation', summary: 'For the active location, the new settings must pass a check first' })
  @ApiOkResponse({ type: StorageLocationResponse })
  async update(@CurrentPrincipal() actor: Principal, @Param('id', id) locationId: string, @Body(new ZodPipe(inputSchema)) body: LocationInputDto): Promise<StorageLocationResponse> {
    return view(await this.storage.update(actor, locationId, body));
  }

  @Post('locations/:id/test')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminTestStorageLocation', summary: 'Writes, reads back and deletes a small file. The outcome is in lastCheck.' })
  @ApiOkResponse({ type: StorageLocationResponse })
  async test(@Param('id', id) locationId: string): Promise<StorageLocationResponse> {
    return view(await this.storage.test(locationId));
  }

  @Post('locations/:id/activate')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminActivateStorageLocation', summary: 'New files go here from now on. Must pass a check first.' })
  @ApiOkResponse({ type: StorageLocationResponse })
  async activate(@CurrentPrincipal() actor: Principal, @Param('id', id) locationId: string): Promise<StorageLocationResponse> {
    return view(await this.storage.activate(actor, locationId));
  }

  @Post('database/activate')
  @HttpCode(204)
  @ApiOperation({ operationId: 'adminUseDatabaseStorage', summary: 'New files are kept in the database again' })
  @ApiNoContentResponse()
  async useDatabase(@CurrentPrincipal() actor: Principal): Promise<void> {
    await this.storage.useDatabase(actor);
  }

  @Delete('locations/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'adminRemoveStorageLocation', summary: 'Only a location that is not active and holds no files' })
  @ApiNoContentResponse()
  async remove(@CurrentPrincipal() actor: Principal, @Param('id', id) locationId: string): Promise<void> {
    await this.storage.remove(actor, locationId);
  }
}
