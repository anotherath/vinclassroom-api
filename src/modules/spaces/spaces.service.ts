import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService, RedisKeys } from '../../redis';
import {
  CreateSpaceDto,
  UpdateSpaceDto,
  AddMemberDto,
  MemberRole,
} from './dto';

interface Space {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  owner_id: string;
  is_private: boolean;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

interface SpaceMember {
  id: string;
  space_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

interface Room {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  type: string;
  is_private: boolean;
  created_at: string;
}

@Injectable()
export class SpacesService {
  private readonly logger = new Logger(SpacesService.name);
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Generate a random invite code
   */
  private generateRandomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Cache space metadata in Redis
   */
  private async cacheSpace(space: Space): Promise<void> {
    const key = RedisKeys.space.byId(space.id);
    await this.redis.hset(key, {
      id: space.id,
      name: space.name,
      description: space.description || '',
      icon_url: space.icon_url || '',
      owner_id: space.owner_id,
      is_private: String(space.is_private),
      invite_code: space.invite_code,
      created_at: space.created_at,
      updated_at: space.updated_at,
    });
    await this.redis.expire(key, this.CACHE_TTL);
  }

  /**
   * Get space from cache or database
   */
  private async getCachedSpace(spaceId: string): Promise<Space | null> {
    const key = RedisKeys.space.byId(spaceId);
    const cached = await this.redis.hgetall(key);

    if (cached && cached.id) {
      return {
        id: cached.id,
        name: cached.name,
        description: cached.description || null,
        icon_url: cached.icon_url || null,
        owner_id: cached.owner_id,
        is_private: cached.is_private === 'true',
        invite_code: cached.invite_code,
        created_at: cached.created_at,
        updated_at: cached.updated_at,
      };
    }

    return null;
  }

  /**
   * Invalidate space cache
   */
  private async invalidateSpaceCache(spaceId: string): Promise<void> {
    await this.redis.del(RedisKeys.space.byId(spaceId));
    await this.redis.del(RedisKeys.space.members(spaceId));
    await this.redis.del(RedisKeys.space.rooms(spaceId));
  }

  /**
   * Invalidate user's spaces cache
   */
  private async invalidateUserSpacesCache(userId: string): Promise<void> {
    await this.redis.del(RedisKeys.user.spaces(userId));
  }

  /**
   * Check if user has admin/owner permissions in space
   */
  private async hasAdminPermission(
    spaceId: string,
    userId: string,
  ): Promise<boolean> {
    const space = await this.getSpaceById(spaceId);
    if (space.owner_id === userId) return true;

    const { data: member } = await this.supabase
      .from('space_members')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .single();

    return member?.role === MemberRole.ADMIN;
  }

  /**
   * Check if user is a member of the space
   */
  private async isMember(spaceId: string, userId: string): Promise<boolean> {
    const membersKey = RedisKeys.space.members(spaceId);
    const isMemberInCache = await this.redis.sismember(membersKey, userId);

    if (isMemberInCache) return true;

    const { data: member } = await this.supabase
      .from('space_members')
      .select('id')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (member) {
      await this.redis.sadd(membersKey, userId);
      await this.redis.expire(membersKey, this.CACHE_TTL);
    }

    return !!member;
  }

