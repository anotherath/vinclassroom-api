import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import { MemberRole } from './dto/update-role.dto';

interface MemberActivity {
  userId: string;
  spaceId: string;
  lastActive: string;
  messageCount: number;
  joinDate: string;
}

interface MemberWithProfile {
  id: string;
  role: string;
  joined_at: string;
  user_id: string;
  profiles: {
    id: string;
    email: string;
    display_name: string;
    avatar_url: string;
    status: string;
    last_seen: string;
  };
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private supabaseService: SupabaseService,
    private redisService: RedisService,
  ) {}

  /**
   * Get all members in a space
   */
  async getSpaceMembers(spaceId: string): Promise<any[]> {
    // Check cache first
    const cacheKey = RedisKeys.space.members(spaceId);
    const cached = await this.redisService.smembers(cacheKey);

    const { data: members, error } = await this.supabaseService
      .from('space_members')
      .select(
        `
        id,
        role,
        joined_at,
        user_id,
        profiles!inner (
          id,
          email,
          display_name,
          avatar_url,
          status,
          last_seen
        )
      `,
      )
      .eq('space_id', spaceId);

    if (error) {
      this.logger.error(`Failed to get space members: ${error.message}`);
      throw new NotFoundException('Space not found');
    }

    // Cache member IDs
    if (members && members.length > 0) {
      const userIds = members.map((m) => m.user_id).filter(Boolean);
      if (userIds.length > 0) {
        await this.redisService.sadd(cacheKey, ...userIds);
      }
    }

    return (
      (members as unknown as MemberWithProfile[]).map((member) => ({
        id: member.profiles?.id,
        email: member.profiles?.email,
        displayName: member.profiles?.display_name,
        avatar: member.profiles?.avatar_url,
        status: member.profiles?.status,
        lastSeen: member.profiles?.last_seen,
        role: member.role,
        joinedAt: member.joined_at,
      })) || []
    );
  }

  /**
   * Search members in a space
   */
  async searchMembers(spaceId: string, query: string): Promise<any[]> {
    const { data: members, error } = await this.supabaseService
      .from('space_members')
      .select(
        `
        id,
        role,
        joined_at,
        user_id,
        profiles!inner (
          id,
          email,
          display_name,
          avatar_url,
          status
        )
      `,
      )
      .eq('space_id', spaceId)
      .or(`display_name.ilike.%${query}%,email.ilike.%${query}%`, {
        foreignTable: 'profiles',
      });

    if (error) {
      this.logger.error(`Failed to search members: ${error.message}`);
      return [];
    }

    return (
      (members as unknown as MemberWithProfile[]).map((member) => ({
        id: member.profiles?.id,
        email: member.profiles?.email,
        displayName: member.profiles?.display_name,
        avatar: member.profiles?.avatar_url,
        status: member.profiles?.status,
        role: member.role,
        joinedAt: member.joined_at,
      })) || []
    );
  }

  /**
   * Get member role
   */
  async getMemberRole(
    spaceId: string,
    userId: string,
  ): Promise<{ role: string }> {
    const { data: member, error } = await this.supabaseService
      .from('space_members')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .single();

    if (error || !member) {
      throw new NotFoundException('Member not found in this space');
    }

    return { role: member.role };
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    spaceId: string,
    userId: string,
    newRole: MemberRole,
    requestedBy: string,
  ): Promise<any> {
    // Check if requester has permission (owner or admin)
    const { data: requester, error: requesterError } =
      await this.supabaseService
        .from('space_members')
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', requestedBy)
        .single();

    if (requesterError || !requester) {
      throw new ForbiddenException('You are not a member of this space');
    }

    if (
      requester.role !== MemberRole.OWNER &&
      requester.role !== MemberRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only owners and admins can update member roles',
      );
    }

    // Cannot change owner's role unless you're the owner
    const { data: targetMember, error: targetError } =
      await this.supabaseService
        .from('space_members')
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', userId)
        .single();

    if (targetError || !targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (
      targetMember.role === MemberRole.OWNER &&
      requester.role !== MemberRole.OWNER
    ) {
      throw new ForbiddenException(
        "Only the owner can change the owner's role",
      );
    }

    // Update role
    const { data: updated, error } = await this.supabaseService
      .from('space_members')
      .update({ role: newRole })
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .select(
        `
        id,
        role,
        joined_at,
        profiles!inner (
          id,
          email,
          display_name,
          avatar_url
        )
      `,
      )
      .single();

    if (error) {
      this.logger.error(`Failed to update member role: ${error.message}`);
      throw new Error('Failed to update member role');
    }

    // Invalidate cache
    await this.redisService.del(RedisKeys.space.members(spaceId));

    const updatedMember = updated as unknown as MemberWithProfile;
    return {
      id: updatedMember.profiles?.id,
      email: updatedMember.profiles?.email,
      displayName: updatedMember.profiles?.display_name,
      avatar: updatedMember.profiles?.avatar_url,
      role: updatedMember.role,
      joinedAt: updatedMember.joined_at,
    };
  }

  /**
   * Get member activity
   */
  async getMemberActivity(
    spaceId: string,
    userId: string,
  ): Promise<MemberActivity> {
    // Try cache first
    const cacheKey = RedisKeys.memberActivity(spaceId, userId);
    const cached = await this.redisService.hgetall(cacheKey);

    if (cached && Object.keys(cached).length > 0) {
      return {
        userId,
        spaceId,
        lastActive: cached.lastActive,
        messageCount: parseInt(cached.messageCount, 10) || 0,
        joinDate: cached.joinDate,
      };
    }

    // Get from database
    const { data: member, error: memberError } = await this.supabaseService
      .from('space_members')
      .select('joined_at')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .single();

    if (memberError || !member) {
      throw new NotFoundException('Member not found');
    }

    // Get rooms in space first
    const { data: rooms, error: roomsError } = await this.supabaseService
      .from('rooms')
      .select('id')
      .eq('space_id', spaceId);

    if (roomsError) {
      this.logger.warn(`Failed to get rooms: ${roomsError.message}`);
    }

    let messageCount = 0;
    if (rooms && rooms.length > 0) {
      const roomIds = rooms.map((r) => r.id);
      const { count, error: countError } = await this.supabaseService
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('room_id', roomIds);

      if (countError) {
        this.logger.warn(`Failed to count messages: ${countError.message}`);
      }
      messageCount = count || 0;
    }

    const activity: MemberActivity = {
      userId,
      spaceId,
      lastActive: new Date().toISOString(),
      messageCount: messageCount,
      joinDate: member.joined_at,
    };

    // Cache for 1 hour
    await this.redisService.hset(cacheKey, {
      lastActive: activity.lastActive,
      messageCount: activity.messageCount.toString(),
      joinDate: activity.joinDate,
    });
    await this.redisService.expire(cacheKey, 3600);

    return activity;
  }

  /**
   * Remove member from space
   */
  async removeMember(
    spaceId: string,
    userId: string,
    requestedBy: string,
  ): Promise<void> {
    // Check if requester has permission
    const { data: requester, error: requesterError } =
      await this.supabaseService
        .from('space_members')
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', requestedBy)
        .single();

    if (requesterError || !requester) {
      throw new ForbiddenException('You are not a member of this space');
    }

    // Get target member
    const { data: targetMember, error: targetError } =
      await this.supabaseService
        .from('space_members')
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', userId)
        .single();

    if (targetError || !targetMember) {
      throw new NotFoundException('Member not found');
    }

    // Permission checks
    if (
      requester.role !== MemberRole.OWNER &&
      requester.role !== MemberRole.ADMIN
    ) {
      // Members can only remove themselves
      if (requestedBy !== userId) {
        throw new ForbiddenException('You can only remove yourself');
      }
    }

    if (targetMember.role === MemberRole.OWNER) {
      throw new ForbiddenException('Cannot remove the owner');
    }

    if (
      targetMember.role === MemberRole.ADMIN &&
      requester.role !== MemberRole.OWNER
    ) {
      throw new ForbiddenException('Only the owner can remove admins');
    }

    // Delete member
    const { error } = await this.supabaseService
      .from('space_members')
      .delete()
      .eq('space_id', spaceId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Failed to remove member: ${error.message}`);
      throw new Error('Failed to remove member');
    }

    // Invalidate caches
    await this.redisService.del(RedisKeys.space.members(spaceId));
    await this.redisService.del(RedisKeys.user.spaces(userId));
  }
}
