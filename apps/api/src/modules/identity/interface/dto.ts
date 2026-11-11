import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

// Length and format rules live in the domain. These schemas only check request shape.
const text = z.string().min(1).max(1024);

export const credentialsSchema = z.object({ email: text, password: text });
export const refreshSchema = z.object({ refreshToken: text });
export const changePasswordSchema = z.object({ currentPassword: text, newPassword: text });
export const createStaffSchema = z.object({
  email: text,
  password: text,
  roleIds: z.array(z.uuid()).max(50),
});
export const setRolesSchema = z.object({ roleIds: z.array(z.uuid()).max(50) });
export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(64),
  permissions: z.array(z.string().max(64)).min(1).max(100),
});
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export const uuidSchema = z.uuid();

export class CredentialsDto {
  @ApiProperty() email!: string;
  @ApiProperty() password!: string;
}

export class RefreshDto {
  @ApiProperty() refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty() currentPassword!: string;
  @ApiProperty() newPassword!: string;
}

export class CreateStaffDto {
  @ApiProperty() email!: string;
  @ApiProperty() password!: string;
  @ApiProperty({ type: [String] }) roleIds!: string[];
}

export class SetRolesDto {
  @ApiProperty({ type: [String] }) roleIds!: string[];
}

export class CreateRoleDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class SessionResponse {
  @ApiProperty() accountId!: string;
  @ApiProperty() accessToken!: string;
  @ApiProperty() accessTokenExpiresAt!: Date;
  @ApiProperty() refreshToken!: string;
  @ApiProperty() refreshTokenExpiresAt!: Date;
}

export class ProfileResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['store', 'admin', 'vendor'] }) audience!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class IdResponse {
  @ApiProperty() id!: string;
}

export class RoleResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class StaffRoleResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class StaffResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: string;
  @ApiProperty({ type: [StaffRoleResponse] }) roles!: StaffRoleResponse[];
}

export class AuditRecordResponse {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) actorId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() targetType!: string;
  @ApiProperty() targetId!: string;
}