  /**
   * Create a new space
   */
  async createSpace(
    userId: string,
    dto: CreateSpaceDto,
  ): Promise<Space> {
    const inviteCode = this.generateRandomCode();

    const { data: space, error } = await this.supabase
      .from('spaces')
      .insert({
        name: dto.name,
        description: dto.description || null,
        icon_url: dto.icon || null,
        owner_id: userId,
        is_private: dto.isPrivate ?? false,
        invite_code: inviteCode,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create space:', error.message);
      throw new ConflictException('Failed to create space');
    }

    // Add owner as admin member
    await this.supabase.from('space_members').insert({
      space_id: space.id,
      user_id: userId,
      role: MemberRole.ADMIN,
    });

    // Cache the space
    await this.cacheSpace(space);
    await this.redis.sadd(RedisKeys.space.members(space.id), userId);

    // Invalidate user's spaces cache
    await this.invalidateUserSpacesCache(userId);

    this.logger.log(`Space created: ${space.id} by user: ${userId}`);
    return space;
  }

  /**
   * Get all spaces that user is a member of
   */
  async getUserSpaces(userId: string): Promise<Space[]> {
    const cacheKey = RedisKeys.user.spaces(userId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const { data: memberships, error } = await this.supabase
      .from('space_members')
      .select('space_id')
      .eq('user_id', userId);

    if (error || !memberships || memberships.length === 0) {
      return [];
    }

    const spaceIds = memberships.map((m) => m.space_id);

    const { data: spaces, error: spacesError } = await this.supabase
      .from('spaces')
      .select('*')
      .in('id', spaceIds);

    if (spacesError || !spaces) {
      return [];
    }

    // Cache spaces
    for (const space of spaces) {
      await this.cacheSpace(space);
    }

    // Cache user's spaces list
    await this.redis.set(cacheKey, JSON.stringify(spaces), this.CACHE_TTL);

    return spaces;
  }

  /**
   * Get space by ID
   */
  async getSpaceById(spaceId: string): Promise<Space> {
    // Try cache first
    const cached = await this.getCachedSpace(spaceId);
    if (cached) return cached;

    const { data: space, error } = await this.supabase
      .from('spaces')
      .select('*')
      .eq('id', spaceId)
      .single();

    if (error || !space) {
      throw new NotFoundException('Space not found');
    }

    // Cache the space
    await this.cacheSpace(space);

    return space;
  }

  /**
   * Update space
   */
  async updateSpace(
    spaceId: string,
    userId: string,
    dto: UpdateSpaceDto,
  ): Promise<Space> {
    // Check permission (owner or admin)
    const hasPermission = await this.hasAdminPermission(spaceId, userId);
    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions to update space');
    }

    const { data: space, error } = await this.supabase
      .from('spaces')
      .update({
        name: dto.name,
        description: dto.description,
        icon_url: dto.icon,
        is_private: dto.isPrivate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', spaceId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update space:', error.message);
      throw new ConflictException('Failed to update space');
    }

    // Update cache
    await this.cacheSpace(space);
    await this.invalidateUserSpacesCache(userId);

    this.logger.log(`Space updated: ${spaceId} by user: ${userId}`);
    return space;
  }

  /**
   * Delete space
   */
  async deleteSpace(spaceId: string, userId: string): Promise<void> {
    const space = await this.getSpaceById(spaceId);

    // Only owner can delete space
    if (space.owner_id !== userId) {
      throw new ForbiddenException('Only owner can delete space');
    }

    const { error } = await this.supabase
      .from('spaces')
      .delete()
      .eq('id', spaceId);

    if (error) {
      this.logger.error('Failed to delete space:', error.message);
      throw new ConflictException('Failed to delete space');
    }

    // Invalidate caches
    await this.invalidateSpaceCache(spaceId);

    // Get all members to invalidate their caches
    const { data: members } = await this.supabase
      .from('space_members')
      .select('user_id')
      .eq('space_id', spaceId);

    if (members) {
      for (const member of members) {
        await this.invalidateUserSpacesCache(member.user_id);
      }
    }

    this.logger.log(`Space deleted: ${spaceId} by user: ${userId}`);
  }

  /**
   * Search public spaces
   */
  async searchSpaces(query: string): Promise<Space[]> {
    const { data: spaces, error } = await this.supabase
      .from('spaces')
      .select('*')
      .eq('is_private', false)
      .ilike('name', `%${query}%`)
      .limit(20);

    if (error || !spaces) {
      return [];
    }

    return spaces;
  }

  /**
   * Add member to space
   */
  async addMember(
    spaceId: string,
    dto: AddMemberDto,
  ): Promise<SpaceMember> {
    // Check if space exists
    await this.getSpaceById(spaceId);

    // Check if user is already a member
    const isAlreadyMember = await this.isMember(spaceId, dto.userId);
    if (isAlreadyMember) {
      throw new ConflictException('User is already a member of this space');
    }

    const { data: member, error } = await this.supabase
      .from('space_members')
      .insert({
        space_id: spaceId,
        user_id: dto.userId,
        role: dto.role || MemberRole.MEMBER,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to add member:', error.message);
      throw new ConflictException('Failed to add member');
    }

    // Update cache
    await this.redis.sadd(RedisKeys.space.members(spaceId), dto.userId);
    await this.invalidateUserSpacesCache(dto.userId);

    this.logger.log(`Member added to space: ${spaceId}, user: ${dto.userId}`);
    return member;
  }

  /**
   * Remove member from space
   */
  async removeMember(spaceId: string, userId: string): Promise<void> {
    const space = await this.getSpaceById(spaceId);

    // Owner cannot be removed
    if (space.owner_id === userId) {
      throw new ForbiddenException('Owner cannot be removed from space');
    }

    const { error } = await this.supabase
      .from('space_members')
      .delete()
      .eq('space_id', spaceId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error('Failed to remove member:', error.message);
      throw new ConflictException('Failed to remove member');
    }

    // Update cache
    await this.redis.srem(RedisKeys.space.members(spaceId), userId);
    await this.invalidateUserSpacesCache(userId);

    this.logger.log(`Member removed from space: ${spaceId}, user: ${userId}`);
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    spaceId: string,
    userId: string,
    role: MemberRole,
  ): Promise<SpaceMember> {
    const { data: member, error } = await this.supabase
      .from('space_members')
      .update({ role })
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update member role:', error.message);
      throw new NotFoundException('Member not found');
    }

    this.logger.log(`Member role updated: ${spaceId}, user: ${userId}, role: ${role}`);
    return member;
  }

  /**
   * Get all members of a space
   */
  async getSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
    const { data: members, error } = await this.supabase
      .from('space_members')
      .select('*')
      .eq('space_id', spaceId);

    if (error || !members) {
      return [];
    }

    return members;
  }

