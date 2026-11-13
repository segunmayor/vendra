import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProduces, ApiProperty, ApiPropertyOptional, ApiQuery,
  ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { DomainError, NIGERIAN_STATES, Principal } from '../../../shared-kernel';
import { ApplicationView, DOCUMENT_HARD_LIMIT_BYTES, DOCUMENT_KINDS, DocumentFile, Requirements, StaffApplicationView, VendorsService } from '../application/vendors.service';

const STATUSES = ['draft', 'pending_verification', 'changes_requested', 'active', 'rejected'] as const;
const CASE_STATUSES = ['submitted', 'approved', 'rejected', 'changes_requested'] as const;
const KINDS = ['company', 'business_name'] as const;
const uuid = new ZodPipe(z.uuid());

const detailsSchema = z.object({
  displayName: z.string().max(200),
  legalName: z.string().max(300),
  businessKind: z.enum(KINDS),
  registrationNumber: z.string().max(40),
  taxId: z.string().max(40).nullish(),
  phone: z.string().max(40),
  address: z.object({ line1: z.string().max(300), line2: z.string().max(300).nullish(), city: z.string().max(200), state: z.string().max(60) }),
  description: z.string().max(2000).nullish(),
  version: z.number().int().min(0).optional(),
});
const submitSchema = z.object({ version: z.number().int().min(0).optional() });
const uploadSchema = z.object({ kind: z.enum(DOCUMENT_KINDS) });
const reviewSchema = z
  .object({ decision: z.enum(['approve', 'reject', 'request_changes']), note: z.string().trim().max(1000).optional(), version: z.number().int().min(0).optional() })
  .refine((body) => body.decision === 'approve' || (body.note?.length ?? 0) >= 3, { message: 'Give a reason the applicant will read', path: ['note'] });
const listSchema = z.object({ status: z.enum(STATUSES).optional() });

class BusinessAddressDto {
  @ApiProperty() line1!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) line2?: string | null;
  @ApiProperty() city!: string;
  @ApiProperty({ enum: NIGERIAN_STATES }) state!: string;
}

class ProfileDto {
  @ApiProperty({ description: 'The name customers will see' }) displayName!: string;
  @ApiProperty({ description: 'As on the CAC certificate' }) legalName!: string;
  @ApiProperty({ enum: KINDS }) businessKind!: (typeof KINDS)[number];
  @ApiProperty({ example: 'RC1234567' }) registrationNumber!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) taxId?: string | null;
  @ApiProperty({ example: '+2348031234567' }) phone!: string;
  @ApiProperty({ type: BusinessAddressDto }) address!: BusinessAddressDto;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
}

class SaveDetailsDto extends ProfileDto {
  @ApiPropertyOptional({ description: 'The version you were looking at' }) version?: number;
}

class SubmitDto {
  @ApiPropertyOptional() version?: number;
}

class ReviewDto {
  @ApiProperty({ enum: ['approve', 'reject', 'request_changes'] }) decision!: 'approve' | 'reject' | 'request_changes';
  @ApiPropertyOptional({ description: 'Required to reject or ask for changes. The applicant reads it.' }) note?: string;
  @ApiPropertyOptional({ description: 'The version you were looking at' }) version?: number;
}

class DocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() uploadedAt!: Date;
}

class DecisionDto {
  @ApiProperty({ enum: CASE_STATUSES }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty() at!: Date;
}

export class ApplicationResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ type: ProfileDto }) profile!: ProfileDto;
  @ApiProperty({ type: [DocumentDto] }) documents!: DocumentDto[];
  @ApiProperty({ enum: DOCUMENT_KINDS, isArray: true }) missingDocuments!: string[];
  @ApiProperty() editable!: boolean;
  @ApiPropertyOptional({ type: Date, nullable: true }) submittedAt!: Date | null;
  @ApiPropertyOptional({ type: DecisionDto, nullable: true }) decision!: DecisionDto | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() version!: number;
}

