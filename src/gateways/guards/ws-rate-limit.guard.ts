import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AuthenticatedSocket } from '../types/socket.types';

/**
 * Rate limit configuration for WebSocket events
 */
interface RateLimitConfig {
  // Max requests allowed within windowMs
  maxRequests: number;
  // Time window in milliseconds
  windowMs: number;
  // Block duration after exceeding limit (ms)
  blockDurationMs?: number;
}

/**
 * Default rate limits for different event types
 */
const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Message events - stricter limits
  sendMessage: { maxRequests: 30, windowMs: 60000, blockDurationMs: 300000 }, // 30 msg/min, block 5 min
  sendDM: { maxRequests: 30, windowMs: 60000, blockDurationMs: 300000 },
  editMessage: { maxRequests: 20, windowMs: 60000, blockDurationMs: 120000 },
  deleteMessage: { maxRequests: 10, windowMs: 60000, blockDurationMs: 120000 },
  
  // Typing events - moderate limits
  typing: { maxRequests: 60, windowMs: 60000 }, // 1 per second
  dmTyping: { maxRequests: 60, windowMs: 60000 },
  
  // Reaction events
  addReaction: { maxRequests: 50, windowMs: 60000 },
  removeReaction: { maxRequests: 50, windowMs: 60000 },
  
  // Room management
  joinRoom: { maxRequests: 20, windowMs: 60000 },
  leaveRoom: { maxRequests: 20, windowMs: 60000 },
  joinDM: { maxRequests: 20, windowMs: 60000 },
  leaveDM: { maxRequests: 20, windowMs: 60000 },
  
  // Status/notification events - generous limits
  setStatus: { maxRequests: 60, windowMs: 60000 },
  getOnlineUsers: { maxRequests: 30, windowMs: 60000 },
  markNotificationRead: { maxRequests: 50, windowMs: 60000 },
  markDMRead: { maxRequests: 50, windowMs: 60000 },
  getUnreadCount: { maxRequests: 30, windowMs: 60000 },
  
  // File upload events
  fileUploadProgress: { maxRequests: 120, windowMs: 60000 }, // More lenient for progress updates
  
  // Default for unspecified events
  default: { maxRequests: 100, windowMs: 60000, blockDurationMs: 60000 },
};

/**
 * WebSocket Rate Limit Guard
 * 
 * Protects against WebSocket event spam by rate limiting
 * based on user ID and event type.
 */
