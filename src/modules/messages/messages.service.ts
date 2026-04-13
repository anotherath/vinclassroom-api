import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import {
  CreateMessageDto,
  UpdateMessageDto,
  AddReactionDto,
  QueryMessagesDto,
} from './dto';

interface Message {
  id: string;
  room_id: string;
  user_id: string;
  content: string;
  reply_to_id: string | null;
  is_pinned: boolean;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MessageWithAuthor extends Message {
  author: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
  reply_to?: MessageWithAuthor | null;
  reactions?: Reaction[];
}

interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user?: {
    id: string;
    display_name: string;
  };
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly MESSAGE_CACHE_TTL = 3600; // 1 hour
  private readonly RECENT_MESSAGES_LIMIT = 50;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  // ==================== WebSocket Event Helpers ====================

  /**
   * Publish message event to Redis for WebSocket broadcast
   */
  private async publishMessageEvent(
    event: string,
    roomId: string,
    data: any,
  ): Promise<void> {
    try {
      const channel = RedisKeys.channel.room(roomId);
      await this.redisService.publish(
        channel,
        JSON.stringify({ event, data, timestamp: new Date().toISOString() }),
      );
    } catch (error) {
      this.logger.error(`Failed to publish message event: ${error.message}`);
    }
  }

  /**
   * Send a message to a room
   */
  async createMessage(
    roomId: string,
    userId: string,
    dto: CreateMessageDto,
  ): Promise<MessageWithAuthor> {
    // Check if user is a member of the room
    const isMember = await this.isRoomMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    // Validate reply_to_id if provided
    if (dto.replyToId) {
      const parentMessage = await this.getMessageById(dto.replyToId);
      if (parentMessage.room_id !== roomId) {
        throw new BadRequestException('Reply message must be in the same room');
      }
    }

    // Create message in database
    const { data: message, error } = await this.supabaseService
      .from('messages')
      .insert({
        room_id: roomId,
        user_id: userId,
        content: dto.content,
        reply_to_id: dto.replyToId || null,
      })
      .select(
        `*, author:profiles!messages_user_id_fkey ( id, display_name, avatar_url )`,
      )
      .single();

    if (error) {
      this.logger.error('Failed to create message:', error.message);
      throw new ConflictException('Failed to create message');
    }

    // Cache the message
    await this.cacheMessage(message);

    // Add to room's recent messages list (Redis sorted set)
    const messageKey = RedisKeys.message.byId(message.id);
    await this.redisService.zadd(
      RedisKeys.room.messages(roomId),
      new Date(message.created_at).getTime(),
      messageKey,
    );

    // Trim to keep only recent messages
    await this.redisService.zremrangebyrank(
      RedisKeys.room.messages(roomId),
      0,
      -this.RECENT_MESSAGES_LIMIT - 1,
    );

    // Update room stats
    await this.redisService.hincrby(
      RedisKeys.room.stats(roomId),
      'messageCount',
      1,
    );

    // Handle mentions
    if (dto.mentions && dto.mentions.length > 0) {
      await this.processMentions(message.id, roomId, userId, dto.mentions);
    }

    // Publish real-time event
    const messageWithAuthor = this.transformMessageWithAuthor(message);
    await this.publishMessageEvent('newMessage', roomId, messageWithAuthor);

    this.logger.log(`Message ${message.id} created in room ${roomId}`);
    return messageWithAuthor;
  }

