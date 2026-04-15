import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { RedisService } from '../redis/redis.service';
import { RedisKeys } from '../redis/keys';
import { MessagesService } from '../modules/messages/messages.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { DMsService } from '../modules/dms/dms.service';
import { UsersService } from '../modules/users/users.service';
import { WsRateLimitGuard } from './guards/ws-rate-limit.guard';
import type {
  AuthenticatedSocket,
  JoinRoomPayload,
  LeaveRoomPayload,
  SendMessagePayload,
  EditMessagePayload,
  DeleteMessagePayload,
  TypingPayload,
  AddReactionPayload,
  RemoveReactionPayload,
  JoinDMPayload,
  SendDMPayload,
  MarkDMReadPayload,
} from './types/socket.types';

/**
 * Chat Gateway - Main WebSocket gateway for real-time features
 * 
 * Namespace: /chat
 * Events: joinRoom, leaveRoom, sendMessage, typing, etc.
 */
@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: (requestOrigin, callback) => {
      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];
      if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
})
@UseGuards(WsJwtGuard)
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly TYPING_TIMEOUT = 3000; // 3 seconds
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly redisService: RedisService,
    private readonly messagesService: MessagesService,
    private readonly notificationsService: NotificationsService,
    private readonly dmsService: DMsService,
    private readonly rateLimitGuard: WsRateLimitGuard,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Called when gateway is initialized
   */
  afterInit(server: Server): void {
    this.logger.log('Chat Gateway initialized');
    
    // Set up error handling for the server
    server.on('error', (error) => {
      this.logger.error('WebSocket server error:', error);
    });

    // Subscribe to Redis channels for cross-server broadcasting
    this.subscribeToRedisChannels();

    // Log connection stats periodically
    setInterval(() => {
      const stats = this.getConnectionStats();
      this.logger.debug(`WebSocket Stats: ${JSON.stringify(stats)}`);
    }, 60000); // Every minute
  }

  /**
   * Subscribe to Redis channels for real-time events
   */
  private subscribeToRedisChannels(): void {
    // Subscribe to room channels pattern
    const subscriber = this.redisService.getSubscriber();
    
    // Subscribe to all room channels
    subscriber.psubscribe('channel:room:*', (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to room channels:', err);
      } else {
        this.logger.log('Subscribed to room channels');
      }
    });

    // Subscribe to user channels for notifications
    subscriber.psubscribe('channel:user:*', (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to user channels:', err);
      } else {
        this.logger.log('Subscribed to user channels');
      }
    });

    // Subscribe to DM channels
    subscriber.psubscribe('channel:dm:*', (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to DM channels:', err);
      } else {
        this.logger.log('Subscribed to DM channels');
      }
    });

    // Handle incoming messages
    subscriber.on('pmessage', (pattern, channel, message) => {
      try {
        const data = JSON.parse(message);
        
        if (channel.startsWith('channel:room:')) {
          const roomId = channel.replace('channel:room:', '');
          // Broadcast to WebSocket clients in the room
          this.server.to(`room:${roomId}`).emit(data.event, data.data);
          this.logger.debug(`Broadcasted ${data.event} to room:${roomId}`);
        } else if (channel.startsWith('channel:user:')) {
          const userId = channel.replace('channel:user:', '');
          // Broadcast to specific user's sockets
          this.server.to(`user:${userId}`).emit(data.event, data.data);
          this.logger.debug(`Sent ${data.event} to user:${userId}`);
        } else if (channel.startsWith('channel:dm:')) {
          // DM channel format: channel:dm:{user1Id}:{user2Id}
          const dmChannel = channel.replace('channel:dm:', '');
          const [user1Id, user2Id] = dmChannel.split(':');
          // Broadcast to both users' DM rooms
          this.server.to(`dm:${user1Id}:${user2Id}`).emit(data.event, data.data);
          this.logger.debug(`Broadcasted ${data.event} to DM channel:${dmChannel}`);
        }
      } catch (error) {
        this.logger.error('Error handling Redis message:', error);
      }
    });
  }

  /**
   * Track user connections (for multi-device support)
   */
  private userConnections: Map<string, Set<string>> = new Map();

  /**
   * Called when a client connects
   */
  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      // The WsJwtGuard should have already authenticated the user
      // and attached user data to client.data
      const userId = client.data?.user?.id;

      if (!userId) {
        this.logger.warn(`Connection rejected: No user data`);
        client.disconnect(true);
        return;
      }

      // Join user's personal room for direct notifications
      client.join(`user:${userId}`);

      // Track this connection
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(client.id);

      // Update user status to online (only if first connection)
      const wasOffline = !(await this.isUserOnline(userId));
      await this.redisService.hset(RedisKeys.user.status(userId), {
        online: 'true',
        lastSeen: Date.now().toString(),
      });
      await this.redisService.expire(RedisKeys.user.status(userId), 300); // 5 min TTL
      await this.redisService.sadd(RedisKeys.usersOnline(), userId);

      // Notify friends/contacts that user is online (only on first connection)
      if (wasOffline) {
        this.broadcastUserStatus(userId, 'online');
        await this.usersService.updateUserStatus(userId, 'online');
      }

      this.logger.log(`Client connected: ${client.id}, User: ${userId}, Connections: ${this.userConnections.get(userId)?.size || 0}`);

      // Send connection success with online users list
      const onlineUsers = await this.getOnlineUsers();
      client.emit('connected', {
        socketId: client.id,
        userId: userId,
        onlineUsers,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect(true);
    }
  }

  /**
   * Called when a client disconnects
   */
  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    try {
      const userId = client.data?.user?.id;

      if (userId) {
        // Clear any typing timers for this user
        this.clearTypingTimer(userId);

        // Remove this connection
        const connections = this.userConnections.get(userId);
        if (connections) {
          connections.delete(client.id);
          
          // If no more connections, mark as offline
          if (connections.size === 0) {
            this.userConnections.delete(userId);
            await this.redisService.hset(RedisKeys.user.status(userId), {
              online: 'false',
              lastSeen: Date.now().toString(),
            });
            await this.redisService.expire(RedisKeys.user.status(userId), 3600);
            await this.redisService.srem(RedisKeys.usersOnline(), userId);
            await this.usersService.updateUserStatus(userId, 'offline');

            // Notify that user is offline
            this.broadcastUserStatus(userId, 'offline');
          }
        }

        this.logger.log(`Client disconnected: ${client.id}, User: ${userId}, Remaining: ${connections?.size || 0}`);
      }
    } catch (error) {
      this.logger.error(`Disconnect error: ${error.message}`);
    }
  }

  // ==================== Room Management ====================

  /**
   * Handle join room event
   */
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: JoinRoomPayload,
  ): Promise<void> {
    try {
      const { roomId } = payload;
      const userId = client.data.user.id;

      // Validate room access (check if user is room member)
      const isMember = await this.isRoomMember(roomId, userId);
      if (!isMember) {
        client.emit('error', { message: 'You are not a member of this room', code: 'FORBIDDEN' });
        return;
      }

      // Join the room
      client.join(`room:${roomId}`);
      
      // Add to room members set
      await this.redisService.sadd(RedisKeys.room.members(roomId), userId);

      // Notify room that user joined
      client.to(`room:${roomId}`).emit('userJoined', {
        userId,
        roomId,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(`User ${userId} joined room ${roomId}`);

      // Send success response
      client.emit('joinedRoom', {
        roomId,
        success: true,
      });

    } catch (error) {
      this.logger.error(`Join room error: ${error.message}`);
      client.emit('error', { message: 'Failed to join room', code: 'ERROR' });
    }
  }

  /**
   * Handle leave room event
   */
  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: LeaveRoomPayload,
  ): Promise<void> {
    try {
      const { roomId } = payload;
      const userId = client.data.user.id;

      // Leave the room
      client.leave(`room:${roomId}`);
      
      // Remove from room members set
      await this.redisService.srem(RedisKeys.room.members(roomId), userId);

      // Notify room that user left
      client.to(`room:${roomId}`).emit('userLeft', {
        userId,
        roomId,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(`User ${userId} left room ${roomId}`);

      // Send success response
      client.emit('leftRoom', {
        roomId,
        success: true,
      });

    } catch (error) {
      this.logger.error(`Leave room error: ${error.message}`);
      client.emit('error', { message: 'Failed to leave room', code: 'ERROR' });
    }
  }

  // ==================== Typing Indicators ====================

  /**
   * Handle typing event
   */
  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TypingPayload,
  ): Promise<void> {
    try {
      const { roomId, isTyping } = payload;
      const userId = client.data.user.id;

      // Check if user is in the room
      const roomName = `room:${roomId}`;
      if (!client.rooms.has(roomName)) {
        client.emit('error', { message: 'You are not in this room', code: 'NOT_IN_ROOM' });
        return;
      }

      // Broadcast typing status to room (excluding sender)
      client.to(roomName).emit('typing', {
        userId,
        roomId,
        isTyping,
        timestamp: new Date().toISOString(),
      });

      // Manage typing timer
      if (isTyping) {
        this.startTypingTimer(userId, roomId);
      } else {
        this.clearTypingTimer(userId);
      }

    } catch (error) {
      this.logger.error(`Typing event error: ${error.message}`);
    }
  }

  // ==================== Real-time Messaging ====================

  /**
   * Handle send message event
   */
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<void> {
    try {
      const { roomId, content, replyToId } = payload;
      const userId = client.data.user.id;

      // Check if user is in the room
      const roomName = `room:${roomId}`;
      if (!client.rooms.has(roomName)) {
        client.emit('error', { message: 'You are not in this room', code: 'NOT_IN_ROOM' });
        return;
      }

      // Create message via service (this will publish to Redis)
      const message = await this.messagesService.createMessage(roomId, userId, {
        content,
        replyToId,
      });

      // Send success response to sender
      client.emit('messageSent', {
        success: true,
        message,
      });

      this.logger.debug(`Message sent by ${userId} in room ${roomId}`);

    } catch (error) {
      this.logger.error(`Send message error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to send message', code: 'ERROR' });
    }
  }

  /**
   * Handle edit message event
   */
  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: EditMessagePayload,
  ): Promise<void> {
    try {
      const { messageId, content } = payload;
      const userId = client.data.user.id;

      // Edit message via service (this will publish to Redis)
      const message = await this.messagesService.updateMessage(messageId, userId, {
        content,
      });

      // Send success response
      client.emit('messageEdited', {
        success: true,
        message,
      });

      this.logger.debug(`Message ${messageId} edited by ${userId}`);

    } catch (error) {
      this.logger.error(`Edit message error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to edit message', code: 'ERROR' });
    }
  }

  /**
   * Handle delete message event
   */
  @SubscribeMessage('deleteMessage')
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: DeleteMessagePayload,
  ): Promise<void> {
    try {
      const { messageId } = payload;
      const userId = client.data.user.id;

      // Delete message via service (this will publish to Redis)
      await this.messagesService.deleteMessage(messageId, userId);

      // Send success response
      client.emit('messageDeleted', {
        success: true,
        messageId,
      });

      this.logger.debug(`Message ${messageId} deleted by ${userId}`);

    } catch (error) {
      this.logger.error(`Delete message error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to delete message', code: 'ERROR' });
    }
  }

  // ==================== Reactions ====================

  /**
   * Handle add reaction event
   */
  @SubscribeMessage('addReaction')
  async handleAddReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: AddReactionPayload,
  ): Promise<void> {
    try {
      const { messageId, emoji } = payload;
      const userId = client.data.user.id;

      // Add reaction via service (this will publish to Redis)
      const reaction = await this.messagesService.addReaction(messageId, userId, { emoji });

      // Send success response
      client.emit('reactionAdded', {
        success: true,
        reaction,
      });

      this.logger.debug(`Reaction added to ${messageId} by ${userId}`);

    } catch (error) {
      this.logger.error(`Add reaction error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to add reaction', code: 'ERROR' });
    }
  }

  /**
   * Handle remove reaction event
   */
  @SubscribeMessage('removeReaction')
  async handleRemoveReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: RemoveReactionPayload,
  ): Promise<void> {
    try {
      const { messageId, emoji } = payload;
      const userId = client.data.user.id;

      // Remove reaction via service (this will publish to Redis)
      await this.messagesService.removeReaction(messageId, userId, emoji);

      // Send success response
      client.emit('reactionRemoved', {
        success: true,
        messageId,
        emoji,
      });

      this.logger.debug(`Reaction removed from ${messageId} by ${userId}`);

    } catch (error) {
      this.logger.error(`Remove reaction error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to remove reaction', code: 'ERROR' });
    }
  }

  // ==================== Direct Messages ====================

  /**
   * Handle join DM conversation event
   */
  @SubscribeMessage('joinDM')
  async handleJoinDM(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: JoinDMPayload,
  ): Promise<void> {
    try {
      const { conversationId } = payload;
      const userId = client.data.user.id;

      // Verify user is part of this conversation
      const conversation = await this.dmsService.getConversations(userId, { page: 1, limit: 100 })
        .then(result => result.conversations.find(c => c.id === conversationId));
      
      if (!conversation) {
        client.emit('error', { message: 'Conversation not found or access denied', code: 'FORBIDDEN' });
        return;
      }

      // Get the other user ID
      const otherUserId = conversation.other_user.id;
      const sortedIds = [userId, otherUserId].sort();
      const dmRoom = `dm:${sortedIds[0]}:${sortedIds[1]}`;

      // Join the DM room
      client.join(dmRoom);

      this.logger.debug(`User ${userId} joined DM conversation ${conversationId}`);

      // Send success response
      client.emit('joinedDM', {
        conversationId,
        success: true,
      });

    } catch (error) {
      this.logger.error(`Join DM error: ${error.message}`);
      client.emit('error', { message: 'Failed to join DM conversation', code: 'ERROR' });
    }
  }

  /**
   * Handle leave DM conversation event
   */
  @SubscribeMessage('leaveDM')
  async handleLeaveDM(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: JoinDMPayload,
  ): Promise<void> {
    try {
      const { conversationId } = payload;
      const userId = client.data.user.id;

      // Get conversation to find other user
      const conversation = await this.dmsService.getConversations(userId, { page: 1, limit: 100 })
        .then(result => result.conversations.find(c => c.id === conversationId));
      
      if (conversation) {
        const otherUserId = conversation.other_user.id;
        const sortedIds = [userId, otherUserId].sort();
        const dmRoom = `dm:${sortedIds[0]}:${sortedIds[1]}`;
        client.leave(dmRoom);
      }

      this.logger.debug(`User ${userId} left DM conversation ${conversationId}`);

      client.emit('leftDM', {
        conversationId,
        success: true,
      });

    } catch (error) {
      this.logger.error(`Leave DM error: ${error.message}`);
    }
  }

  /**
   * Handle send DM event
   */
  @SubscribeMessage('sendDM')
  async handleSendDM(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SendDMPayload,
  ): Promise<void> {
    try {
      const { conversationId, content } = payload;
      const userId = client.data.user.id;

      // Send DM via service
      const message = await this.dmsService.sendMessage(conversationId, userId, { content });

      // Get conversation details to find the other user
      const conversation = await this.dmsService.getConversations(userId, { page: 1, limit: 100 })
        .then(result => result.conversations.find(c => c.id === conversationId));

      if (conversation) {
        const otherUserId = conversation.other_user.id;
        const sortedIds = [userId, otherUserId].sort();
        const dmRoom = `dm:${sortedIds[0]}:${sortedIds[1]}`;

        // Broadcast to DM room (including sender for consistency)
        this.server.to(dmRoom).emit('newDM', {
          ...message,
          conversationId,
          timestamp: new Date().toISOString(),
        });

        // Also send to the receiver's personal room for notifications
        this.server.to(`user:${otherUserId}`).emit('newDM', {
          ...message,
          conversationId,
          timestamp: new Date().toISOString(),
        });

        // Publish to Redis for cross-server broadcasting
        await this.redisService.publish(
          `channel:dm:${sortedIds[0]}:${sortedIds[1]}`,
          JSON.stringify({
            event: 'newDM',
            data: { ...message, conversationId, timestamp: new Date().toISOString() },
          }),
        );
      }

      // Send success response to sender
      client.emit('dmSent', {
        success: true,
        message,
      });

      this.logger.debug(`DM sent by ${userId} in conversation ${conversationId}`);

    } catch (error) {
      this.logger.error(`Send DM error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to send DM', code: 'ERROR' });
    }
  }

  /**
   * Handle mark DM as read event
   */
  @SubscribeMessage('markDMRead')
  async handleMarkDMRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: MarkDMReadPayload,
  ): Promise<void> {
    try {
      const { conversationId } = payload;
      const userId = client.data.user.id;

      // Mark messages as read
      await this.dmsService.markAsRead(conversationId, userId);

      // Get conversation to find other user for broadcasting
      const conversation = await this.dmsService.getConversations(userId, { page: 1, limit: 100 })
        .then(result => result.conversations.find(c => c.id === conversationId));

      if (conversation) {
        const otherUserId = conversation.other_user.id;
        const sortedIds = [userId, otherUserId].sort();
        const dmRoom = `dm:${sortedIds[0]}:${sortedIds[1]}`;

        // Broadcast read receipt to the other user in the DM room
        client.to(dmRoom).emit('dmRead', {
          conversationId,
          readBy: userId,
          timestamp: new Date().toISOString(),
        });

        // Publish to Redis for cross-server broadcasting
        await this.redisService.publish(
          `channel:dm:${sortedIds[0]}:${sortedIds[1]}`,
          JSON.stringify({
            event: 'dmRead',
            data: { conversationId, readBy: userId, timestamp: new Date().toISOString() },
          }),
        );
      }

      // Send success response
      client.emit('dmMarkedRead', {
        success: true,
        conversationId,
      });

      this.logger.debug(`DM marked as read by ${userId} in conversation ${conversationId}`);

    } catch (error) {
      this.logger.error(`Mark DM read error: ${error.message}`);
      client.emit('error', { message: 'Failed to mark DM as read', code: 'ERROR' });
    }
  }

  /**
   * Handle DM typing event
   */
  @SubscribeMessage('dmTyping')
  async handleDMTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { conversationId: string; isTyping: boolean },
  ): Promise<void> {
    try {
      const { conversationId, isTyping } = payload;
      const userId = client.data.user.id;

      // Get conversation to find other user
      const conversation = await this.dmsService.getConversations(userId, { page: 1, limit: 100 })
        .then(result => result.conversations.find(c => c.id === conversationId));

      if (!conversation) {
        client.emit('error', { message: 'Conversation not found', code: 'NOT_FOUND' });
        return;
      }

      const otherUserId = conversation.other_user.id;
      const sortedIds = [userId, otherUserId].sort();
      const dmRoom = `dm:${sortedIds[0]}:${sortedIds[1]}`;

      // Check if user is in the DM room
      if (!client.rooms.has(dmRoom)) {
        client.emit('error', { message: 'You are not in this DM conversation', code: 'NOT_IN_ROOM' });
        return;
      }

      // Broadcast typing status to the other user (excluding sender)
      client.to(dmRoom).emit('dmTyping', {
        userId,
        conversationId,
        isTyping,
        timestamp: new Date().toISOString(),
      });

      // Manage typing timer
      const typingKey = `dm:${userId}:${conversationId}`;
      if (isTyping) {
        this.startDMTypingTimer(userId, conversationId, dmRoom);
      } else {
        this.clearDMTypingTimer(typingKey);
      }

      this.logger.debug(`DM typing event: ${userId} is ${isTyping ? 'typing' : 'not typing'} in ${conversationId}`);

    } catch (error) {
      this.logger.error(`DM typing event error: ${error.message}`);
    }
  }

  // ==================== DM Helper Methods ====================

  private readonly dmTypingTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start DM typing timer to auto-clear typing status
   */
  private startDMTypingTimer(userId: string, conversationId: string, dmRoom: string): void {
    const typingKey = `dm:${userId}:${conversationId}`;
    
    // Clear existing timer
    this.clearDMTypingTimer(typingKey);

    // Set new timer
    const timer = setTimeout(() => {
      // Auto-clear typing status after timeout
      this.server.to(dmRoom).emit('dmTyping', {
        userId,
        conversationId,
        isTyping: false,
        timestamp: new Date().toISOString(),
      });
      this.dmTypingTimers.delete(typingKey);
    }, this.TYPING_TIMEOUT);

    this.dmTypingTimers.set(typingKey, timer);
  }

  /**
   * Clear DM typing timer
   */
  private clearDMTypingTimer(typingKey: string): void {
    const timer = this.dmTypingTimers.get(typingKey);
    if (timer) {
      clearTimeout(timer);
      this.dmTypingTimers.delete(typingKey);
    }
  }

  // ==================== Message Delivery Status ====================

  /**
   * Handle message delivered acknowledgment
   */
  @SubscribeMessage('messageDelivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { messageId: string; roomId?: string; conversationId?: string },
  ): Promise<void> {
    try {
      const { messageId, roomId, conversationId } = payload;
      const userId = client.data.user.id;

      // Store delivery status in Redis
      const deliveryKey = `msg:delivery:${messageId}`;
      await this.redisService.hset(deliveryKey, {
        deliveredTo: userId,
        deliveredAt: new Date().toISOString(),
      });
      await this.redisService.expire(deliveryKey, 86400); // 24 hours

      // Increment delivered count
      await this.redisService.hincrby(deliveryKey, 'deliveredCount', 1);

      // Broadcast to sender that message was delivered
      const targetId = roomId || conversationId;
      if (targetId) {
        const channel = roomId ? `room:${roomId}` : `dm:${conversationId}`;
        client.to(channel).emit('messageDelivered', {
          messageId,
          deliveredTo: userId,
          deliveredAt: new Date().toISOString(),
        });

        // Publish to Redis for cross-server
        await this.redisService.publish(
          roomId ? `channel:room:${roomId}` : `channel:dm:${conversationId}`,
          JSON.stringify({
            event: 'messageDelivered',
            data: { messageId, deliveredTo: userId, deliveredAt: new Date().toISOString() },
          }),
        );
      }

      this.logger.debug(`Message ${messageId} delivered to ${userId}`);

    } catch (error) {
      this.logger.error(`Message delivered error: ${error.message}`);
    }
  }

  /**
   * Handle message read acknowledgment
   */
  @SubscribeMessage('messageRead')
  async handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { messageId: string; roomId?: string; conversationId?: string },
  ): Promise<void> {
    try {
      const { messageId, roomId, conversationId } = payload;
      const userId = client.data.user.id;

      // Store read status in Redis
      const readKey = `msg:read:${messageId}`;
      await this.redisService.sadd(readKey, userId);
      await this.redisService.expire(readKey, 86400); // 24 hours

      // Get read count
      const readCount = await this.redisService.getClient().scard(readKey);

      // Broadcast to room/DM that message was read
      const targetId = roomId || conversationId;
      if (targetId) {
        const channel = roomId ? `room:${roomId}` : `dm:${conversationId}`;
        client.to(channel).emit('messageRead', {
          messageId,
          readBy: userId,
          readCount,
          readAt: new Date().toISOString(),
        });

        // Publish to Redis for cross-server
        await this.redisService.publish(
          roomId ? `channel:room:${roomId}` : `channel:dm:${conversationId}`,
          JSON.stringify({
            event: 'messageRead',
            data: { messageId, readBy: userId, readCount, readAt: new Date().toISOString() },
          }),
        );
      }

      this.logger.debug(`Message ${messageId} read by ${userId}`);

    } catch (error) {
      this.logger.error(`Message read error: ${error.message}`);
    }
  }

  /**
   * Get message delivery status
   */
  @SubscribeMessage('getMessageStatus')
  async handleGetMessageStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { messageId: string },
  ): Promise<void> {
    try {
      const { messageId } = payload;

      const deliveryKey = `msg:delivery:${messageId}`;
      const readKey = `msg:read:${messageId}`;

      const [deliveryInfo, readUsers] = await Promise.all([
        this.redisService.hgetall(deliveryKey),
        this.redisService.smembers(readKey),
      ]);

      client.emit('messageStatus', {
        messageId,
        delivered: !!deliveryInfo.deliveredTo,
        deliveredAt: deliveryInfo.deliveredAt || null,
        deliveredCount: parseInt(deliveryInfo.deliveredCount || '0', 10),
        readBy: readUsers,
        readCount: readUsers.length,
      });

    } catch (error) {
      this.logger.error(`Get message status error: ${error.message}`);
      client.emit('error', { message: 'Failed to get message status', code: 'ERROR' });
    }
  }

  // ==================== File Upload Progress ====================

  /**
   * Handle file upload progress updates (client to server)
   * Used when client wants to report upload progress to other users
   */
  @SubscribeMessage('fileUploadProgress')
  async handleFileUploadProgress(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: {
      uploadId: string;
      roomId?: string;
      conversationId?: string;
      progress: number; // 0-100
      status: 'uploading' | 'processing' | 'completed' | 'error';
      fileName?: string;
      fileSize?: number;
      error?: string;
    },
  ): Promise<void> {
    try {
      const { uploadId, roomId, conversationId, progress, status, fileName, fileSize, error } = payload;
      const userId = client.data.user.id;

      // Validate progress
      if (progress < 0 || progress > 100) {
        client.emit('error', { message: 'Invalid progress value', code: 'VALIDATION_ERROR' });
        return;
      }

      // Store upload progress in Redis
      const uploadKey = `upload:${uploadId}`;
      await this.redisService.hset(uploadKey, {
        userId,
        progress: String(progress),
        status,
        fileName: fileName || '',
        fileSize: String(fileSize || 0),
        updatedAt: new Date().toISOString(),
      });
      await this.redisService.expire(uploadKey, 3600); // 1 hour

      // Broadcast to room or DM
      const targetId = roomId || conversationId;
      if (targetId) {
        const channel = roomId ? `room:${roomId}` : `dm:${conversationId}`;
        const progressData = {
          uploadId,
          userId,
          progress,
          status,
          fileName,
          fileSize,
          error,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to others (excluding sender)
        client.to(channel).emit('fileUploadProgress', progressData);

        // Also send to sender for confirmation
        client.emit('fileUploadProgressConfirmed', progressData);

        // Publish to Redis for cross-server
        await this.redisService.publish(
          roomId ? `channel:room:${roomId}` : `channel:dm:${conversationId}`,
          JSON.stringify({
            event: 'fileUploadProgress',
            data: progressData,
          }),
        );
      }

      // If upload completed or errored, clean up after delay
      if (status === 'completed' || status === 'error') {
        setTimeout(async () => {
          await this.redisService.del(uploadKey);
        }, 300000); // 5 minutes
      }

      this.logger.debug(`Upload ${uploadId} progress: ${progress}% (${status})`);

    } catch (err) {
      this.logger.error(`File upload progress error: ${err.message}`);
    }
  }

  /**
   * Get upload status
   */
  @SubscribeMessage('getUploadStatus')
  async handleGetUploadStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { uploadId: string },
  ): Promise<void> {
    try {
      const { uploadId } = payload;
      const uploadKey = `upload:${uploadId}`;
      const uploadInfo = await this.redisService.hgetall(uploadKey);

      if (!uploadInfo || Object.keys(uploadInfo).length === 0) {
        client.emit('uploadStatus', {
          uploadId,
          found: false,
        });
        return;
      }

      client.emit('uploadStatus', {
        uploadId,
        found: true,
        userId: uploadInfo.userId,
        progress: parseInt(uploadInfo.progress, 10),
        status: uploadInfo.status,
        fileName: uploadInfo.fileName,
        fileSize: parseInt(uploadInfo.fileSize, 10),
        updatedAt: uploadInfo.updatedAt,
      });

    } catch (error) {
      this.logger.error(`Get upload status error: ${error.message}`);
      client.emit('error', { message: 'Failed to get upload status', code: 'ERROR' });
    }
  }

  // ==================== Rate Limiting ====================

  /**
   * Get current rate limit status
   */
  @SubscribeMessage('getRateLimitStatus')
  async handleGetRateLimitStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { event?: string },
  ): Promise<void> {
    try {
      const userId = client.data.user.id;
      const { event } = payload;

      if (event) {
        const status = await this.rateLimitGuard.getRateLimitStatus(userId, event);
        client.emit('rateLimitStatus', { event, ...status });
      } else {
        // Get status for all events
        const allLimits = this.rateLimitGuard.getAllRateLimits();
        const statuses = await Promise.all(
          Object.keys(allLimits).map(async (eventType) => ({
            event: eventType,
            ...(await this.rateLimitGuard.getRateLimitStatus(userId, eventType)),
          })),
        );
        client.emit('rateLimitStatus', { events: statuses });
      }

    } catch (error) {
      this.logger.error(`Get rate limit status error: ${error.message}`);
      client.emit('error', { message: 'Failed to get rate limit status', code: 'ERROR' });
    }
  }

  // ==================== Bulk Operations ====================

  /**
   * Handle bulk mark as read
   */
  @SubscribeMessage('bulkMarkAsRead')
  async handleBulkMarkAsRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { roomId?: string; conversationId?: string; messageIds?: string[] },
  ): Promise<void> {
    try {
      const { roomId, conversationId, messageIds } = payload;
      const userId = client.data.user.id;

      if (conversationId) {
        // Mark DM messages as read
        await this.dmsService.markAsRead(conversationId, userId);

        // Get conversation to find other user
        const conversation = await this.dmsService.getConversations(userId, { page: 1, limit: 100 })
          .then(result => result.conversations.find(c => c.id === conversationId));

        if (conversation) {
          const otherUserId = conversation.other_user.id;
          const sortedIds = [userId, otherUserId].sort();
          const dmRoom = `dm:${sortedIds[0]}:${sortedIds[1]}`;

          client.to(dmRoom).emit('bulkRead', {
            conversationId,
            readBy: userId,
            timestamp: new Date().toISOString(),
          });
        }

        client.emit('bulkMarkAsReadComplete', {
          success: true,
          conversationId,
        });
      }

      this.logger.debug(`Bulk mark as read completed by ${userId}`);

    } catch (error) {
      this.logger.error(`Bulk mark as read error: ${error.message}`);
      client.emit('error', { message: 'Failed to bulk mark as read', code: 'ERROR' });
    }
  }

  // ==================== Notifications & Presence ====================

  /**
   * Handle mark notification as read
   */
  @SubscribeMessage('markNotificationRead')
  async handleMarkNotificationRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { notificationId?: string },
  ): Promise<void> {
    try {
      const userId = client.data.user.id;
      const { notificationId } = payload;

      if (notificationId) {
        // Mark single notification as read
        await this.notificationsService.markOneAsRead(userId, notificationId);
      } else {
        // Mark all as read
        await this.notificationsService.markAsRead(userId, {});
      }

      // Send success response
      client.emit('notificationsMarkedRead', {
        success: true,
        notificationId: notificationId || 'all',
      });

      this.logger.debug(`Notifications marked as read by ${userId}`);

    } catch (error) {
      this.logger.error(`Mark notification read error: ${error.message}`);
      client.emit('error', { message: error.message || 'Failed to mark notifications as read', code: 'ERROR' });
    }
  }

  /**
   * Handle get unread notification count
   */
  @SubscribeMessage('getUnreadCount')
  async handleGetUnreadCount(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    try {
      const userId = client.data.user.id;
      const count = await this.notificationsService.getUnreadCount(userId);

      client.emit('unreadCount', { count });

    } catch (error) {
      this.logger.error(`Get unread count error: ${error.message}`);
      client.emit('error', { message: 'Failed to get unread count', code: 'ERROR' });
    }
  }

  /**
   * Handle set user status (online/away/busy)
   */
  @SubscribeMessage('setStatus')
  async handleSetStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { status: 'online' | 'away' | 'busy' | 'offline' },
  ): Promise<void> {
    try {
      const userId = client.data.user.id;
      const { status } = payload;

      // Update status in Redis
      const isOnline = status === 'online';
      await this.redisService.hset(RedisKeys.user.status(userId), {
        online: isOnline ? 'true' : 'false',
        lastSeen: Date.now().toString(),
      });
      await this.redisService.expire(
        RedisKeys.user.status(userId),
        isOnline ? 300 : 3600, // 5 min for online, 1 hour for others
      );

      if (isOnline) {
        await this.redisService.sadd(RedisKeys.usersOnline(), userId);
      } else {
        await this.redisService.srem(RedisKeys.usersOnline(), userId);
      }

      // Update status in database
      await this.usersService.updateUserStatus(userId, status);

      // Broadcast status change
      this.broadcastUserStatus(userId, status);

      client.emit('statusSet', { success: true, status });

      this.logger.debug(`User ${userId} set status to ${status}`);

    } catch (error) {
      this.logger.error(`Set status error: ${error.message}`);
      client.emit('error', { message: 'Failed to set status', code: 'ERROR' });
    }
  }

  /**
   * Handle get online users
   */
  @SubscribeMessage('getOnlineUsers')
  async handleGetOnlineUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    try {
      const onlineUsers = await this.getOnlineUsers();
      client.emit('onlineUsers', { users: onlineUsers });
    } catch (error) {
      this.logger.error(`Get online users error: ${error.message}`);
      client.emit('error', { message: 'Failed to get online users', code: 'ERROR' });
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Check if user is a room member
   */
  private async isRoomMember(roomId: string, userId: string): Promise<boolean> {
    try {
      // Check cache first
      const cached = await this.redisService.sismember(
        RedisKeys.room.members(roomId),
        userId,
      );
      if (cached) {
        return true;
      }

      // TODO: Check database if not in cache
      // This will be implemented when we integrate with RoomsService
      return true; // Temporary - always allow for now
    } catch (error) {
      this.logger.error(`Error checking room membership: ${error.message}`);
      return false;
    }
  }

  /**
   * Broadcast user status change
   */
  private broadcastUserStatus(
    userId: string,
    status: 'online' | 'offline' | 'away' | 'busy',
  ): void {
    // Broadcast to all connected clients
    this.server.emit('userStatusChanged', {
      userId,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Check if user is online
   */
  private async isUserOnline(userId: string): Promise<boolean> {
    const online = await this.redisService.hget(
      RedisKeys.user.status(userId),
      'online',
    );
    return online === 'true';
  }

  /**
   * Get list of online users
   */
  private async getOnlineUsers(): Promise<string[]> {
    return this.redisService.smembers(RedisKeys.usersOnline());
  }

  /**
   * Get user's connection count
   */
  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }

  /**
   * Start typing timer to auto-clear typing status
   */
  private startTypingTimer(userId: string, roomId: string): void {
    // Clear existing timer
    this.clearTypingTimer(userId);

    // Set new timer
    const timer = setTimeout(() => {
      // Auto-clear typing status after timeout
      this.server.to(`room:${roomId}`).emit('typing', {
        userId,
        roomId,
        isTyping: false,
        timestamp: new Date().toISOString(),
      });
      this.typingTimers.delete(userId);
    }, this.TYPING_TIMEOUT);

    this.typingTimers.set(userId, timer);
  }

  /**
   * Clear typing timer
   */
  private clearTypingTimer(userId: string): void {
    const timer = this.typingTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(userId);
    }
  }

  /**
   * Get connection statistics
   */
  private getConnectionStats(): { connections: number; rooms: number } {
    return {
      connections: this.server.sockets.sockets.size,
      rooms: this.server.sockets.adapter.rooms.size,
    };
  }

  // ==================== Public Methods for Services ====================

  /**
   * Broadcast message to room
   * Called by MessagesService after creating a message
   */
  broadcastToRoom(roomId: string, event: string, data: any): void {
    this.server.to(`room:${roomId}`).emit(event, data);
  }

  /**
   * Broadcast to user
   * Called by NotificationsService for push notifications
   */
  broadcastToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Broadcast to DM conversation
   */
  broadcastToDM(userId1: string, userId2: string, event: string, data: any): void {
    const sortedIds = [userId1, userId2].sort();
    this.server.to(`dm:${sortedIds[0]}:${sortedIds[1]}`).emit(event, data);
  }
}