@Injectable()
export class WsRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(WsRateLimitGuard.name);
  private readonly rateLimits: Map<string, RateLimitConfig>;

  constructor(private readonly redisService: RedisService) {
    // Load rate limits from config or use defaults
    this.rateLimits = new Map(Object.entries(DEFAULT_RATE_LIMITS));
  }

  /**
   * Check if the event should be rate limited
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const wsContext = context.switchToWs();
    const client = wsContext.getClient<AuthenticatedSocket>();
    const data = wsContext.getData();
    
    // Get event type from handler metadata
    const handler = context.getHandler();
    const eventType = Reflect.getMetadata('message', handler) || 'unknown';
    
    const userId = client.data?.user?.id;
    
    if (!userId) {
      // If no user ID, allow but log warning
      this.logger.warn(`Rate limit check without user ID for event: ${eventType}`);
      return true;
    }

    const rateLimitKey = `ratelimit:ws:${userId}:${eventType}`;
    const blockKey = `ratelimit:block:${userId}:${eventType}`;

    try {
      // Check if user is currently blocked
      const isBlocked = await this.redisService.get(blockKey);
      if (isBlocked) {
        const ttl = await this.redisService.ttl(blockKey);
        this.logger.warn(`Rate limit blocked: ${userId} for ${eventType}, retry after ${ttl}s`);
        
        client.emit('rateLimitExceeded', {
          event: eventType,
          retryAfter: ttl,
          message: `Rate limit exceeded. Please retry after ${ttl} seconds.`,
        });
        
        return false;
      }

      // Get rate limit config for this event type
      const config = this.rateLimits.get(eventType) || this.rateLimits.get('default')!;
      
      // Get current count
      const currentCount = await this.redisService.get(rateLimitKey);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      if (count >= config.maxRequests) {
        // Rate limit exceeded - block the user
        if (config.blockDurationMs) {
          await this.redisService.set(
            blockKey,
            '1',
            Math.floor(config.blockDurationMs / 1000),
          );
        }

        this.logger.warn(
          `Rate limit exceeded: ${userId} for ${eventType} (${count}/${config.maxRequests})`,
        );

        client.emit('rateLimitExceeded', {
          event: eventType,
          limit: config.maxRequests,
          windowMs: config.windowMs,
          message: `Rate limit exceeded: ${config.maxRequests} requests per ${config.windowMs / 1000}s`,
        });

        return false;
      }

      // Increment counter
      const newCount = count + 1;
      
      // Set or update the counter with TTL
      if (count === 0) {
        await this.redisService.set(
          rateLimitKey,
          String(newCount),
          Math.floor(config.windowMs / 1000),
        );
      } else {
        // Use pipeline to get TTL and set in one operation
        const pipeline = this.redisService.pipeline();
        pipeline.set(rateLimitKey, String(newCount));
        pipeline.expire(rateLimitKey, Math.floor(config.windowMs / 1000));
        await pipeline.exec();
      }

      // Add rate limit info to socket data for potential use
      client.data.rateLimitInfo = {
        event: eventType,
        remaining: config.maxRequests - newCount,
        limit: config.maxRequests,
        resetIn: config.windowMs / 1000,
      };

      return true;

    } catch (error) {
      this.logger.error(`Rate limit check error: ${error.message}`);
      // Fail open - allow request if rate limit check fails
      return true;
    }
  }

  /**
   * Get rate limit status for a user and event type
   */
  async getRateLimitStatus(
    userId: string,
    eventType: string,
  ): Promise<{
    limit: number;
    remaining: number;
    resetIn: number;
    blocked: boolean;
    blockExpiresIn?: number;
  }> {
    const rateLimitKey = `ratelimit:ws:${userId}:${eventType}`;
    const blockKey = `ratelimit:block:${userId}:${eventType}`;
    const config = this.rateLimits.get(eventType) || this.rateLimits.get('default')!;

    const [count, ttl, blocked, blockTtl] = await Promise.all([
      this.redisService.get(rateLimitKey),
      this.redisService.ttl(rateLimitKey),
      this.redisService.get(blockKey),
      this.redisService.ttl(blockKey),
    ]);

    const currentCount = count ? parseInt(count, 10) : 0;

    return {
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - currentCount),
      resetIn: ttl > 0 ? ttl : config.windowMs / 1000,
      blocked: !!blocked,
      blockExpiresIn: blockTtl > 0 ? blockTtl : undefined,
    };
  }

  /**
   * Reset rate limit for a user (admin use)
   */
  async resetRateLimit(userId: string, eventType?: string): Promise<void> {
    if (eventType) {
      const rateLimitKey = `ratelimit:ws:${userId}:${eventType}`;
      const blockKey = `ratelimit:block:${userId}:${eventType}`;
      await Promise.all([
        this.redisService.del(rateLimitKey),
        this.redisService.del(blockKey),
      ]);
    } else {
      // Reset all event types for this user
      const pattern = `ratelimit:ws:${userId}:*`;
      const keys = await this.redisService.getClient().keys(pattern);
      const blockPattern = `ratelimit:block:${userId}:*`;
      const blockKeys = await this.redisService.getClient().keys(blockPattern);
      
      if (keys.length > 0) {
        await this.redisService.getClient().del(...keys);
      }
      if (blockKeys.length > 0) {
        await this.redisService.getClient().del(...blockKeys);
      }
    }
  }

  /**
   * Update rate limit configuration at runtime
   */
  updateRateLimitConfig(eventType: string, config: RateLimitConfig): void {
    this.rateLimits.set(eventType, config);
    this.logger.log(`Updated rate limit for ${eventType}: ${config.maxRequests}/${config.windowMs}ms`);
  }

  /**
   * Get all rate limit configurations
   */
  getAllRateLimits(): Record<string, RateLimitConfig> {
    return Object.fromEntries(this.rateLimits);
  }
}
