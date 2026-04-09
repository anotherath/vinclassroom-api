import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import { CreateRoomDto, UpdateRoomDto, AddRoomMemberDto } from './dto';

interface Room {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  type: 'text' | 'voice';
  is_private: boolean;
  created_by: string;
  created_at: string;
}

interface RoomMember {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
}

interface RoomStats {
  memberCount: number;
  messageCount: number;
  lastActivity: string | null;
}

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);
  private readonly ROOM_CACHE_TTL = 3600; // 1 hour
  private readonly ROOM_MEMBERS_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Create a new room in a space
   */
  async createRoom(
    spaceId: string,
    userId: string,
    dto: CreateRoomDto,
  ): Promise<Room> {
    // Check if user is a member of the space
    const isSpaceMember = await this.isSpaceMember(spaceId, userId);
    if (!isSpaceMember) {
      throw new ForbiddenException('You are not a member of this space');
    }

    // Create room in database
    const { data: room, error } = await this.supabaseService
      .from('rooms')
      .insert({
        space_id: spaceId,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        is_private: dto.isPrivate,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create room:', error.message);
      throw new ConflictException('Failed to create room');
    }

    // Add creator as room member
    await this.supabaseService.from('room_members').insert({
      room_id: room.id,
      user_id: userId,
    });

    // Cache room data
    await this.cacheRoom(room);

    // Add to space rooms set
    await this.redisService.sadd(RedisKeys.space.rooms(spaceId), room.id);

    // Add creator to room members set
    await this.redisService.sadd(RedisKeys.room.members(room.id), userId);

    this.logger.log(`Room ${room.id} created in space ${spaceId}`);
    return room;
  }

  /**
   * Get room by ID
   */
  async getRoomById(roomId: string): Promise<Room> {
    // Try cache first
    const cached = await this.getCachedRoom(roomId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const { data: room, error } = await this.supabaseService
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (error || !room) {
      throw new NotFoundException('Room not found');
    }

    // Cache the result
    await this.cacheRoom(room);

    return room;
  }

  /**
   * Update room
   */
  async updateRoom(
    roomId: string,
    userId: string,
    dto: UpdateRoomDto,
  ): Promise<Room> {
    const room = await this.getRoomById(roomId);

    // Check permission: only room creator or space admin can update
    const canModify = await this.canModifyRoom(room, userId);
    if (!canModify) {
      throw new ForbiddenException('You do not have permission to update this room');
    }

    const { data: updatedRoom, error } = await this.supabaseService
      .from('rooms')
      .update({
        name: dto.name,
        description: dto.description,
        type: dto.type,
        is_private: dto.isPrivate,
      })
      .eq('id', roomId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update room:', error.message);
      throw new ConflictException('Failed to update room');
    }

    // Update cache
    await this.cacheRoom(updatedRoom);

    this.logger.log(`Room ${roomId} updated`);
    return updatedRoom;
  }

  /**
   * Delete room
   */
  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomById(roomId);

    // Check permission: only room creator or space admin can delete
    const canModify = await this.canModifyRoom(room, userId);
    if (!canModify) {
      throw new ForbiddenException('You do not have permission to delete this room');
    }

    // Delete from database (cascade will handle room_members)
    const { error } = await this.supabaseService
      .from('rooms')
      .delete()
      .eq('id', roomId);

    if (error) {
      this.logger.error('Failed to delete room:', error.message);
      throw new ConflictException('Failed to delete room');
    }

    // Clear caches
    await this.clearRoomCache(roomId);
    await this.redisService.srem(RedisKeys.space.rooms(room.space_id), roomId);

    this.logger.log(`Room ${roomId} deleted`);
  }

  /**
   * Get all rooms in a space
   */
  async getSpaceRooms(spaceId: string, userId?: string): Promise<Room[]> {
    let query = this.supabaseService
      .from('rooms')
      .select('*')
      .eq('space_id', spaceId);

    // If user provided, filter private rooms
    if (userId) {
      // Get rooms that are either public or user is a member of
      const { data: memberRooms } = await this.supabaseService
        .from('room_members')
        .select('room_id')
        .eq('user_id', userId);

      const memberRoomIds = memberRooms?.map((m) => m.room_id) || [];

      query = query.or(
        `is_private.eq.false,id.in.(${memberRoomIds.join(',')})`,
      );
    } else {
      // Only public rooms for anonymous
      query = query.eq('is_private', false);
    }

    const { data: rooms, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch space rooms:', error.message);
      throw new ConflictException('Failed to fetch rooms');
    }

    // Cache rooms
    for (const room of rooms || []) {
      await this.cacheRoom(room);
    }

    return rooms || [];
  }

  /**
   * Get room members
   */
  async getRoomMembers(roomId: string): Promise<string[]> {
    // Try cache first
    const cached = await this.redisService.smembers(
      RedisKeys.room.members(roomId),
    );
    if (cached && cached.length > 0) {
      return cached;
    }

    // Fetch from database
    const { data: members, error } = await this.supabaseService
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId);

    if (error) {
      this.logger.error('Failed to fetch room members:', error.message);
      throw new ConflictException('Failed to fetch room members');
    }

    const userIds = members?.map((m) => m.user_id) || [];

    // Cache members
    if (userIds.length > 0) {
      await this.redisService.sadd(RedisKeys.room.members(roomId), ...userIds);
      await this.redisService.expire(
        RedisKeys.room.members(roomId),
        this.ROOM_MEMBERS_CACHE_TTL,
      );
    }

    return userIds;
  }

  /**
   * Add member to room
   */
  async addRoomMember(
    roomId: string,
    spaceId: string,
    dto: AddRoomMemberDto,
  ): Promise<void> {
    // Check if user is a member of the space
    const isSpaceMember = await this.isSpaceMember(spaceId, dto.userId);
    if (!isSpaceMember) {
      throw new ForbiddenException('User is not a member of this space');
    }

    // Check if already a room member
    const isRoomMember = await this.isRoomMember(roomId, dto.userId);
    if (isRoomMember) {
      throw new ConflictException('User is already a member of this room');
    }

    // Add to database
    const { error } = await this.supabaseService.from('room_members').insert({
      room_id: roomId,
      user_id: dto.userId,
    });

    if (error) {
      this.logger.error('Failed to add room member:', error.message);
      throw new ConflictException('Failed to add room member');
    }

    // Update cache
    await this.redisService.sadd(RedisKeys.room.members(roomId), dto.userId);

    this.logger.log(`User ${dto.userId} added to room ${roomId}`);
  }

  /**
   * Remove member from room
   */
  async removeRoomMember(roomId: string, userId: string): Promise<void> {
    // Check if user is a room member
    const isRoomMember = await this.isRoomMember(roomId, userId);
    if (!isRoomMember) {
      throw new NotFoundException('User is not a member of this room');
    }

    // Remove from database
    const { error } = await this.supabaseService
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error('Failed to remove room member:', error.message);
      throw new ConflictException('Failed to remove room member');
    }

    // Update cache
    await this.redisService.srem(RedisKeys.room.members(roomId), userId);

    this.logger.log(`User ${userId} removed from room ${roomId}`);
  }

  /**
   * Get room statistics
   */
  async getRoomStats(roomId: string): Promise<RoomStats> {
    // Try cache first
    const cached = await this.redisService.hgetall(RedisKeys.room.stats(roomId));
    if (cached && Object.keys(cached).length > 0) {
      return {
        memberCount: parseInt(cached.memberCount, 10) || 0,
        messageCount: parseInt(cached.messageCount, 10) || 0,
        lastActivity: cached.lastActivity || null,
      };
    }

    // Get member count
    const members = await this.getRoomMembers(roomId);
    const memberCount = members.length;

    // Get message count from database
    const { count: messageCount, error: countError } = await this.supabaseService
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomId);

    if (countError) {
      this.logger.error('Failed to get message count:', countError.message);
    }

    // Get last activity
    const { data: lastMessage, error: lastError } = await this.supabaseService
      .from('messages')
      .select('created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lastError && lastError.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      this.logger.error('Failed to get last activity:', lastError.message);
    }

    const stats: RoomStats = {
      memberCount,
      messageCount: messageCount || 0,
      lastActivity: lastMessage?.created_at || null,
    };

    // Cache stats
    await this.redisService.hset(RedisKeys.room.stats(roomId), {
      memberCount: String(stats.memberCount),
      messageCount: String(stats.messageCount),
      lastActivity: stats.lastActivity || '',
    });
    await this.redisService.expire(
      RedisKeys.room.stats(roomId),
      this.ROOM_MEMBERS_CACHE_TTL,
    );

    return stats;
  }

  /**
   * Check if user is a space member
   */
  private async isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
    // Try cache first
    const cached = await this.redisService.sismember(
      RedisKeys.space.members(spaceId),
      userId,
    );
    if (cached) {
      return true;
    }

    // Check database
    const { data, error } = await this.supabaseService
      .from('space_members')
      .select('id')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .single();

    return !error && !!data;
  }

  /**
   * Check if user is a room member
   */
  private async isRoomMember(roomId: string, userId: string): Promise<boolean> {
    // Try cache first
    const cached = await this.redisService.sismember(
      RedisKeys.room.members(roomId),
      userId,
    );
    if (cached) {
      return true;
    }

    // Check database
    const { data, error } = await this.supabaseService
      .from('room_members')
      .select('id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .single();

    return !error && !!data;
  }

  /**
   * Check if user can modify room (creator or space admin)
   */
  private async canModifyRoom(room: Room, userId: string): Promise<boolean> {
    // Room creator can always modify
    if (room.created_by === userId) {
      return true;
    }

    // Check if user is space admin
    const { data: spaceMember } = await this.supabaseService
      .from('space_members')
      .select('role')
      .eq('space_id', room.space_id)
      .eq('user_id', userId)
      .single();

    return spaceMember?.role === 'admin';
  }

  /**
   * Cache room data
   */
  private async cacheRoom(room: Room): Promise<void> {
    await this.redisService.hset(RedisKeys.room.byId(room.id), {
      id: room.id,
      space_id: room.space_id,
      name: room.name,
      description: room.description || '',
      type: room.type,
      is_private: String(room.is_private),
      created_by: room.created_by,
      created_at: room.created_at,
    });
    await this.redisService.expire(
      RedisKeys.room.byId(room.id),
      this.ROOM_CACHE_TTL,
    );
  }

  /**
   * Get cached room data
   */
  private async getCachedRoom(roomId: string): Promise<Room | null> {
    const cached = await this.redisService.hgetall(RedisKeys.room.byId(roomId));
    if (!cached || Object.keys(cached).length === 0) {
      return null;
    }

    return {
      id: cached.id,
      space_id: cached.space_id,
      name: cached.name,
      description: cached.description || null,
      type: cached.type as 'text' | 'voice',
      is_private: cached.is_private === 'true',
      created_by: cached.created_by,
      created_at: cached.created_at,
    };
  }

  /**
   * Clear room cache
   */
  private async clearRoomCache(roomId: string): Promise<void> {
    await this.redisService.del(RedisKeys.room.byId(roomId));
    await this.redisService.del(RedisKeys.room.members(roomId));
    await this.redisService.del(RedisKeys.room.stats(roomId));
  }
}
