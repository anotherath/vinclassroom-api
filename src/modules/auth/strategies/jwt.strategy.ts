import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SupabaseService } from '../../../database/supabase.service';
import { RedisService } from '../../../redis/redis.service';
import { RedisKeys } from '../../../redis/keys';

interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private redisService: RedisService,
  ) {
    const secret = configService.get<string>('jwt.secret');

    if (!secret) {
      throw new Error('JWT secret is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const cacheKey = RedisKeys.user.profile(payload.sub);

    // Try cache first
    const cached = await this.redisService.hgetall(cacheKey);
    if (cached && Object.keys(cached).length > 0) {
      return {
        userId: payload.sub,
        email: payload.email,
        id: cached.id,
        display_name: cached.display_name || undefined,
        avatar_url: cached.avatar_url || undefined,
        bio: cached.bio || undefined,
        color: cached.color || undefined,
        status: cached.status || undefined,
        last_seen: cached.last_seen || undefined,
        created_at: cached.created_at || undefined,
        updated_at: cached.updated_at || undefined,
      };
    }

    // Get user profile from database
    const { data: profile, error } = await this.supabaseService
      .from('profiles')
      .select('*')
      .eq('id', payload.sub)
      .single();

    if (error || !profile) {
      throw new UnauthorizedException('User not found');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      ...profile,
    };
  }
}
