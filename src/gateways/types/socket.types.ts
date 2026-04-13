import { Socket } from 'socket.io';

/**
 * Authenticated Socket with user data
 */
export interface AuthenticatedSocket extends Socket {
  data: {
    user: {
      id: string;
      email: string;
    };
    rateLimitInfo?: {
      event: string;
      remaining: number;
      limit: number;
      resetIn: number;
    };
  };
}

/**
 * WebSocket Event Payloads
 */
export interface JoinRoomPayload {
  roomId: string;
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface SendMessagePayload {
  roomId: string;
  content: string;
  replyToId?: string;
}

export interface EditMessagePayload {
  messageId: string;
  content: string;
}

export interface DeleteMessagePayload {
  messageId: string;
}

export interface TypingPayload {
  roomId: string;
  isTyping: boolean;
}

export interface AddReactionPayload {
  messageId: string;
  emoji: string;
}

export interface RemoveReactionPayload {
  messageId: string;
  emoji: string;
}

export interface MarkAsReadPayload {
  roomId: string;
  messageIds?: string[];
}

export interface SendDMPayload {
  conversationId: string;
  content: string;
}

export interface JoinDMPayload {
  conversationId: string;
}

export interface MarkDMReadPayload {
  conversationId: string;
}

export interface DMTypingPayload {
  conversationId: string;
  isTyping: boolean;
}

export interface SetStatusPayload {
  status: 'online' | 'away' | 'busy' | 'offline';
}

export interface MarkNotificationReadPayload {
  notificationId?: string;
}

export interface FileUploadProgressPayload {
  uploadId: string;
  roomId?: string;
  conversationId?: string;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  fileName?: string;
  fileSize?: number;
  error?: string;
}

export interface MessageStatusPayload {
  messageId: string;
  roomId?: string;
  conversationId?: string;
}

export interface BulkMarkAsReadPayload {
  roomId?: string;
  conversationId?: string;
  messageIds?: string[];
}

export interface RateLimitStatusPayload {
  event?: string;
}

/**
 * WebSocket Server Events (Server -> Client)
 */
export interface ServerEvents {
  newMessage: (message: any) => void;
  messageUpdated: (message: any) => void;
  messageDeleted: (data: { messageId: string; roomId: string }) => void;
  typing: (data: { userId: string; roomId: string; isTyping: boolean }) => void;
  reactionAdded: (reaction: any) => void;
  reactionRemoved: (data: { messageId: string; userId: string; emoji: string }) => void;
  userJoined: (data: { userId: string; roomId: string }) => void;
  userLeft: (data: { userId: string; roomId: string }) => void;
  userStatusChanged: (data: { userId: string; status: 'online' | 'offline' | 'away' }) => void;
  notification: (notification: any) => void;
  mention: (data: { messageId: string; mentionedBy: string }) => void;
  newDM: (message: any) => void;
  dmRead: (data: { conversationId: string; readBy: string }) => void;
  dmTyping: (data: { userId: string; conversationId: string; isTyping: boolean }) => void;
  joinedDM: (data: { conversationId: string; success: boolean }) => void;
  leftDM: (data: { conversationId: string; success: boolean }) => void;
  dmSent: (data: { success: boolean; message?: any }) => void;
  dmMarkedRead: (data: { success: boolean; conversationId: string }) => void;
  // Message delivery status
  messageDelivered: (data: { messageId: string; deliveredTo: string; deliveredAt: string }) => void;
  messageRead: (data: { messageId: string; readBy: string; readCount: number; readAt: string }) => void;
  messageStatus: (data: any) => void;
  // File upload
  fileUploadProgress: (data: any) => void;
  fileUploadProgressConfirmed: (data: any) => void;
  uploadStatus: (data: any) => void;
  // Rate limiting
  rateLimitExceeded: (data: { event: string; retryAfter?: number; limit?: number; message: string }) => void;
  rateLimitStatus: (data: any) => void;
  // Bulk operations
  bulkRead: (data: any) => void;
  bulkMarkAsReadComplete: (data: { success: boolean; roomId?: string; conversationId?: string }) => void;
  error: (error: { message: string; code?: string }) => void;
}

/**
 * WebSocket Client Events (Client -> Server)
 */
export interface ClientEvents {
  joinRoom: (payload: JoinRoomPayload) => void;
  leaveRoom: (payload: LeaveRoomPayload) => void;
  sendMessage: (payload: SendMessagePayload) => void;
  editMessage: (payload: EditMessagePayload) => void;
  deleteMessage: (payload: DeleteMessagePayload) => void;
  typing: (payload: TypingPayload) => void;
  addReaction: (payload: AddReactionPayload) => void;
  removeReaction: (payload: RemoveReactionPayload) => void;
  markAsRead: (payload: MarkAsReadPayload) => void;
  joinDM: (payload: JoinDMPayload) => void;
  sendDM: (payload: SendDMPayload) => void;
  markDMRead: (payload: MarkDMReadPayload) => void;
  dmTyping: (payload: DMTypingPayload) => void;
  leaveDM: (payload: JoinDMPayload) => void;
  markNotificationRead: (payload: MarkNotificationReadPayload) => void;
  getUnreadCount: () => void;
  setStatus: (payload: SetStatusPayload) => void;
  getOnlineUsers: () => void;
  // Message delivery status
  messageDelivered: (payload: MessageStatusPayload) => void;
  messageRead: (payload: MessageStatusPayload) => void;
  getMessageStatus: (payload: { messageId: string }) => void;
  // File upload
  fileUploadProgress: (payload: FileUploadProgressPayload) => void;
  getUploadStatus: (payload: { uploadId: string }) => void;
  // Rate limiting
  getRateLimitStatus: (payload: RateLimitStatusPayload) => void;
  // Bulk operations
  bulkMarkAsRead: (payload: BulkMarkAsReadPayload) => void;
}

/**
 * Socket Response Types
 */
export interface SocketResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
