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
  CreateDMConversationDto,
  SendDMDto,
  QueryDMMessagesDto,
  QueryDMConversationsDto,
} from './dto';

interface DMConversation {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
}

interface DMConversationWithUser extends DMConversation {
  other_user: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    status: string;
  };
  last_message?: DMMessage | null;
  unread_count: number;
}

interface DMMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  deleted_at: string | null;
}

interface DMMessageWithSender extends DMMessage {
  sender: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

@Injectable()
export class DMsService {
  private readonly logger = new Logger(DMsService.name);
  private readonly DM_CACHE_TTL = 3600; // 1 hour
  private readonly RECENT_MESSAGES_LIMIT = 50;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Get or create DM conversation
   */
  async getOrCreateConversation(
    userId: string,
    dto: CreateDMConversationDto,
  ): Promise<DMConversationWithUser> {
    const { userId: otherUserId } = dto;

    // Prevent self-messaging
    if (userId === otherUserId) {
      throw new BadRequestException('Cannot create conversation with yourself');
    }

    // Check if other user exists and is not blocked
    const { data: otherUser, error: userError } = await this.supabaseService
      .from('profiles')
      .select('id, display_name, avatar_url, status')
      .eq('id', otherUserId)
      .single();

    if (userError || !otherUser) {
      throw new NotFoundException('User not found');
    }

    // Check if blocked
    const isBlocked = await this.isBlocked(userId, otherUserId);
    if (isBlocked) {
      throw new ForbiddenException(
        'You have blocked this user or they have blocked you',
      );
    }

    // Check for existing conversation
    const conversation = await this.findExistingConversation(
      userId,
      otherUserId,
    );

    let finalConversation: DMConversation;

    if (!conversation) {
      // Create new conversation
      const { data: newConversation, error } = await this.supabaseService
        .from('dm_conversations')
        .insert({
          user1_id: userId < otherUserId ? userId : otherUserId,
          user2_id: userId < otherUserId ? otherUserId : userId,
        })
        .select()
        .single();

      if (error) {
        this.logger.error('Failed to create conversation:', error.message);
        throw new ConflictException('Failed to create conversation');
      }

      finalConversation = newConversation;

      // Cache the conversation
      await this.cacheConversation(finalConversation);
    } else {
      finalConversation = conversation;
    }

    // Get last message
    const lastMessage = await this.getLastMessage(finalConversation.id);

    // Get unread count
    const unreadCount = await this.getUnreadCount(userId, finalConversation.id);

    return {
      id: finalConversation.id,
      user1_id: finalConversation.user1_id,
      user2_id: finalConversation.user2_id,
      created_at: finalConversation.created_at,
      other_user: {
        id: otherUser.id,
        display_name: otherUser.display_name,
        avatar_url: otherUser.avatar_url,
        status: otherUser.status,
      },
      last_message: lastMessage,
      unread_count: unreadCount,
    };
  }

