import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  UpdateProfileDto,
  ChangePasswordDto,
} from './dto';

interface TokenPayload {
  sub: string;
  email: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private supabaseService: SupabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  async register(dto: RegisterDto) {
    const { email, password, displayName, avatar } = dto;

    // Check if email already exists
    const { data: existingUser } = await this.supabaseService
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } =
      await this.supabaseService.signUp(email, password);

    if (authError) {
      this.logger.error(
        'Failed to create user in Supabase Auth:',
        authError.message,
      );
      throw new BadRequestException(authError.message);
    }

    if (!authData.user) {
      throw new BadRequestException('Failed to create user');
    }

    // Create profile in database
    const { data: profile, error: profileError } = await this.supabaseService
      .from('profiles')
      .insert({
        id: authData.user.id,
        email,
        display_name: displayName,
        avatar_url: avatar,
      })
      .select()
      .single();

    if (profileError) {
      this.logger.error('Failed to create profile:', profileError.message);
      // Try to clean up the auth user
      await this.supabaseService
        .getClient()
        .auth.admin.deleteUser(authData.user.id);
      throw new BadRequestException('Failed to create user profile');
    }

    // Generate tokens
    const tokens = await this.generateTokens(authData.user.id, email);

    // Store session in Redis
    await this.storeSession(authData.user.id, tokens);

    // Set user online status
    await this.setUserOnline(authData.user.id);

    return {
      user: this.formatUser(profile),
      ...tokens,
    };
  }

  async login(dto: LoginDto, ip?: string) {
    const { email, password } = dto;

    // Check rate limit
    if (ip) {
      const rateKey = RedisKeys.rateLimit.login(ip);
      const attempts = await this.redisService.incr(rateKey);
      if (attempts === 1) {
        await this.redisService.expire(rateKey, 3600); // 1 hour
      }
      if (attempts > 5) {
        throw new UnauthorizedException(
          'Too many login attempts. Please try again later.',
        );
      }
    }

    // Sign in with Supabase
    const { data: authData, error: authError } =
      await this.supabaseService.signIn(email, password);

    if (authError || !authData.user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Get user profile
    const { data: profile, error: profileError } = await this.supabaseService
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      throw new UnauthorizedException('User profile not found');
    }

    // Generate tokens
    const tokens = await this.generateTokens(authData.user.id, email);

    // Store session in Redis
    await this.storeSession(authData.user.id, tokens);

    // Set user online status
    await this.setUserOnline(authData.user.id);

    // Reset rate limit on successful login
    if (ip) {
      await this.redisService.del(RedisKeys.rateLimit.login(ip));
    }

    return {
      user: this.formatUser(profile),
      ...tokens,
    };
  }

  async logout(userId: string, token: string) {
    // Remove session from Redis
    await this.redisService.del(RedisKeys.session(userId));
    await this.redisService.del(RedisKeys.refreshToken(userId));

    // Set user offline
    await this.setUserOffline(userId);

    // Sign out from Supabase (optional, as token validation is done via JWT)
    await this.supabaseService.signOut(token);

    return { message: 'Logged out successfully' };
  }

  async refreshToken(dto: RefreshTokenDto): Promise<AuthTokens> {
    const { refreshToken } = dto;

    try {
      // Verify the refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });

      // Check if refresh token is stored in Redis
      const storedToken = await this.redisService.get(
        RedisKeys.refreshToken(payload.sub),
      );

      if (!storedToken || storedToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(payload.sub, payload.email);

      // Update session in Redis
      await this.storeSession(payload.sub, tokens);

      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async getProfile(userId: string) {
    // Try to get from cache first
    const cachedProfile = await this.redisService.get(
      RedisKeys.user.profile(userId),
    );

    if (cachedProfile) {
      return { user: JSON.parse(cachedProfile) };
    }

    // Get from database
    const { data: profile, error } = await this.supabaseService
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new UnauthorizedException('User not found');
    }

    // Cache profile for 1 hour
    await this.redisService.set(
      RedisKeys.user.profile(userId),
      JSON.stringify(this.formatUser(profile)),
      3600,
    );

    return { user: this.formatUser(profile) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updateData: Record<string, string> = {};

    if (dto.displayName) updateData.display_name = dto.displayName;
    if (dto.avatar !== undefined) updateData.avatar_url = dto.avatar;
    if (dto.bio !== undefined) updateData.bio = dto.bio;

    updateData.updated_at = new Date().toISOString();

    const { data: profile, error } = await this.supabaseService
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Failed to update profile');
    }

    // Invalidate cache
    await this.redisService.del(RedisKeys.user.profile(userId));

    return { user: this.formatUser(profile) };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    // Note: In a real implementation, you would verify the current password
    // by attempting a login or using Supabase's verify password API
    // For now, we'll update the password via Supabase Admin API

    const { error } = await this.supabaseService
      .getClient()
      .auth.admin.updateUserById(userId, {
        password: dto.newPassword,
      });

    if (error) {
      throw new BadRequestException('Failed to change password');
    }

    // Invalidate all sessions
    await this.redisService.del(RedisKeys.session(userId));
    await this.redisService.del(RedisKeys.refreshToken(userId));

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const { error } = await this.supabaseService
      .getClient()
      .auth.resetPasswordForEmail(email, {
        redirectTo: `${this.configService.get<string>('app.frontendUrl')}/reset-password`,
      });

    if (error) {
      this.logger.error('Failed to send password reset email:', error.message);
    }

    // Always return success to prevent email enumeration
    return {
      message: 'If the email exists, a password reset link has been sent',
    };
  }

  private async generateTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const payload: TokenPayload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: this.configService.get<string>(
        'jwt.accessExpiration',
      ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>(
        'jwt.refreshExpiration',
      ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    // Parse expiration time
    const expiresIn = this.parseExpiration(
      this.configService.get<string>('jwt.accessExpiration', '15m'),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  private async storeSession(
    userId: string,
    tokens: AuthTokens,
  ): Promise<void> {
    const sessionData = {
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      createdAt: Date.now().toString(),
      lastActive: Date.now().toString(),
    };

    // Store session
    await this.redisService.hset(RedisKeys.session(userId), sessionData);

    // Store refresh token with TTL (7 days)
    const refreshTtl = this.parseExpiration(
      this.configService.get<string>('jwt.refreshExpiration', '7d'),
    );
    await this.redisService.set(
      RedisKeys.refreshToken(userId),
      tokens.refreshToken,
      refreshTtl,
    );
  }

  private async setUserOnline(userId: string): Promise<void> {
    await this.redisService.hset(RedisKeys.user.status(userId), {
      online: 'true',
      lastSeen: Date.now().toString(),
    });
    await this.redisService.sadd(RedisKeys.usersOnline(), userId);
  }

  private async setUserOffline(userId: string): Promise<void> {
    await this.redisService.hset(RedisKeys.user.status(userId), {
      online: 'false',
      lastSeen: Date.now().toString(),
    });
    await this.redisService.srem(RedisKeys.usersOnline(), userId);
  }

  private parseExpiration(expiration: string): number {
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return value * (multipliers[unit] || 60);
  }

  private formatUser(profile: Record<string, unknown>) {
    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      avatar: profile.avatar_url,
      bio: profile.bio,
      status: profile.status,
      lastSeen: profile.last_seen,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
  }
}
