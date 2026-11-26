import { Controller, Get, Header, HttpCode, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { DomainError, Principal } from '../../../shared-kernel';
import { IMPORT_COLUMNS, IMPORT_HARD_LIMIT_BYTES, importTemplate, ProductImportService } from '../application/import.service';
import { ImportItemView, ImportJobView, ITEM_STATUSES } from '../application/ports';

const MODES = ['create_only', 'create_and_update'] as const;
const JOB_STATUSES = ['validated', 'queued', 'running', 'completed', 'cancelled'];
const uuid = new ZodPipe(z.uuid());
const uploadSchema = z.object({ mode: z.enum(MODES).default('create_and_update') });
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), before: z.iso.datetime().optional() });
const itemsSchema = z.object({
  status: z.enum(ITEM_STATUSES as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  after: z.coerce.number().int().min(-1).optional(),
});

class IssueResponse {
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Line in the file; 1 is the header' }) line!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) field!: string | null;
  @ApiProperty() message!: string;
}

class SummaryResponse {
  @ApiProperty() rows!: number;
  @ApiProperty() products!: number;
  @ApiProperty() variants!: number;
  @ApiProperty() creates!: number;
  @ApiProperty() updates!: number;
}

class CountsResponse {
  @ApiProperty() invalid!: number;
  @ApiProperty() ready!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() imported!: number;
  @ApiProperty() failed!: number;
}

export class ImportJobResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['csv'] }) format!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ enum: MODES }) mode!: string;
  @ApiProperty({ enum: JOB_STATUSES }) status!: string;
  @ApiProperty({ type: [IssueResponse], description: 'Problems with the whole file. If any, the import cannot start.' }) issues!: IssueResponse[];
  @ApiProperty({ type: [IssueResponse] }) warnings!: IssueResponse[];
  @ApiProperty({ type: SummaryResponse }) summary!: SummaryResponse;
  @ApiProperty({ type: CountsResponse }) counts!: CountsResponse;
  @ApiProperty() createdBy!: string;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) startedAt!: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) finishedAt!: Date | null;
}

export class ImportItemResponse {
  @ApiProperty() id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() handle!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [Number] }) lines!: number[];
  @ApiProperty({ type: [String] }) skus!: string[];
  @ApiProperty({ enum: ['create', 'update', 'skip'] }) action!: string;
  @ApiProperty({ enum: ITEM_STATUSES }) status!: string;
  @ApiProperty({ type: [IssueResponse] }) errors!: IssueResponse[];
  @ApiProperty({ type: [IssueResponse] }) warnings!: IssueResponse[];
  @ApiPropertyOptional({ type: String, nullable: true }) productId!: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) processedAt!: Date | null;
}

export class ImportColumnResponse {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['product', 'variant'] }) level!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty() description!: string;
  @ApiProperty() example!: string;
  @ApiProperty({ type: [String] }) aliases!: string[];
}

class UploadImportDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'A .csv file' }) file!: unknown;
  @ApiPropertyOptional({ enum: MODES, description: 'create_only leaves existing products alone' }) mode?: string;
}

interface UploadedCsv {
  readonly originalname: string;
  readonly buffer: Buffer;
}

const job = (view: ImportJobView): ImportJobResponse => ({
  ...view,
  issues: [...view.issues],
  warnings: [...view.warnings],
  summary: { ...view.summary },
  counts: { ...view.counts },
});
const item = (view: ImportItemView): ImportItemResponse => ({ ...view, lines: [...view.lines], skus: [...view.skus], errors: [...view.errors], warnings: [...view.warnings] });

function csvDownload(response: Response, fileName: string, content: string): StreamableFile {
  response.setHeader('content-type', 'text/csv; charset=utf-8');
  response.setHeader('content-disposition', `attachment; filename="${fileName.replace(/[^\w.() -]/g, '_')}"`);
  return new StreamableFile(Buffer.from(content, 'utf8'));
}

