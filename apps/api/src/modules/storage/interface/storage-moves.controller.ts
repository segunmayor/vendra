import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { MAX_CONCURRENCY, StorageMoveService } from '../application/moves';
import { MoveJob } from '../application/ports';

const id = new ZodPipe(z.uuid());
const startSchema = z.object({ deleteOld: z.boolean().default(true), concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).default(4) });
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

class SizeResponse {
  @ApiProperty() files!: number;
  @ApiProperty() bytes!: number;
}

class MoveProblemResponse {
  @ApiProperty() at!: Date;
  @ApiProperty({ enum: ['product-media', 'seller-documents'] }) purpose!: string;
  @ApiProperty() rowId!: string;
  @ApiProperty() message!: string;
}

export class MoveJobResponse {
  @ApiProperty() id!: string;
  @ApiProperty() targetLocationId!: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'cancelled', 'failed'] }) status!: string;
  @ApiProperty() deleteOld!: boolean;
  @ApiProperty({ description: 'Files copied at the same time' }) concurrency!: number;
  @ApiProperty({ description: 'Files that needed moving when the move started' }) total!: number;
  @ApiProperty() moved!: number;
  @ApiProperty({ description: 'Already there, or changed while being moved' }) skipped!: number;
  @ApiProperty({ description: 'Left where they were; they still work' }) failed!: number;
  @ApiProperty() movedBytes!: number;
  @ApiProperty({ type: [MoveProblemResponse], description: 'The latest problems, newest first' }) problems!: MoveProblemResponse[];
  @ApiPropertyOptional({ type: String, nullable: true }) message!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) startedAt!: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) finishedAt!: Date | null;
}

export class MoveSummaryResponse {
  @ApiPropertyOptional({ type: String, nullable: true }) activeId!: string | null;
  @ApiProperty({ type: SizeResponse, description: 'Files still in this server’s database' }) database!: SizeResponse;
  @ApiProperty({ type: SizeResponse, description: 'Files in storage locations other than the active one' }) otherLocations!: SizeResponse;
  @ApiPropertyOptional({ type: MoveJobResponse, nullable: true }) running!: MoveJobResponse | null;
}

class StartMoveDto {
  @ApiPropertyOptional({ default: true, description: 'Delete the copy in an earlier storage location once a file is moved. Files in the database are always cleared from it.' })
  deleteOld?: boolean;
  @ApiPropertyOptional({ default: 4, minimum: 1, maximum: MAX_CONCURRENCY, description: 'Files copied at the same time' })
  concurrency?: number;
}

const view = (job: MoveJob): MoveJobResponse => {
  const { cursor: _cursor, createdBy: _createdBy, ...rest } = job;
  return { ...rest, problems: job.problems.map((problem) => ({ ...problem })) };
};

/** Moves files already stored into the active storage location. */
@ApiTags('admin storage')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('settings.manage')
@Controller({ path: 'admin/storage/moves', version: '1' })
export class StorageMovesController {
  constructor(private readonly moves: StorageMoveService) {}

  @Get('summary')
  @ApiOperation({ operationId: 'adminStorageMoveSummary', summary: 'What is not yet in the active location, and any move in progress' })
  @ApiOkResponse({ type: MoveSummaryResponse })
  async summary(): Promise<MoveSummaryResponse> {
    const summary = await this.moves.summary();
    return { ...summary, database: { ...summary.database }, otherLocations: { ...summary.otherLocations }, running: summary.running ? view(summary.running) : null };
  }

  @Get()
  @ApiOperation({ operationId: 'adminListStorageMoves' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: [MoveJobResponse] })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>): Promise<MoveJobResponse[]> {
    return (await this.moves.recent(query.limit)).map(view);
  }

  @Post()
  @ApiOperation({ operationId: 'adminStartStorageMove', summary: 'Moves every file not yet in the active location into it, in the background' })
  @ApiCreatedResponse({ type: MoveJobResponse })
  async start(@CurrentPrincipal() actor: Principal, @Body(new ZodPipe(startSchema)) body: StartMoveDto): Promise<MoveJobResponse> {
    return view(await this.moves.start(actor, { deleteOld: body.deleteOld ?? true, concurrency: body.concurrency ?? 4 }));
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetStorageMove' })
  @ApiOkResponse({ type: MoveJobResponse })
  async get(@Param('id', id) moveId: string): Promise<MoveJobResponse> {
    return view(await this.moves.get(moveId));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminCancelStorageMove', summary: 'Stops after the current file. Files already moved stay moved.' })
  @ApiOkResponse({ type: MoveJobResponse })
  async cancel(@CurrentPrincipal() actor: Principal, @Param('id', id) moveId: string): Promise<MoveJobResponse> {
    return view(await this.moves.cancel(actor, moveId));
  }
}