  /**
   * Generate new invite code for space
   */
  async generateInviteCode(spaceId: string): Promise<string> {
    const newCode = this.generateRandomCode();

    const { error } = await this.supabase
      .from('spaces')
      .update({ invite_code: newCode })
      .eq('id', spaceId);

    if (error) {
      this.logger.error('Failed to generate invite code:', error.message);
      throw new ConflictException('Failed to generate invite code');
    }

    // Update cache
    const space = await this.getSpaceById(spaceId);
    await this.cacheSpace({ ...space, invite_code: newCode });

    this.logger.log(`Invite code generated for space: ${spaceId}`);
    return newCode;
  }

  /**
   * Join space by invite code
   */
  async joinByInviteCode(
    code: string,
    userId: string,
  ): Promise<Space> {
    const { data: space, error } = await this.supabase
      .from('spaces')
      .select('*')
      .eq('invite_code', code)
      .single();

    if (error || !space) {
      throw new NotFoundException('Invalid invite code');
    }

    // Check if already a member
    const isAlreadyMember = await this.isMember(space.id, userId);
    if (isAlreadyMember) {
      throw new ConflictException('You are already a member of this space');
    }

    // Add as member
    await this.supabase.from('space_members').insert({
      space_id: space.id,
      user_id: userId,
      role: MemberRole.MEMBER,
    });

    // Update cache
    await this.redis.sadd(RedisKeys.space.members(space.id), userId);
    await this.cacheSpace(space);
    await this.invalidateUserSpacesCache(userId);

    this.logger.log(`User joined space: ${space.id}, user: ${userId}`);
    return space;
  }

  /**
   * Leave space
   */
  async leaveSpace(spaceId: string, userId: string): Promise<void> {
    const space = await this.getSpaceById(spaceId);

    // Owner cannot leave (must transfer ownership or delete)
    if (space.owner_id === userId) {
      throw new ForbiddenException(
        'Owner cannot leave space. Transfer ownership or delete the space.',
      );
    }

    const { error } = await this.supabase
      .from('space_members')
      .delete()
      .eq('space_id', spaceId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error('Failed to leave space:', error.message);
      throw new ConflictException('Failed to leave space');
    }

    // Update cache
    await this.redis.srem(RedisKeys.space.members(spaceId), userId);
    await this.invalidateUserSpacesCache(userId);

    this.logger.log(`User left space: ${spaceId}, user: ${userId}`);
  }

  /**
   * Get rooms in a space
   */
  async getSpaceRooms(spaceId: string): Promise<Room[]> {
    const cacheKey = RedisKeys.space.rooms(spaceId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const { data: rooms, error } = await this.supabase
      .from('rooms')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: true });

    if (error || !rooms) {
      return [];
    }

    // Cache rooms
    await this.redis.set(cacheKey, JSON.stringify(rooms), this.CACHE_TTL);

    return rooms;
  }
}
