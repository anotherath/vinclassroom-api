import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  // Priority: REDIS_URL > individual settings
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    return {
      url: redisUrl,
      // Connection pool settings
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
      connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
      // Whether to use TLS (rediss://)
      tls: redisUrl.startsWith('rediss://') || process.env.REDIS_TLS === 'true',
    };
  }

  // Individual settings (fallback)
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    username: process.env.REDIS_USERNAME,
    tls: process.env.REDIS_TLS === 'true',
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
  };
});