  /**
   * Get user's DM conversations
   */
  async getConversations(
    userId: string,
    query: QueryDMConversationsDto,
  ): Promise<{
    conversations: DMConversationWithUser[];
    total: number;
    hasMore: boolean;
  }> {
    const { page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    // Get conversations where user is either user1 or user2
    const {
      data: conversations,
      error,
      count,
    } = await this.supabaseService
      .from('dm_conversations')
      .select('*', { count: 'exact' })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error('Failed to fetch conversations:', error.message);
      throw new ConflictException('Failed to fetch conversations');
    }

    // Enhance with user details and last message
    const enhancedConversations = await Promise.all(
      (conversations || []).map(async (conv) => {
        const otherUserId =
          conv.user1_id === userId ? conv.user2_id : conv.user1_id;

        const { data: otherUser } = await this.supabaseService
          .from('profiles')
          .select('id, display_name, avatar_url, status')
          .eq('id', otherUserId)
          .single();

        const lastMessage = await this.getLastMessage(conv.id);
        const unreadCount = await this.getUnreadCount(userId, conv.id);

        return {
          ...conv,
          other_user: otherUser || {
            id: otherUserId,
            display_name: 'Unknown',
            avatar_url: null,
            status: 'offline',
          },
          last_message: lastMessage,
          unread_count: unreadCount,
        };
      }),
    );

    return {
      conversations: enhancedConversations,
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Get DM messages
   */
  async getMessages(
    conversationId: string,
    userId: string,
    query: QueryDMMessagesDto,
  ): Promise<{
    messages: DMMessageWithSender[];
    total: number;
    hasMore: boolean;
  }> {
    // Verify user is part of this conversation
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.user1_id !== userId && conversation.user2_id !== userId) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const { page = 1, limit = 20, before, after } = query;
    const offset = (page - 1) * limit;

    // Build query
    let dbQuery = this.supabaseService
      .from('dm_messages')
      .select(
        `*, sender:profiles!dm_messages_sender_id_fkey ( id, display_name, avatar_url )`,
        { count: 'exact' },
      )
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply cursor pagination
    if (before) {
      const beforeMessage = await this.getDMMessageById(before);
      dbQuery = dbQuery.lt('created_at', beforeMessage.created_at);
    }

    if (after) {
      const afterMessage = await this.getDMMessageById(after);
      dbQuery = dbQuery.gt('created_at', afterMessage.created_at);
    }

    const { data: messages, error, count } = await dbQuery;

    if (error) {
      this.logger.error('Failed to fetch DM messages:', error.message);
      throw new ConflictException('Failed to fetch messages');
    }

    // Mark messages as read
    const unreadMessages = (messages || [])
      .filter((m) => m.sender_id !== userId && !m.is_read)
      .map((m) => m.id);

    if (unreadMessages.length > 0) {
      await this.markAsRead(conversationId, userId, unreadMessages);
    }

    return {
      messages: (messages || []).map((msg) =>
        this.transformMessageWithSender(msg),
      ),
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Send DM
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    dto: SendDMDto,
  ): Promise<DMMessageWithSender> {
    // Verify conversation exists and user is part of it
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (
      conversation.user1_id !== senderId &&
      conversation.user2_id !== senderId
    ) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const receiverId =
      conversation.user1_id === senderId
        ? conversation.user2_id
        : conversation.user1_id;

    // Create message
    const { data: message, error } = await this.supabaseService
      .from('dm_messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content: dto.content,
        is_read: false,
      })
      .select(
        `*, sender:profiles!dm_messages_sender_id_fkey ( id, display_name, avatar_url )`,
      )
      .single();

    if (error) {
      this.logger.error('Failed to send DM:', error.message);
      throw new ConflictException('Failed to send message');
    }

    // Cache message
    await this.cacheDMMessage(message);

    // Add to conversation messages list
    const dmKey = RedisKeys.dm.messages(
      conversation.user1_id,
      conversation.user2_id,
    );
    await this.redisService.zadd(
      dmKey,
      new Date(message.created_at).getTime(),
      message.id,
    );

    // Increment unread count for receiver
    const unreadKey = RedisKeys.dm.unread(receiverId, senderId);
    await this.redisService.incr(unreadKey);

    // Create notification for receiver
    await this.supabaseService.from('notifications').insert({
      user_id: receiverId,
      type: 'dm',
      title: 'New direct message',
      message: 'You have a new direct message',
      data: { conversationId, senderId, messageId: message.id },
    });

    // Publish to Redis for real-time broadcasting across servers
    await this.redisService.publish(
      `channel:dm:${conversation.user1_id}:${conversation.user2_id}`,
      JSON.stringify({
        event: 'newDM',
        data: {
          ...this.transformMessageWithSender(message),
          conversationId,
          timestamp: new Date().toISOString(),
        },
      }),
    );

    this.logger.log(`DM sent from ${senderId} to ${receiverId}`);
    return this.transformMessageWithSender(message);
  }

  /**
   * Delete DM message (soft delete)
   */
  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.getDMMessageById(messageId);

    // Verify ownership
    if (message.sender_id !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    // Soft delete
    const { error } = await this.supabaseService
      .from('dm_messages')
      .update({
        deleted_at: new Date().toISOString(),
        content: '[deleted]',
      })
      .eq('id', messageId);

    if (error) {
      this.logger.error('Failed to delete DM:', error.message);
      throw new ConflictException('Failed to delete message');
    }

    this.logger.log(`DM ${messageId} deleted`);
  }

  /**
   * Get unread count for a conversation
   */
  async getUnreadCount(
    userId: string,
    conversationId: string,
  ): Promise<number> {
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) return 0;

    const otherUserId =
      conversation.user1_id === userId
        ? conversation.user2_id
        : conversation.user1_id;

    // Try Redis first
    const unreadKey = RedisKeys.dm.unread(userId, otherUserId);
    const cached = await this.redisService.get(unreadKey);

    if (cached) {
      return parseInt(cached, 10) || 0;
    }

    // Count from database
    const { count, error } = await this.supabaseService
      .from('dm_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('is_read', false)
      .neq('sender_id', userId);

    if (error) {
      this.logger.error('Failed to get unread count:', error.message);
      return 0;
    }

    // Cache the count
    await this.redisService.set(
      unreadKey,
      String(count || 0),
      this.DM_CACHE_TTL,
    );

    return count || 0;
  }

  /**
   * Mark messages as read
   */
  async markAsRead(
    conversationId: string,
    userId: string,
    messageIds?: string[],
  ): Promise<void> {
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) return;

    let query = this.supabaseService
      .from('dm_messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .eq('is_read', false);

    if (messageIds && messageIds.length > 0) {
      query = query.in('id', messageIds);
    }

    const { error } = await query;

    if (error) {
      this.logger.error('Failed to mark messages as read:', error.message);
      return;
    }

    // Clear unread count in Redis
    const otherUserId =
      conversation.user1_id === userId
        ? conversation.user2_id
        : conversation.user1_id;
    const unreadKey = RedisKeys.dm.unread(userId, otherUserId);
    await this.redisService.del(unreadKey);

    // Publish to Redis for real-time read receipts across servers
    await this.redisService.publish(
      `channel:dm:${conversation.user1_id}:${conversation.user2_id}`,
      JSON.stringify({
        event: 'dmRead',
        data: {
          conversationId,
          readBy: userId,
          timestamp: new Date().toISOString(),
        },
      }),
    );
  }

  /**
   * Block a user
   */
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const { error } = await this.supabaseService.from('blocked_users').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('User already blocked');
      }
      this.logger.error('Failed to block user:', error.message);
      throw new ConflictException('Failed to block user');
    }

