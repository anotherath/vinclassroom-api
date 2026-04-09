import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  username?: string;
  tls?: boolean;
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private subscriber: Redis;
  private isConnected = false;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const config = this.configService.get<RedisConfig>('redis');
    
    if (!config) {
      throw new Error('Redis configuration not found');
    }

    // Build Redis options
    const redisOptions: RedisOptions = {
      maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
      connectTimeout: config.connectTimeout || 10000,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.warn(`Redis connection retry attempt ${times}, delaying ${delay}ms`);
        return delay;
      },
      reconnectOnError: (err: Error) => {
        this.logger.error('Redis connection error:', err.message);
        // Reconnect on READONLY error (failover scenario)
        return err.message.includes('READONLY');
      },
    };

    // Add TLS if needed
    if (config.tls) {
      redisOptions.tls = {
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
      };
    }

    // Create clients based on config
    if (config.url) {
      // URL-based connection (recommended for external Redis)
      this.logger.log(`Connecting to Redis via URL: ${this.maskUrl(config.url)}`);
      this.client = new Redis(config.url, redisOptions);
      this.subscriber = new Redis(config.url, redisOptions);
    } else {
      // Individual settings
      this.logger.log(`Connecting to Redis at ${config.host}:${config.port}`);
      this.client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        username: config.username,
        ...redisOptions,
      });
      this.subscriber = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        username: config.username,
        ...redisOptions,
      });
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Client event handlers
    this.client.on('connect', () => {
      this.logger.log('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready');
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis client error:', err.message);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.logger.warn('Redis client connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      this.logger.log('Redis client reconnecting...');
    });

    // Subscriber event handlers
    this.subscriber.on('connect', () => {
      this.logger.log('Redis subscriber connected');
    });

    this.subscriber.on('error', (err) => {
      this.logger.error('Redis subscriber error:', err.message);
    });
  }

  private maskUrl(url: string): string {
    // Hide password in logs
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '****';
      }
      return parsed.toString();
    } catch {
      return url.replace(/:\/\/.*@/, '://****@');
    }
  }

  onModuleDestroy() {
    this.logger.log('Closing Redis connections...');
    this.client?.disconnect();
    this.subscriber?.disconnect();
    this.logger.log('Redis connections closed');
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  isReady(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  // Health check
  async ping(): Promise<string> {
    return this.client.ping();
  }

  async healthCheck(): Promise<{ connected: boolean; status: string }> {
    try {
      await this.client.ping();
      return { connected: true, status: this.client.status };
    } catch (error) {
      return { connected: false, status: this.client.status };
    }
  }

  // Key operations
  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  // String operations
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<string> {
    if (ttlSeconds) {
      return this.client.setex(key, ttlSeconds, value);
    }
    return this.client.set(key, value);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hset(key: string, field: string, value: string): Promise<number>;
  async hset(key: string, fields: Record<string, string>): Promise<number>;
  async hset(key: string, fieldOrFields: string | Record<string, string>, value?: string): Promise<number> {
    if (typeof fieldOrFields === 'string') {
      return this.client.hset(key, fieldOrFields, value || '');
    }
    return this.client.hset(key, fieldOrFields);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment);
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.client.hdel(key, field);
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.client.sismember(key, member);
  }

  // Sorted Set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    if (withScores) {
      return this.client.zrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrange(key, start, stop);
  }

  async zrevrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    if (withScores) {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrevrange(key, start, stop);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return this.client.zrem(key, ...members);
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return this.client.ltrim(key, start, stop);
  }

  // Pub/Sub
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  subscribe(channel: string, callback: (message: string) => void): void {
    this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  unsubscribe(channel: string): void {
    this.subscriber.unsubscribe(channel);
  }

  // Pipeline for batch operations
  pipeline(): ReturnType<Redis['pipeline']> {
    return this.client.pipeline();
  }
}