class RequirementsDto {
  @ApiProperty({ description: 'Whether new applications are accepted' }) open!: boolean;
  @ApiProperty({ enum: DOCUMENT_KINDS, isArray: true }) requiredDocuments!: string[];
  @ApiProperty({ enum: DOCUMENT_KINDS, isArray: true }) documentKinds!: string[];
  @ApiProperty() maxDocumentBytes!: number;
  @ApiProperty() approvedMessage!: string;
}

export class MyApplicationResponse {
  @ApiPropertyOptional({ type: ApplicationResponse, nullable: true }) application!: ApplicationResponse | null;
  @ApiProperty({ type: RequirementsDto }) requirements!: RequirementsDto;
}

class CaseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: CASE_STATUSES }) status!: string;
  @ApiProperty({ type: ProfileDto }) profile!: ProfileDto;
  @ApiProperty({ type: [DocumentDto] }) documents!: DocumentDto[];
  @ApiProperty() submittedAt!: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewedBy!: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) reviewedAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes!: string | null;
}

class SameRegistrationDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
}

export class StaffApplicationResponse extends ApplicationResponse {
  @ApiProperty() ownerAccountId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) ownerEmail!: string | null;
  @ApiProperty({ type: [CaseDto], description: 'Newest first' }) cases!: CaseDto[];
  @ApiProperty({ type: [SameRegistrationDto] }) sameRegistration!: SameRegistrationDto[];
}

export class SellerCountsResponse {
  @ApiProperty() draft!: number;
  @ApiProperty() pending_verification!: number;
  @ApiProperty() changes_requested!: number;
  @ApiProperty() active!: number;
  @ApiProperty() rejected!: number;
}

class UploadDto {
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind!: string;
  @ApiProperty({ type: 'string', format: 'binary' }) file!: unknown;
}

interface UploadedDocument {
  readonly originalname: string;
  readonly buffer: Buffer;
}

const document = (entry: ApplicationView['documents'][number]): DocumentDto => ({
  id: entry.id,
  kind: entry.kind,
  fileName: entry.fileName,
  contentType: entry.contentType,
  sizeBytes: entry.sizeBytes,
  uploadedAt: entry.uploadedAt,
});

const application = (entry: ApplicationView): ApplicationResponse => ({
  id: entry.id,
  status: entry.status,
  profile: { ...entry.profile, address: { ...entry.profile.address } },
  documents: entry.documents.map(document),
  missingDocuments: [...entry.missingDocuments],
  editable: entry.editable,
  submittedAt: entry.submittedAt,
  decision: entry.decision ? { ...entry.decision } : null,
  createdAt: entry.createdAt,
  version: entry.version,
});

const staff = (entry: StaffApplicationView): StaffApplicationResponse => ({
  ...application(entry),
  ownerAccountId: entry.ownerAccountId,
  ownerEmail: entry.ownerEmail,
  cases: entry.cases.map((item) => ({
    id: item.id,
    status: item.status,
    profile: { ...item.profile, address: { ...item.profile.address } },
    documents: item.documents.map(document),
    submittedAt: item.submittedAt,
    reviewedBy: item.reviewedBy,
    reviewedAt: item.reviewedAt,
    notes: item.notes,
  })),
  sameRegistration: entry.sameRegistration.map((other) => ({ ...other })),
});

const requirements = (entry: Requirements): RequirementsDto => ({ ...entry, requiredDocuments: [...entry.requiredDocuments], documentKinds: [...entry.documentKinds] });