  /**
   * Get messages in a room
   */
  async getRoomMessages(
    roomId: string,
    userId: string,
    query: QueryMessagesDto,
  ): Promise<{
    messages: MessageWithAuthor[];
    total: number;
    hasMore: boolean;
  }> {
    // Check if user is a member of the room
    const isMember = await this.isRoomMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const { page = 1, limit = 20, before, after, search } = query;
    const offset = (page - 1) * limit;

    // Build query
    let dbQuery = this.supabaseService
      .from('messages')
      .select(
        `*, author:profiles!messages_user_id_fkey ( id, display_name, avatar_url )`,
        { count: 'exact' },
      )
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply cursor pagination if provided
    if (before) {
      const beforeMessage = await this.getMessageById(before);
      dbQuery = dbQuery.lt('created_at', beforeMessage.created_at);
    }

    if (after) {
      const afterMessage = await this.getMessageById(after);
      dbQuery = dbQuery.gt('created_at', afterMessage.created_at);
    }

    // Apply search filter
    if (search) {
      dbQuery = dbQuery.ilike('content', `%${search}%`);
    }

    const { data: messages, error, count } = await dbQuery;

    if (error) {
      this.logger.error('Failed to fetch messages:', error.message);
      throw new ConflictException('Failed to fetch messages');
    }

    // Fetch reactions for messages
    const messageIds = messages?.map((m) => m.id) || [];
    const reactions = await this.getReactionsForMessages(messageIds);

    // Transform and return
    const transformedMessages = (messages || [])
      .map((msg) => this.transformMessageWithAuthor(msg))
      .map((msg) => ({
        ...msg,
        reactions: reactions.filter((r) => r.message_id === msg.id),
      }));

    return {
      messages: transformedMessages,
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Get a single message by ID
   */
  async getMessageById(messageId: string): Promise<Message> {
    // Try cache first
    const cached = await this.getCachedMessage(messageId);
    if (cached) {
      return cached;
    }

    const { data: message, error } = await this.supabaseService
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (error || !message) {
      throw new NotFoundException('Message not found');
    }

    await this.cacheMessage(message);
    return message;
  }

  /**
   * Get message with details
   */
  async getMessageWithDetails(messageId: string): Promise<MessageWithAuthor> {
    const { data: message, error } = await this.supabaseService
      .from('messages')
      .select(
        `*, author:profiles!messages_user_id_fkey ( id, display_name, avatar_url )`,
      )
      .eq('id', messageId)
      .single();

    if (error || !message) {
      throw new NotFoundException('Message not found');
    }

    const reactions = await this.getReactionsForMessages([messageId]);

    return {
      ...this.transformMessageWithAuthor(message),
      reactions: reactions.filter((r) => r.message_id === messageId),
    };
  }

  /**
   * Update a message
   */
  async updateMessage(
    messageId: string,
    userId: string,
    dto: UpdateMessageDto,
  ): Promise<MessageWithAuthor> {
    const message = await this.getMessageById(messageId);

    // Check ownership
    if (message.user_id !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    // Check if message is deleted
    if (message.deleted_at) {
      throw new ForbiddenException('Cannot edit deleted messages');
    }

    // Store edit history in Redis
    const editHistoryKey = RedisKeys.message.editHistory(messageId);
    await this.redisService.lpush(
      editHistoryKey,
      JSON.stringify({
        content: message.content,
        edited_at: new Date().toISOString(),
      }),
    );
    await this.redisService.expire(editHistoryKey, this.MESSAGE_CACHE_TTL);

    // Update message
    const { data: updatedMessage, error } = await this.supabaseService
      .from('messages')
      .update({
        content: dto.content,
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .select(
        `*, author:profiles!messages_user_id_fkey ( id, display_name, avatar_url )`,
      )
      .single();

    if (error) {
      this.logger.error('Failed to update message:', error.message);
      throw new ConflictException('Failed to update message');
    }

    // Update cache
    await this.cacheMessage(updatedMessage);

    // Publish real-time event
    const updatedWithAuthor = this.transformMessageWithAuthor(updatedMessage);
    await this.publishMessageEvent('messageUpdated', message.room_id, updatedWithAuthor);

    this.logger.log(`Message ${messageId} updated`);
    return updatedWithAuthor;
  }

  /**
   * Delete a message (soft delete)
   */
  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.getMessageById(messageId);

    // Check ownership
    if (message.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    // Soft delete
    const { error } = await this.supabaseService
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        content: '[deleted]',
      })
      .eq('id', messageId);

    if (error) {
      this.logger.error('Failed to delete message:', error.message);
      throw new ConflictException('Failed to delete message');
    }

    // Update cache with deleted status
    await this.redisService.hset(RedisKeys.message.byId(messageId), {
      id: message.id,
      room_id: message.room_id,
      user_id: message.user_id,
      content: '[deleted]',
      reply_to_id: message.reply_to_id || '',
      is_pinned: String(message.is_pinned),
      is_edited: String(message.is_edited),
      created_at: message.created_at,
      updated_at: message.updated_at,
      deleted_at: new Date().toISOString(),
    });

    // Publish real-time event
    await this.publishMessageEvent('messageDeleted', message.room_id, {
      messageId,
      roomId: message.room_id,
      deletedAt: new Date().toISOString(),
    });

    this.logger.log(`Message ${messageId} deleted`);
  }

  /**
   * Get thread replies
   */
  async getThreadReplies(
    parentId: string,
    userId: string,
    query: QueryMessagesDto,
  ): Promise<{
    messages: MessageWithAuthor[];
    total: number;
    hasMore: boolean;
  }> {
    const parentMessage = await this.getMessageById(parentId);

    // Check if user is a member of the room
    const isMember = await this.isRoomMember(parentMessage.room_id, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const { page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    const {
      data: replies,
      error,
      count,
    } = await this.supabaseService
      .from('messages')
      .select(
        `*, author:profiles!messages_user_id_fkey ( id, display_name, avatar_url )`,
        { count: 'exact' },
      )
      .eq('reply_to_id', parentId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error('Failed to fetch thread replies:', error.message);
      throw new ConflictException('Failed to fetch thread replies');
    }

    // Cache reply count in Redis
    await this.redisService.set(
      RedisKeys.message.replyCount(parentId),
      String(count || 0),
      this.MESSAGE_CACHE_TTL,
    );

    return {
      messages: (replies || []).map((msg) =>
        this.transformMessageWithAuthor(msg),
      ),
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Pin a message
   */
  async pinMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.getMessageById(messageId);

    // Check if user can pin (room admin or message owner)
    const canPin = await this.canModerateRoom(message.room_id, userId);
    if (!canPin) {
      throw new ForbiddenException(
        'You do not have permission to pin messages',
      );
    }

    const { error } = await this.supabaseService
      .from('messages')
      .update({ is_pinned: true })
      .eq('id', messageId);

    if (error) {
      this.logger.error('Failed to pin message:', error.message);
      throw new ConflictException('Failed to pin message');
    }

    // Add to pinned set
    await this.redisService.sadd(
      RedisKeys.room.pinned(message.room_id),
      messageId,
    );

    this.logger.log(`Message ${messageId} pinned`);
  }

  /**
   * Unpin a message
   */
  async unpinMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.getMessageById(messageId);

    const canPin = await this.canModerateRoom(message.room_id, userId);
    if (!canPin) {
      throw new ForbiddenException(
        'You do not have permission to unpin messages',
      );
    }

    const { error } = await this.supabaseService
      .from('messages')
      .update({ is_pinned: false })
      .eq('id', messageId);

    if (error) {
      this.logger.error('Failed to unpin message:', error.message);
      throw new ConflictException('Failed to unpin message');
    }

    // Remove from pinned set
    await this.redisService.srem(
      RedisKeys.room.pinned(message.room_id),
      messageId,
    );

    this.logger.log(`Message ${messageId} unpinned`);
  }

  /**
   * Get pinned messages in a room
   */
  async getPinnedMessages(
    roomId: string,
    userId: string,
  ): Promise<MessageWithAuthor[]> {
    const isMember = await this.isRoomMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const { data: messages, error } = await this.supabaseService
      .from('messages')
      .select(
        `*, author:profiles!messages_user_id_fkey ( id, display_name, avatar_url )`,
      )
      .eq('room_id', roomId)
      .eq('is_pinned', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch pinned messages:', error.message);
      throw new ConflictException('Failed to fetch pinned messages');
    }

    return (messages || []).map((msg) => this.transformMessageWithAuthor(msg));
  }

  /**
   * Add reaction to a message
   */
  async addReaction(
    messageId: string,
    userId: string,
    dto: AddReactionDto,
  ): Promise<Reaction> {
    const message = await this.getMessageById(messageId);

    // Check if user is a member of the room
    const isMember = await this.isRoomMember(message.room_id, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    // Check if reaction already exists
    const { data: existing } = await this.supabaseService
      .from('reactions')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', dto.emoji)
      .single();

    if (existing) {
      throw new ConflictException('You have already reacted with this emoji');
    }

    const { data: reaction, error } = await this.supabaseService
      .from('reactions')
      .insert({
        message_id: messageId,
        user_id: userId,
        emoji: dto.emoji,
      })
      .select(`*, user:profiles!reactions_user_id_fkey ( id, display_name )`)
      .single();

    if (error) {
      this.logger.error('Failed to add reaction:', error.message);
      throw new ConflictException('Failed to add reaction');
    }

    // Cache reaction
    await this.redisService.sadd(
      RedisKeys.reaction.byMessage(messageId),
      JSON.stringify({ emoji: dto.emoji, user_id: userId }),
    );

    // Publish real-time event
    await this.publishMessageEvent('reactionAdded', message.room_id, {
      reaction: reaction as Reaction,
      messageId,
    });

    this.logger.log(`Reaction added to message ${messageId}`);
    return reaction as Reaction;
  }

  /**
   * Remove reaction from a message
   */
  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    const message = await this.getMessageById(messageId);

    const isMember = await this.isRoomMember(message.room_id, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const { error } = await this.supabaseService
      .from('reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);

    if (error) {
      this.logger.error('Failed to remove reaction:', error.message);
      throw new ConflictException('Failed to remove reaction');
    }

    // Update cache
    await this.redisService.srem(
      RedisKeys.reaction.byMessage(messageId),
      JSON.stringify({ emoji, user_id: userId }),
    );

    // Publish real-time event
    await this.publishMessageEvent('reactionRemoved', message.room_id, {
      messageId,
      userId,
      emoji,
      removedAt: new Date().toISOString(),
    });

    this.logger.log(`Reaction removed from message ${messageId}`);
  }

  /**
   * Get reactions for multiple messages
   */
  private async getReactionsForMessages(
    messageIds: string[],
  ): Promise<Reaction[]> {
    if (messageIds.length === 0) return [];

    const { data: reactions, error } = await this.supabaseService
      .from('reactions')
      .select(`*, user:profiles!reactions_user_id_fkey ( id, display_name )`)
      .in('message_id', messageIds);

    if (error) {
      this.logger.error('Failed to fetch reactions:', error.message);
      return [];
    }

    return (reactions || []) as Reaction[];
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

    const { data, error } = await this.supabaseService
      .from('room_members')
      .select('id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .single();

    return !error && !!data;
  }

  /**
   * Check if user can moderate room
   */
  private async canModerateRoom(
    roomId: string,
    userId: string,
  ): Promise<boolean> {
    // Get room to find space
    const { data: room } = await this.supabaseService
      .from('rooms')
      .select('space_id')
      .eq('id', roomId)
      .single();

    if (!room) return false;

    // Check if user is space admin/owner
    const { data: member } = await this.supabaseService
      .from('space_members')
      .select('role')
      .eq('space_id', room.space_id)
      .eq('user_id', userId)
      .single();

    return member?.role === 'admin' || member?.role === 'owner';
  }

  /**
   * Process mentions
   */
  private async processMentions(
    messageId: string,
    roomId: string,
    senderId: string,
    mentions: string[],
  ): Promise<void> {
    for (const mentionedUserId of mentions) {
      // Create notification for mentioned user
      await this.supabaseService.from('notifications').insert({
        user_id: mentionedUserId,
        type: 'mention',
        title: 'You were mentioned',
        message: `You were mentioned in a message`,
        data: { messageId, roomId, senderId },
      });

      // Increment mention count in Redis
      await this.redisService.incr(
        RedisKeys.user.mentionCount(mentionedUserId),
      );

      // Publish mention event to user's channel for real-time delivery
      await this.redisService.publish(
        RedisKeys.channel.user(mentionedUserId),
        JSON.stringify({
          event: 'mention',
          data: { messageId, roomId, mentionedBy: senderId },
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // Store mentions in Redis
    await this.redisService.sadd(
      RedisKeys.mention.byMessage(messageId),
      ...mentions,
    );
  }

  /**
   * Cache message
   */
  private async cacheMessage(message: Message): Promise<void> {
    await this.redisService.hset(RedisKeys.message.byId(message.id), {
      id: message.id,
      room_id: message.room_id,
      user_id: message.user_id,
      content: message.content,
      reply_to_id: message.reply_to_id || '',
      is_pinned: String(message.is_pinned),
      is_edited: String(message.is_edited),
      created_at: message.created_at,
      updated_at: message.updated_at,
      deleted_at: message.deleted_at || '',
    });
    await this.redisService.expire(
      RedisKeys.message.byId(message.id),
      this.MESSAGE_CACHE_TTL,
    );
  }

  /**
   * Get cached message
   */
  private async getCachedMessage(messageId: string): Promise<Message | null> {
    const cached = await this.redisService.hgetall(
      RedisKeys.message.byId(messageId),
    );
    if (!cached || Object.keys(cached).length === 0) {
      return null;
    }

    return {
      id: cached.id,
      room_id: cached.room_id,
      user_id: cached.user_id,
      content: cached.content,
      reply_to_id: cached.reply_to_id || null,
      is_pinned: cached.is_pinned === 'true',
      is_edited: cached.is_edited === 'true',
      created_at: cached.created_at,
      updated_at: cached.updated_at,
      deleted_at: cached.deleted_at || null,
    };
  }

  /**
   * Transform message with author
   */
  private transformMessageWithAuthor(msg: any): MessageWithAuthor {
    return {
      id: msg.id,
      room_id: msg.room_id,
      user_id: msg.user_id,
      content: msg.content,
      reply_to_id: msg.reply_to_id,
      is_pinned: msg.is_pinned,
      is_edited: msg.is_edited,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      deleted_at: msg.deleted_at,
      author: msg.author || {
        id: msg.user_id,
        display_name: 'Unknown',
        avatar_url: null,
      },
    };
  }
}
