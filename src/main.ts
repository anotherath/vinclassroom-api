import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './gateways/adapters/redis.adapter';
import { RedisService } from './redis/redis.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Setup WebSocket adapter with Redis
  const redisService = app.get(RedisService);
  const redisAdapter = new RedisIoAdapter(app, redisService);
  
  try {
    await redisAdapter.createRedisAdapter();
    app.useWebSocketAdapter(redisAdapter);
    logger.log('WebSocket adapter with Redis initialized');
  } catch (error) {
    logger.warn(`Failed to initialize Redis adapter: ${error.message}`);
    logger.warn('Falling back to default WebSocket adapter (no horizontal scaling)');
  }

  // Get config
  const port = configService.get<number>('app.port', 3000);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api');
  const corsOrigin = configService.get<string>('app.corsOrigin', '*');

  // Enable CORS
  app.enableCors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(','),
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix(apiPrefix);

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Setup
  const config = new DocumentBuilder()
    .setTitle('VinClassroom API')
    .setDescription('The VinClassroom Backend API description')
    .setVersion('1.0')
    .addTag('vinclassroom')
    .addBearerAuth() // for JWT
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);

  logger.log(
    `Application is running on: http://localhost:${port}/${apiPrefix}`,
  );
  logger.log(
    `Swagger documentation: http://localhost:${port}/${apiPrefix}/docs`,
  );
}
bootstrap();
