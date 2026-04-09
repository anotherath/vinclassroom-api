import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';

export enum RoomType {
  TEXT = 'text',
  VOICE = 'voice',
}

export class CreateRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(RoomType)
  type?: RoomType = RoomType.TEXT;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean = false;
}
