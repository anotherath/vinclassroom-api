import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private redisService: RedisService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const canActivate = await super.canActivate(context);
    if (!canActivate) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.userId) {
      const sessionExists = await this.redisService.exists(
        RedisKeys.session(user.userId),
      );
      if (!sessionExists) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    return true;
  }

  handleRequest(err, user, info) {
    if (err || !user) {
      throw (
        err || new UnauthorizedException('Access token is invalid or expired')
      );
    }
    return user;
  }
}
