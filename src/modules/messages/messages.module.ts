import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { SupabaseModule } from '../../database/supabase.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [SupabaseModule, RedisModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
