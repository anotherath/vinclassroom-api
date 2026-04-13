import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { SupabaseModule } from '../../database/supabase.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [SupabaseModule, RedisModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
