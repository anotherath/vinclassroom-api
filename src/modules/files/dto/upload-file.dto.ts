import { IsOptional, IsString, IsUUID, MaxLength, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum FileType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  OTHER = 'other',
}

export class UploadFileDto {
  @ApiPropertyOptional({ description: 'Space ID where file belongs' })
  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @ApiPropertyOptional({ description: 'Room ID where file belongs' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'File description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'File type category', enum: FileType })
  @IsOptional()
  @IsEnum(FileType)
  fileType?: FileType;
}

export class FileUploadResponseDto {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  description?: string;
  spaceId?: string;
  roomId?: string;
  createdAt: string;
}
