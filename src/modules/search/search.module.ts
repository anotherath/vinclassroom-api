import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SupabaseModule } from '../../database/supabase.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [SupabaseModule, RedisModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
