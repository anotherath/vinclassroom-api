import { IsString, IsUUID, IsOptional, IsJSON, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from './query-notifications.dto';

export class CreateNotificationDto {
  @ApiProperty({ description: 'User ID to receive notification' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Notification type', enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Notification message' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ description: 'Additional data (JSON)' })
  @IsOptional()
  data?: Record<string, any>;
}
