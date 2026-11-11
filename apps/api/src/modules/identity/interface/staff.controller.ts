import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Principal } from '../../../shared-kernel';
import { AuditRecord, RoleView, StaffView } from '../application/ports';
import { StaffService } from '../application/staff.service';
import {
  auditQuerySchema,
  AuditRecordResponse,
  CreateRoleDto,
  createRoleSchema,
  CreateStaffDto,
  createStaffSchema,
  IdResponse,
  RoleResponse,
  SetRolesDto,
  setRolesSchema,
  StaffResponse,
  uuidSchema,
} from './dto';

@ApiTags('admin staff')
@ApiBearerAuth()
@Surface('admin')
@Controller({ path: 'admin', version: '1' })
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('permissions')
  @RequirePermission('roles.manage')
  @ApiOperation({ operationId: 'adminListPermissions' })
  @ApiOkResponse({ type: [String] })
  permissions(): readonly string[] {
    return this.staff.listPermissions();
  }

  @Get('roles')
  @RequirePermission('roles.manage')
  @ApiOperation({ operationId: 'adminListRoles' })
  @ApiOkResponse({ type: [RoleResponse] })
  roles(): Promise<RoleView[]> {
    return this.staff.listRoles();
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  @ApiOperation({ operationId: 'adminCreateRole' })
  @ApiCreatedResponse({ type: RoleResponse })
  createRole(
    @CurrentPrincipal() actor: Principal,
    @Body(new ZodPipe(createRoleSchema)) body: CreateRoleDto,
  ): Promise<RoleView> {
    return this.staff.createRole(actor, body.name, body.permissions);
  }

  @Get('staff')
  @RequirePermission('staff.manage')
  @ApiOperation({ operationId: 'adminListStaff' })
  @ApiOkResponse({ type: [StaffResponse] })
  list(): Promise<StaffView[]> {
    return this.staff.listStaff();
  }

  @Post('staff')
  @RequirePermission('staff.manage')
  @ApiOperation({ operationId: 'adminCreateStaff' })
  @ApiCreatedResponse({ type: IdResponse })
  create(
    @CurrentPrincipal() actor: Principal,
    @Body(new ZodPipe(createStaffSchema)) body: CreateStaffDto,
  ): Promise<{ id: string }> {
    return this.staff.createStaff(actor, body.email, body.password, body.roleIds);
  }

  @Put('staff/:id/roles')
  @HttpCode(204)
  @RequirePermission('staff.manage')
  @ApiOperation({ operationId: 'adminSetStaffRoles' })
  @ApiNoContentResponse()
  setRoles(
    @CurrentPrincipal() actor: Principal,
    @Param('id', new ZodPipe(uuidSchema)) id: string,
    @Body(new ZodPipe(setRolesSchema)) body: SetRolesDto,
  ): Promise<void> {
    return this.staff.setRoles(actor, id, body.roleIds);
  }

  @Post('staff/:id/suspend')
  @HttpCode(204)
  @RequirePermission('staff.manage')
  @ApiOperation({ operationId: 'adminSuspendStaff' })
  @ApiNoContentResponse()
  suspend(
    @CurrentPrincipal() actor: Principal,
    @Param('id', new ZodPipe(uuidSchema)) id: string,
  ): Promise<void> {
    return this.staff.suspend(actor, id);
  }

  @Get('audit-logs')
  @RequirePermission('audit.read')
  @ApiOperation({ operationId: 'adminListAuditLogs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOkResponse({ type: [AuditRecordResponse] })
  audit(
    @Query(new ZodPipe(auditQuerySchema)) query: { limit: number; cursor?: string },
  ): Promise<AuditRecord[]> {
    return this.staff.listAudit(query.limit, query.cursor);
  }
}
