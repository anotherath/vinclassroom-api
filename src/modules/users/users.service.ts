import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import { SearchUsersDto } from './dto/search-users.dto';

interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
  bio?: string;
  created_at?: string;
  updated_at?: string;
}

interface BlockedUserRecord {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  profiles?: UserProfile;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Update user status and last_seen in database
   */
  async updateUserStatus(
    userId: string,
    status: string,
  ): Promise<void> {
    const { error } = await this.supabaseService
      .from('profiles')
      .update({ status, last_seen: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      this.logger.error(
        `Failed to update user status for ${userId}:`,
        error.message,
      );
    }
  }

  /**
   * Search users with query string, excluding blocked users
   */
  async searchUsers(
    query: SearchUsersDto,
    currentUserId: string,
  ): Promise<{ users: UserProfile[]; total: number }> {
    const { q, limit = 20, offset = 0 } = query;

    // Get list of users that the current user has blocked or been blocked by
    const blockedUserIds = await this.getBlockedUserIds(currentUserId);

    // Search users in profiles table
    let dbQuery = this.supabaseService
      .from('profiles')
      .select('*', { count: 'exact' })
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .neq('id', currentUserId)
      .range(offset, offset + limit - 1);

    // Exclude blocked users if any
    if (blockedUserIds.length > 0) {
      dbQuery = dbQuery.not('id', 'in', `(${blockedUserIds.join(',')})`);
    }

    const { data, error, count } = await dbQuery;

    if (error) {
      this.logger.error('Error searching users:', error.message);
      throw new Error('Failed to search users');
    }

    return {
      users: (data as UserProfile[]) || [],
      total: count || 0,
    };
  }

  /**
   * Get user profile by ID (with Redis caching)
   */
  async getUserById(userId: string): Promise<UserProfile> {
    // Try cache first
    const cacheKey = RedisKeys.user.profile(userId);
    const cached = await this.redisService.hgetall(cacheKey);

    if (cached && Object.keys(cached).length > 0) {
      this.logger.debug(`Cache hit for user profile: ${userId}`);
      return this.mapCachedProfile(cached);
    }

    // Fetch from database
    const { data, error } = await this.supabaseService
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      this.logger.warn(`User not found: ${userId}`);
      throw new NotFoundException('User not found');
    }

    const profile = data as UserProfile;

    // Cache the profile
    await this.cacheUserProfile(profile);

    return profile;
  }

  /**
   * Get user online status from Redis
   */
  async getUserStatus(userId: string): Promise<{
    online: boolean;
    lastSeen?: string;
  }> {
    const statusKey = RedisKeys.user.status(userId);
    const onlineKey = RedisKeys.usersOnline();

    try {
      // Check if user is in online set
      const isOnline = await this.redisService.sismember(onlineKey, userId);

      if (isOnline) {
        // Get additional status info if available
        const statusData = await this.redisService.hgetall(statusKey);
        return {
          online: true,
          lastSeen: statusData.lastSeen || new Date().toISOString(),
        };
      }

      // Check for last seen timestamp
      const lastSeen = await this.redisService.hget(statusKey, 'lastSeen');

      return {
        online: false,
        lastSeen: lastSeen || undefined,
      };
    } catch (error) {
      this.logger.error(`Error getting user status for ${userId}:`, error);
      return { online: false };
    }
  }

  /**
   * Block a user
   */
  async blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ success: boolean }> {
    // Prevent self-blocking
    if (blockerId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }

    // Check if user exists
    const { data: userExists, error: userError } = await this.supabaseService
      .from('profiles')
      .select('id')
      .eq('id', blockedId)
      .single();

    if (userError || !userExists) {
      throw new NotFoundException('User to block not found');
    }

    // Check if already blocked
    const { data: existingBlock } = await this.supabaseService
      .from('blocked_users')
      .select('id')
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId)
      .single();

    if (existingBlock) {
      this.logger.debug(`User ${blockedId} is already blocked by ${blockerId}`);
      return { success: true };
    }

    // Insert block record
    const { error } = await this.supabaseService.from('blocked_users').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });

    if (error) {
      this.logger.error('Error blocking user:', error.message);
      throw new Error('Failed to block user');
    }

    this.logger.log(`User ${blockerId} blocked user ${blockedId}`);
    return { success: true };
  }

  /**
   * Unblock a user
   */
  async unblockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ success: boolean }> {
    const { error } = await this.supabaseService
      .from('blocked_users')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);

    if (error) {
      this.logger.error('Error unblocking user:', error.message);
      throw new Error('Failed to unblock user');
    }

    this.logger.log(`User ${blockerId} unblocked user ${blockedId}`);
    return { success: true };
  }

  /**
   * Get list of users blocked by the current user
   */
  async getBlockedUsers(userId: string): Promise<UserProfile[]> {
    const { data, error } = await this.supabaseService
      .from('blocked_users')
      .select(
        `
        id,
        blocker_id,
        blocked_id,
        created_at,
        profiles:blocked_id(id, email, full_name, avatar_url, bio, created_at, updated_at)
      `,
      )
      .eq('blocker_id', userId);

    if (error) {
      this.logger.error('Error fetching blocked users:', error.message);
      throw new Error('Failed to fetch blocked users');
    }

    // Map the joined data to return user profiles
    const blockedUsers = (data as unknown as BlockedUserRecord[]) || [];
    return blockedUsers
      .map((record) => record.profiles)
      .filter((profile): profile is UserProfile => profile !== undefined);
  }

  /**
   * Get list of user IDs that are blocked or blocking the current user
   */
  private async getBlockedUserIds(userId: string): Promise<string[]> {
    // Get users that current user has blocked
    const { data: blocked } = await this.supabaseService
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', userId);

    // Get users that have blocked current user
    const { data: blocking } = await this.supabaseService
      .from('blocked_users')
      .select('blocker_id')
      .eq('blocked_id', userId);

    const blockedIds = (blocked || []).map((r) => r.blocked_id);
    const blockingIds = (blocking || []).map((r) => r.blocker_id);

    return [...new Set([...blockedIds, ...blockingIds])];
  }

  /**
   * Cache user profile in Redis
   */
  private async cacheUserProfile(profile: UserProfile): Promise<void> {
    const cacheKey = RedisKeys.user.profile(profile.id);
    const cacheData = {
      id: profile.id,
      email: profile.email || '',
      full_name: profile.full_name || '',
      avatar_url: profile.avatar_url || '',
      bio: profile.bio || '',
      created_at: profile.created_at || '',
      updated_at: profile.updated_at || '',
    };

    await this.redisService.hset(cacheKey, cacheData);
    // Set TTL for profile cache (1 hour)
    await this.redisService.expire(cacheKey, 3600);
  }

  /**
   * Map cached hash data to UserProfile
   */
  private mapCachedProfile(cached: Record<string, string>): UserProfile {
    return {
      id: cached.id,
      email: cached.email || undefined,
      full_name: cached.full_name || undefined,
      avatar_url: cached.avatar_url || undefined,
      bio: cached.bio || undefined,
      created_at: cached.created_at || undefined,
      updated_at: cached.updated_at || undefined,
    };
  }
}
