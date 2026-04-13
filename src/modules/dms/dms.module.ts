import { Module } from '@nestjs/common';
import { DMsController } from './dms.controller';
import { DMsService } from './dms.service';
import { SupabaseModule } from '../../database/supabase.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [SupabaseModule, RedisModule],
  controllers: [DMsController],
  providers: [DMsService],
  exports: [DMsService],
})
export class DMsModule {}
