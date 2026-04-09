import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, SupabaseService, RedisService],
  exports: [UsersService],
})
export class UsersModule {}
