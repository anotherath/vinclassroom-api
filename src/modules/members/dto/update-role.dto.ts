import { IsEnum } from 'class-validator';

export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export class UpdateRoleDto {
  @IsEnum(MemberRole)
  role: MemberRole;
}
