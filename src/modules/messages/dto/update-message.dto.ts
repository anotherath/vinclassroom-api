import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiProperty({ description: 'Updated message content' })
  @IsString()
  @MaxLength(4000)
  content: string;
}
