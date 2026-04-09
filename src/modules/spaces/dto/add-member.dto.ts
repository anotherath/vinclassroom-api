import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum MemberRole {
  ADMIN = 'admin',
  MEMBER = 'member',
}

export class AddMemberDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsEnum(MemberRole)
  role?: MemberRole = MemberRole.MEMBER;
}
