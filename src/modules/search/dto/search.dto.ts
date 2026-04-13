import { IsOptional, IsInt, Min, Max, IsString, IsEnum, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SearchType {
  ALL = 'all',
  MESSAGES = 'messages',
  USERS = 'users',
  SPACES = 'spaces',
  FILES = 'files',
}

export class SearchDto {
  @ApiProperty({ description: 'Search query' })
  @IsString()
  query: string;

  @ApiPropertyOptional({ 
    description: 'Search type filter', 
    enum: SearchType, 
    default: SearchType.ALL 
  })
  @IsOptional()
  @IsEnum(SearchType)
  type?: SearchType = SearchType.ALL;

  @ApiPropertyOptional({ description: 'Space ID to search within' })
  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @ApiPropertyOptional({ description: 'Room ID to search within' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class SearchResultDto {
  type: string;
  id: string;
  title: string;
  content?: string;
  highlight?: string;
  metadata?: Record<string, any>;
  score: number;
  createdAt: string;
}

export class SearchResponseDto {
  query: string;
  results: SearchResultDto[];
  total: number;
  hasMore: boolean;
  page: number;
  limit: number;
  byType: Record<string, number>;
}