    this.logger.log(`User ${blockerId} blocked ${blockedId}`);
  }

  /**
   * Unblock a user
   */
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.supabaseService
      .from('blocked_users')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);

    if (error) {
      this.logger.error('Failed to unblock user:', error.message);
      throw new ConflictException('Failed to unblock user');
    }

    this.logger.log(`User ${blockerId} unblocked ${blockedId}`);
  }

  /**
   * Get blocked users
   */
  async getBlockedUsers(userId: string): Promise<any[]> {
    const { data: blocked, error } = await this.supabaseService
      .from('blocked_users')
      .select(
        `
        blocked_id,
        created_at,
        blocked:profiles!blocked_users_blocked_id_fkey (
          id,
          display_name,
          avatar_url
        )
      `,
      )
      .eq('blocker_id', userId);

    if (error) {
      this.logger.error('Failed to get blocked users:', error.message);
      return [];
    }

    return (blocked || []).map((b: any) => ({
      id: b.blocked?.id,
      displayName: b.blocked?.display_name,
      avatar: b.blocked?.avatar_url,
      blockedAt: b.created_at,
    }));
  }

  /**
   * Find existing conversation between two users
   */
  private async findExistingConversation(
    user1Id: string,
    user2Id: string,
  ): Promise<DMConversation | null> {
    // Try cache first
    const dmKey = RedisKeys.dm.byId(user1Id, user2Id);
    const cached = await this.redisService.get(dmKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Query database
    const { data: conversation, error } = await this.supabaseService
      .from('dm_conversations')
      .select('*')
      .or(
        `and(user1_id.eq.${user1Id},user2_id.eq.${user2Id}),and(user1_id.eq.${user2Id},user2_id.eq.${user1Id})`,
      )
      .single();

    if (error || !conversation) {
      return null;
    }

    await this.cacheConversation(conversation);
    return conversation;
  }

  /**
   * Get conversation by ID
   */
  private async getConversationById(
    conversationId: string,
  ): Promise<DMConversation | null> {
    const { data: conversation, error } = await this.supabaseService
      .from('dm_conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (error || !conversation) {
      return null;
    }

    return conversation;
  }

  /**
   * Get DM message by ID
   */
  private async getDMMessageById(messageId: string): Promise<DMMessage> {
    const { data: message, error } = await this.supabaseService
      .from('dm_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (error || !message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  /**
   * Get last message in conversation
   */
  private async getLastMessage(
    conversationId: string,
  ): Promise<DMMessage | null> {
    const { data: message, error } = await this.supabaseService
      .from('dm_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return null;
    }

    return message;
  }

  /**
   * Check if users have blocked each other
   */
  private async isBlocked(user1Id: string, user2Id: string): Promise<boolean> {
    const { data: block, error } = await this.supabaseService
      .from('blocked_users')
      .select('id')
      .or(
        `and(blocker_id.eq.${user1Id},blocked_id.eq.${user2Id}),and(blocker_id.eq.${user2Id},blocked_id.eq.${user1Id})`,
      )
      .maybeSingle();

    if (error) {
      return false;
    }

    return !!block;
  }

  /**
   * Cache conversation
   */
  private async cacheConversation(conversation: DMConversation): Promise<void> {
    const dmKey = RedisKeys.dm.byId(
      conversation.user1_id,
      conversation.user2_id,
    );
    await this.redisService.set(
      dmKey,
      JSON.stringify(conversation),
      this.DM_CACHE_TTL,
    );
  }

  /**
   * Cache DM message
   */
  private async cacheDMMessage(message: DMMessage): Promise<void> {
    const key = `dmmsg:${message.id}`;
    await this.redisService.hset(key, {
      id: message.id,
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      content: message.content,
      is_read: String(message.is_read),
      created_at: message.created_at,
      deleted_at: message.deleted_at || '',
    });
    await this.redisService.expire(key, this.DM_CACHE_TTL);
  }

  /**
   * Transform message with sender
   */
  private transformMessageWithSender(msg: any): DMMessageWithSender {
    return {
      id: msg.id,
      conversation_id: msg.conversation_id,
      sender_id: msg.sender_id,
      content: msg.content,
      is_read: msg.is_read,
      created_at: msg.created_at,
      deleted_at: msg.deleted_at,
      sender: msg.sender || {
        id: msg.sender_id,
        display_name: 'Unknown',
        avatar_url: null,
      },
    };
  }
}
