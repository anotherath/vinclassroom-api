import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsRateLimitGuard } from './guards/ws-rate-limit.guard';
import { RedisModule } from '../redis/redis.module';
import { MessagesModule } from '../modules/messages/messages.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { DMsModule } from '../modules/dms/dms.module';

@Module({
  imports: [RedisModule, MessagesModule, NotificationsModule, DMsModule],
  providers: [ChatGateway, WsJwtGuard, WsRateLimitGuard, JwtService, ConfigService],
  exports: [ChatGateway],
})
export class ChatGatewayModule {}
