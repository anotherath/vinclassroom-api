import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import { QueryNotificationsDto, MarkAsReadDto, CreateNotificationDto, NotificationType } from './dto';

interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  data: Record<string, any> | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly NOTIFICATION_CACHE_TTL = 3600; // 1 hour
  private readonly RECENT_NOTIFICATIONS_LIMIT = 50;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Create a new notification
   */
  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    const { data: notification, error } = await this.supabaseService
      .from('notifications')
      .insert({
        user_id: dto.userId,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        data: dto.data,
        is_read: false,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create notification:', error.message);
      throw new Error('Failed to create notification');
    }

    // Increment unread count in Redis
    await this.incrementUnreadCount(dto.userId);

    // Add to recent notifications list
    await this.addToRecentNotifications(dto.userId, notification);

    // Publish to user's channel for real-time delivery (Phase 4)
    await this.publishNotification(dto.userId, notification);

    this.logger.log(`Notification ${notification.id} created for user ${dto.userId}`);
    return notification as Notification;
  }

  /**
   * Get user's notifications
   */
  async getNotifications(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const { page = 1, limit = 20, isRead, type } = query;
    const offset = (page - 1) * limit;

    // Try to get recent notifications from cache first
    if (page === 1 && !isRead && !type) {
      const cached = await this.getRecentNotificationsFromCache(userId);
      if (cached && cached.length > 0) {
        const unreadCount = await this.getUnreadCount(userId);
        return {
          notifications: cached.slice(0, limit),
          total: cached.length,
          unreadCount,
        };
      }
    }

    // Build query
    let dbQuery = this.supabaseService
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (isRead !== undefined) {
      dbQuery = dbQuery.eq('is_read', isRead);
    }

    if (type) {
      dbQuery = dbQuery.eq('type', type);
    }

    const { data: notifications, error, count } = await dbQuery;

    if (error) {
      this.logger.error('Failed to fetch notifications:', error.message);
      throw new Error('Failed to fetch notifications');
    }

    // Cache recent notifications
    if (page === 1 && !isRead && !type) {
      await this.cacheRecentNotifications(userId, notifications as Notification[]);
    }

    // Get unread count
    const unreadCount = await this.getUnreadCount(userId);

    return {
      notifications: (notifications || []) as Notification[],
      total: count || 0,
      unreadCount,
    };
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string): Promise<number> {
    // Try Redis first
    const cacheKey = RedisKeys.user.notificationsUnread(userId);
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      return parseInt(cached, 10) || 0;
    }

    // Count from database
    const { count, error } = await this.supabaseService
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      this.logger.error('Failed to get unread count:', error.message);
      return 0;
    }

    const countValue = count || 0;

    // Cache the count
    await this.redisService.set(
      cacheKey,
      String(countValue),
      this.NOTIFICATION_CACHE_TTL,
    );

    return countValue;
  }

  /**
   * Mark notifications as read
   */
  async markAsRead(
    userId: string,
    dto: MarkAsReadDto,
  ): Promise<{ markedCount: number }> {
    let query = this.supabaseService
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('is_read', false);

    // If specific IDs provided, filter by them
    if (dto.notificationIds && dto.notificationIds.length > 0) {
      query = query.in('id', dto.notificationIds);
    }

    const { data: updated, error } = await query.select('id');

    if (error) {
      this.logger.error('Failed to mark notifications as read:', error.message);
      throw new Error('Failed to mark notifications as read');
    }

    const markedCount = updated?.length || 0;

    // Update unread count in Redis
    if (markedCount > 0) {
      await this.updateUnreadCount(userId);
      
      // Clear recent notifications cache
      await this.clearNotificationsCache(userId);
    }

    this.logger.log(`Marked ${markedCount} notifications as read for user ${userId}`);
    return { markedCount };
  }

  /**
   * Mark single notification as read
   */
  async markOneAsRead(userId: string, notificationId: string): Promise<void> {
    // Verify ownership
    const { data: notification, error: fetchError } = await this.supabaseService
      .from('notifications')
      .select('user_id, is_read')
      .eq('id', notificationId)
      .single();

    if (fetchError || !notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.user_id !== userId) {
      throw new ForbiddenException('You can only mark your own notifications as read');
    }

    if (notification.is_read) {
      return; // Already read
    }

    const { error } = await this.supabaseService
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId);

    if (error) {
      this.logger.error('Failed to mark notification as read:', error.message);
      throw new Error('Failed to mark notification as read');
    }

    // Update cache
    await this.updateUnreadCount(userId);
    await this.clearNotificationsCache(userId);

    this.logger.log(`Notification ${notificationId} marked as read`);
  }

  /**
   * Delete a notification
   */
  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    // Verify ownership
    const { data: notification, error: fetchError } = await this.supabaseService
      .from('notifications')
      .select('user_id, is_read')
      .eq('id', notificationId)
      .single();

    if (fetchError || !notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own notifications');
    }

    const { error } = await this.supabaseService
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) {
      this.logger.error('Failed to delete notification:', error.message);
      throw new Error('Failed to delete notification');
    }

    // Update cache if notification was unread
    if (!notification.is_read) {
      await this.updateUnreadCount(userId);
    }
    await this.clearNotificationsCache(userId);

    this.logger.log(`Notification ${notificationId} deleted`);
  }

  /**
   * Delete all read notifications
   */
  async deleteAllRead(userId: string): Promise<{ deletedCount: number }> {
    const { data: deleted, error } = await this.supabaseService
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .eq('is_read', true)
      .select('id');

    if (error) {
      this.logger.error('Failed to delete read notifications:', error.message);
      throw new Error('Failed to delete notifications');
    }

    const deletedCount = deleted?.length || 0;

    if (deletedCount > 0) {
      await this.clearNotificationsCache(userId);
    }

    this.logger.log(`Deleted ${deletedCount} read notifications for user ${userId}`);
    return { deletedCount };
  }

  /**
   * Create mention notification (called from MessagesService)
   */
  async createMentionNotification(
    mentionedUserId: string,
    messageId: string,
    roomId: string,
    senderId: string,
    senderName: string,
  ): Promise<void> {
    await this.createNotification({
      userId: mentionedUserId,
      type: NotificationType.MENTION,
      title: `${senderName} mentioned you`,
      message: 'You were mentioned in a message',
      data: { messageId, roomId, senderId },
    });
  }

  /**
   * Create reaction notification
   */
  async createReactionNotification(
    messageOwnerId: string,
    messageId: string,
    reactorId: string,
    reactorName: string,
    emoji: string,
  ): Promise<void> {
    // Don't notify if user reacted to their own message
    if (messageOwnerId === reactorId) return;

    await this.createNotification({
      userId: messageOwnerId,
      type: NotificationType.REACTION,
      title: `${reactorName} reacted to your message`,
      message: `Reacted with ${emoji}`,
      data: { messageId, reactorId, emoji },
    });
  }

  /**
   * Create DM notification
   */
  async createDMNotification(
    receiverId: string,
    senderId: string,
    senderName: string,
    conversationId: string,
  ): Promise<void> {
    await this.createNotification({
      userId: receiverId,
      type: NotificationType.DM,
      title: `New message from ${senderName}`,
      message: 'You have a new direct message',
      data: { conversationId, senderId },
    });
  }

  /**
   * Get notification by ID
   */
  async getNotificationById(notificationId: string, userId: string): Promise<Notification> {
    const { data: notification, error } = await this.supabaseService
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (error || !notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.user_id !== userId) {
      throw new ForbiddenException('You can only view your own notifications');
    }

    return notification as Notification;
  }

  // ==================== Private helper methods ====================

  /**
   * Increment unread count in Redis
   */
  private async incrementUnreadCount(userId: string): Promise<void> {
    const cacheKey = RedisKeys.user.notificationsUnread(userId);
    await this.redisService.incr(cacheKey);
    await this.redisService.expire(cacheKey, this.NOTIFICATION_CACHE_TTL);
  }

  /**
   * Update unread count from database
   */
  private async updateUnreadCount(userId: string): Promise<void> {
    const cacheKey = RedisKeys.user.notificationsUnread(userId);
    await this.redisService.del(cacheKey);
    // Next getUnreadCount call will recalculate from DB
  }

  /**
   * Add notification to recent list
   */
  private async addToRecentNotifications(
    userId: string,
    notification: Notification,
  ): Promise<void> {
    const cacheKey = RedisKeys.user.notifications(userId);
    
    // Add to list (LPUSH for newest first)
    await this.redisService.lpush(cacheKey, JSON.stringify(notification));
    
    // Trim to keep only recent notifications
    await this.redisService.ltrim(cacheKey, 0, this.RECENT_NOTIFICATIONS_LIMIT - 1);
    
    // Set expiration
    await this.redisService.expire(cacheKey, this.NOTIFICATION_CACHE_TTL);
  }

  /**
   * Get recent notifications from cache
   */
  private async getRecentNotificationsFromCache(userId: string): Promise<Notification[] | null> {
    const cacheKey = RedisKeys.user.notifications(userId);
    const cached = await this.redisService.lrange(cacheKey, 0, -1);

    if (!cached || cached.length === 0) {
      return null;
    }

    try {
      return cached.map(item => JSON.parse(item));
    } catch {
      return null;
    }
  }

  /**
   * Cache recent notifications
   */
  private async cacheRecentNotifications(
    userId: string,
    notifications: Notification[],
  ): Promise<void> {
    if (notifications.length === 0) return;

    const cacheKey = RedisKeys.user.notifications(userId);
    
    // Clear existing
    await this.redisService.del(cacheKey);
    
    // Add all notifications
    const values = notifications.map(n => JSON.stringify(n));
    await this.redisService.rpush(cacheKey, ...values);
    
    // Set expiration
    await this.redisService.expire(cacheKey, this.NOTIFICATION_CACHE_TTL);
  }

  /**
   * Clear notifications cache
   */
  private async clearNotificationsCache(userId: string): Promise<void> {
    await this.redisService.del(RedisKeys.user.notifications(userId));
  }

  /**
   * Publish notification to user's channel (for WebSocket)
   */
  private async publishNotification(
    userId: string,
    notification: Notification,
  ): Promise<void> {
    try {
      const channel = RedisKeys.channel.user(userId);
      await this.redisService.publish(
        channel,
        JSON.stringify({
          event: 'newNotification',
          data: notification,
        }),
      );
    } catch (error) {
      // Don't throw - publishing is best effort
      this.logger.warn('Failed to publish notification:', error);
    }
  }
}