/** Sends a stored document as a download. Never shown inline, so a file cannot run as a page. */
function download(response: Response, file: DocumentFile): StreamableFile {
  response.set({
    'content-type': file.contentType,
    'content-disposition': `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox",
  });
  return new StreamableFile(Buffer.from(file.content));
}

@ApiTags('vendor application')
@ApiBearerAuth()
@Surface('vendor')
@Controller({ path: 'vendor/application', version: '1' })
export class VendorApplicationController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @ApiOperation({ operationId: 'vendorMyApplication', summary: 'Your seller application, and what it needs' })
  @ApiOkResponse({ type: MyApplicationResponse })
  async mine(@CurrentPrincipal() principal: Principal): Promise<MyApplicationResponse> {
    const result = await this.vendors.mine(principal);
    return { application: result.application ? application(result.application) : null, requirements: requirements(result.requirements) };
  }

  @Put()
  @ApiOperation({ operationId: 'vendorSaveApplication', summary: 'Start your application, or change its details' })
  @ApiOkResponse({ type: ApplicationResponse })
  async save(@CurrentPrincipal() principal: Principal, @Body(new ZodPipe(detailsSchema)) body: SaveDetailsDto): Promise<ApplicationResponse> {
    const { version, ...input } = body;
    return application(await this.vendors.saveDetails(principal, input, version));
  }

  @Post('documents')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_HARD_LIMIT_BYTES, files: 1, fields: 5, parts: 6 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDto })
  @ApiOperation({ operationId: 'vendorAddDocument', summary: 'Attach a verification document (PDF or photo)' })
  @ApiOkResponse({ type: ApplicationResponse })
  async upload(@CurrentPrincipal() principal: Principal, @UploadedFile() file: UploadedDocument | undefined, @Body(new ZodPipe(uploadSchema)) body: { kind: (typeof DOCUMENT_KINDS)[number] }): Promise<ApplicationResponse> {
    if (!file) throw new DomainError('seller.document_missing', 'Choose a file to upload');
    return application(await this.vendors.addDocument(principal, { kind: body.kind, fileName: file.originalname, content: new Uint8Array(file.buffer) }));
  }

  @Delete('documents/:documentId')
  @ApiOperation({ operationId: 'vendorRemoveDocument' })
  @ApiOkResponse({ type: ApplicationResponse })
  async remove(@CurrentPrincipal() principal: Principal, @Param('documentId', uuid) documentId: string): Promise<ApplicationResponse> {
    return application(await this.vendors.removeDocument(principal, documentId));
  }

  @Get('documents/:documentId')
  @ApiOperation({ operationId: 'vendorDownloadDocument' })
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async file(@CurrentPrincipal() principal: Principal, @Param('documentId', uuid) documentId: string, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    return download(response, await this.vendors.myDocument(principal, documentId));
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOperation({ operationId: 'vendorSubmitApplication', summary: 'Send your application for verification' })
  @ApiOkResponse({ type: ApplicationResponse })
  async submit(@CurrentPrincipal() principal: Principal, @Body(new ZodPipe(submitSchema)) body: SubmitDto): Promise<ApplicationResponse> {
    return application(await this.vendors.submit(principal, body.version));
  }
}

@ApiTags('admin sellers')
@ApiBearerAuth()
@Surface('admin')
@RequirePermission('vendors.approve')
@Controller({ path: 'admin/sellers', version: '1' })
export class AdminSellersController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListSellerApplications', summary: 'Seller applications. Filtered by status, longest waiting first.' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiOkResponse({ type: [ApplicationResponse] })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>): Promise<ApplicationResponse[]> {
    return (await this.vendors.list(query.status)).map(application);
  }

  @Get('counts')
  @ApiOperation({ operationId: 'adminSellerCounts' })
  @ApiOkResponse({ type: SellerCountsResponse })
  async counts(): Promise<SellerCountsResponse> {
    const counts = await this.vendors.counts();
    return Object.fromEntries(STATUSES.map((status) => [status, counts[status] ?? 0])) as unknown as SellerCountsResponse;
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetSellerApplication' })
  @ApiOkResponse({ type: StaffApplicationResponse })
  async get(@Param('id', uuid) id: string): Promise<StaffApplicationResponse> {
    return staff(await this.vendors.get(id));
  }

  @Get(':id/documents/:documentId')
  @ApiOperation({ operationId: 'adminDownloadSellerDocument' })
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async file(@Param('id', uuid) id: string, @Param('documentId', uuid) documentId: string, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    return download(response, await this.vendors.document(id, documentId));
  }

  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminReviewSellerApplication', summary: 'Approve, reject, or ask for changes' })
  @ApiOkResponse({ type: StaffApplicationResponse })
  async review(@CurrentPrincipal() actor: Principal, @Param('id', uuid) id: string, @Body(new ZodPipe(reviewSchema)) body: ReviewDto): Promise<StaffApplicationResponse> {
    return staff(await this.vendors.review(actor, id, body));
  }
}
