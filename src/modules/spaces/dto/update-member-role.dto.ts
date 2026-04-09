import { IsEnum } from 'class-validator';
import { MemberRole } from './add-member.dto';

export class UpdateMemberRoleDto {
  @IsEnum(MemberRole)
  role: MemberRole;
}
