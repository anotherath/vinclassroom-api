import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './database';
import { RedisService } from './redis';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  getHello(): string {
    return 'VinClassroom API is running!';
  }

  async getHealth() {
    const checks = {
      database: false,
      redis: { connected: false, status: 'unknown' },
      timestamp: new Date().toISOString(),
    };

    // Check Database
    try {
      checks.database = await this.supabaseService.healthCheck();
    } catch (error) {
      this.logger.error('Database health check failed:', error.message);
    }

    // Check Redis (external server)
    try {
      checks.redis = await this.redisService.healthCheck();
    } catch (error) {
      this.logger.error('Redis health check failed:', error.message);
      checks.redis = { connected: false, status: 'error' };
    }

    const isHealthy = checks.database && checks.redis.connected;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      ...checks,
    };
  }
}
