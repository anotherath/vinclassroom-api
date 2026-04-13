import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * Redis IoAdapter for Socket.IO
 * 
 * Enables horizontal scaling by using Redis Pub/Sub
 * to broadcast events across multiple server instances.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: any,
    private readonly redisService: RedisService,
  ) {
    super(app);
  }

  /**
   * Create Redis adapter for Socket.IO
   */
  async createRedisAdapter(): Promise<void> {
    try {
      const pubClient = this.redisService.getClient();
      const subClient = pubClient.duplicate();

      // Connect subClient if not already connected
      if (subClient.status !== 'ready') {
        await subClient.connect();
      }

      this.adapterConstructor = createAdapter(pubClient, subClient);
      
      this.logger.log('Redis adapter for Socket.IO created successfully');
    } catch (error) {
      this.logger.error(`Failed to create Redis adapter: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create Socket.IO server with Redis adapter
   */
  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options);

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
      this.logger.log('Socket.IO server using Redis adapter');
    } else {
      this.logger.warn('Socket.IO server using default adapter (no Redis)');
    }

    return server;
  }

  /**
   * Get adapter status
   */
  isUsingRedisAdapter(): boolean {
    return this.adapterConstructor !== null;
  }
}
