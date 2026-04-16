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

  private readonly usernameColors = [
    'Đỏ gạch', 'Cam đất', 'Vàng mù tạt', 'Vàng chanh', 'Xanh lá bơ',
    'Xanh ngọc nhạt', 'Xanh dương nhạt', 'Xanh biển', 'Tím nhạt', 'Hồng phấn',
    'Hồng tím', 'Xanh cổ vịt', 'Xanh rêu', 'Xanh denim', 'Tím oải hương',
    'Xám xanh', 'Nâu đất', 'Đỏ san hô', 'Vàng nắng', 'Xanh lá mạ',
    'Xanh ngọc', 'Xanh dương', 'Tím hoa cà', 'Hồng đào', 'Xám bạc',
    'Xanh rừng', 'Xanh biển sâu', 'Tím đậm', 'Cam neon', 'Vàng tươi',
    'Hồng nhạt', 'Xanh ngọc bích',
  ];

  private getRandomColor(): string {
    return this.usernameColors[Math.floor(Math.random() * this.usernameColors.length)];
  }

  async register(dto: RegisterDto) {
    const { email, password, displayName, avatar, color } = dto;

    // Check if email already exists
    const { data: existingUser, error: existingError } =
      await this.supabaseService
        .from('profiles')
        .select('id')
        .eq('email', email)
        .limit(1)
        .maybeSingle();

    if (existingError && !existingError.message?.includes('0 rows')) {
      this.logger.error('Failed to check existing user:', existingError.message);
      throw new BadRequestException('Failed to register user');
    }

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
        color: color || this.getRandomColor(),
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

    return {
      user: this.formatUser(profile),
      ...tokens,
    };
  }

  async login(dto: LoginDto, ip?: string) {
    const { email, password } = dto;
    this.logger.log(`Login attempt for ${email} from ${ip || 'unknown'}`);

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
      this.logger.error(
        'Login signIn failed:',
        authError?.message || 'No user returned',
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    // Get user profile
    const { data: profile, error: profileError } = await this.supabaseService
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .limit(1)
      .maybeSingle();

    if (profileError || !profile) {
      this.logger.error(
        'Login profile lookup failed for user',
        authData.user.id,
        profileError?.message || 'No profile found',
      );
      throw new UnauthorizedException('User profile not found');
    }

    // Generate tokens
    const tokens = await this.generateTokens(authData.user.id, email);

    // Store session in Redis
    await this.storeSession(authData.user.id, tokens);

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
    const cacheKey = RedisKeys.user.profile(userId);

    // Try to get from cache first (Hash)
    const cached = await this.redisService.hgetall(cacheKey);
    if (cached && Object.keys(cached).length > 0) {
      return {
        user: {
          id: cached.id,
          email: cached.email || undefined,
          displayName: cached.display_name || undefined,
          avatar: cached.avatar_url || undefined,
          bio: cached.bio || undefined,
          color: cached.color || undefined,
          status: cached.status || undefined,
          lastSeen: cached.last_seen || undefined,
          createdAt: cached.created_at || undefined,
          updatedAt: cached.updated_at || undefined,
        },
      };
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

    // Cache profile as Hash for 1 hour
    await this.redisService.hset(cacheKey, {
      id: String(profile.id),
      email: String(profile.email || ''),
      display_name: String(profile.display_name || ''),
      avatar_url: String(profile.avatar_url || ''),
      bio: String(profile.bio || ''),
      color: String(profile.color || ''),
      status: String(profile.status || ''),
      last_seen: String(profile.last_seen || ''),
      created_at: String(profile.created_at || ''),
      updated_at: String(profile.updated_at || ''),
    });
    await this.redisService.expire(cacheKey, 3600);

    return { user: this.formatUser(profile) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updateData: Record<string, string> = {};

    if (dto.displayName) updateData.display_name = dto.displayName;
    if (dto.avatar !== undefined) updateData.avatar_url = dto.avatar;
    if (dto.bio !== undefined) updateData.bio = dto.bio;
    if (dto.color !== undefined) updateData.color = dto.color;

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
    // Get user email to verify current password
    const { data: profile, error: profileError } = await this.supabaseService
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new BadRequestException('User not found');
    }

    // Verify current password
    const { error: signInError } = await this.supabaseService.signIn(
      profile.email,
      dto.currentPassword,
    );

    if (signInError) {
      throw new UnauthorizedException('Invalid current password');
    }

    // Update password via Supabase Admin API
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

    // Store session with TTL (access token lifetime)
    const accessTtl = this.parseExpiration(
      this.configService.get<string>('jwt.accessExpiration', '15m'),
    );
    await this.redisService.hset(RedisKeys.session(userId), sessionData);
    await this.redisService.expire(RedisKeys.session(userId), accessTtl);

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
      color: profile.color,
      status: profile.status,
      lastSeen: profile.last_seen,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
  }
}