@ApiTags('admin product imports')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('catalogue.import')
@Controller({ path: 'admin/product-imports', version: '1' })
export class ProductImportsController {
  constructor(private readonly imports: ProductImportService) {}

  @Get('columns')
  @ApiOperation({ operationId: 'adminImportColumns', summary: 'Every column a product file may have' })
  @ApiOkResponse({ type: [ImportColumnResponse] })
  columns(): ImportColumnResponse[] {
    return IMPORT_COLUMNS.map((column) => ({ ...column, aliases: [...(column.aliases ?? [])] }));
  }

  @Get('template')
  @Header('cache-control', 'no-store')
  @ApiOperation({ operationId: 'adminImportTemplate', summary: 'A CSV template with example rows' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  template(@Res({ passthrough: true }) response: Response): StreamableFile {
    return csvDownload(response, 'vendra-products-template.csv', importTemplate());
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_HARD_LIMIT_BYTES, files: 1, fields: 4, parts: 5 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadImportDto })
  @ApiOperation({ operationId: 'adminUploadImport', summary: 'Check a product file. Nothing is created until the import is started.' })
  @ApiCreatedResponse({ type: ImportJobResponse })
  async upload(
    @CurrentPrincipal() actor: Principal,
    @UploadedFile() file: UploadedCsv | undefined,
    @Body(new ZodPipe(uploadSchema)) body: z.infer<typeof uploadSchema>,
  ): Promise<ImportJobResponse> {
    if (!file) throw new DomainError('import.no_file', 'Choose a file to upload');
    return job(await this.imports.upload(actor, { fileName: file.originalname, content: new Uint8Array(file.buffer), mode: body.mode }));
  }

  @Get()
  @ApiOperation({ operationId: 'adminListImports' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: String, description: 'createdAt of the last import on the previous page' })
  @ApiOkResponse({ type: [ImportJobResponse] })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>): Promise<ImportJobResponse[]> {
    return (await this.imports.list({ limit: query.limit, before: query.before ? new Date(query.before) : undefined })).map(job);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetImport' })
  @ApiOkResponse({ type: ImportJobResponse })
  async get(@Param('id', uuid) id: string): Promise<ImportJobResponse> {
    return job(await this.imports.get(id));
  }

  @Get(':id/items')
  @ApiOperation({ operationId: 'adminListImportItems', summary: 'Products in the file, in file order, with what happened to each' })
  @ApiQuery({ name: 'status', required: false, enum: ITEM_STATUSES })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'after', required: false, type: Number, description: 'position of the last item on the previous page' })
  @ApiOkResponse({ type: [ImportItemResponse] })
  async items(@Param('id', uuid) id: string, @Query(new ZodPipe(itemsSchema)) query: z.infer<typeof itemsSchema>): Promise<ImportItemResponse[]> {
    const status = query.status as (typeof ITEM_STATUSES)[number] | undefined;
    return (await this.imports.items(id, { status, limit: query.limit, afterPosition: query.after })).map(item);
  }

  @Get(':id/report')
  @ApiOperation({ operationId: 'adminImportReport', summary: 'Every problem and warning as CSV, to fix in a spreadsheet' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async report(@Param('id', uuid) id: string, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const report = await this.imports.report(id);
    return csvDownload(response, report.fileName, report.content);
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminStartImport', summary: 'Import the products that passed the checks' })
  @ApiOkResponse({ type: ImportJobResponse })
  async start(@CurrentPrincipal() actor: Principal, @Param('id', uuid) id: string): Promise<ImportJobResponse> {
    return job(await this.imports.start(actor, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminCancelImport', summary: 'Stop before the next product. Products already imported stay.' })
  @ApiOkResponse({ type: ImportJobResponse })
  async cancel(@CurrentPrincipal() actor: Principal, @Param('id', uuid) id: string): Promise<ImportJobResponse> {
    return job(await this.imports.cancel(actor, id));
  }
}
