import { IsUUID, IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDMConversationDto {
  @ApiProperty({ description: 'User ID to start conversation with' })
  @IsUUID()
  userId: string;
}

export class SendDMDto {
  @ApiProperty({ description: 'Message content' })
  @IsString()
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({ description: 'ID of message being replied to' })
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}
