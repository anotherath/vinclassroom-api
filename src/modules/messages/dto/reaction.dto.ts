import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddReactionDto {
  @ApiProperty({ description: 'Emoji reaction (e.g., 👍, ❤️)' })
  @IsString()
  @MaxLength(10)
  emoji: string;
}
