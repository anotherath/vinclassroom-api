import { IsOptional, IsString } from 'class-validator';

export class SearchMembersDto {
  @IsString()
  q: string;
}
