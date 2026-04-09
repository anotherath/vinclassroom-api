/**
 * Redis Key Patterns for VinClassroom
 * Based on: plans/redis-data-structure.md
 */

export const RedisKeys = {
  // Sessions
  session: (userId: string) => `session:${userId}`,
  refreshToken: (userId: string) => `refreshToken:${userId}`,

  // Rate Limiting
  rateLimit: {
    login: (ip: string) => `rate:login:${ip}`,
    message: (userId: string) => `rate:message:${userId}`,
    api: (userId: string, endpoint: string) => `rate:api:${userId}:${endpoint}`,
  },

  // Users
  user: {
    profile: (userId: string) => `user:profile:${userId}`,
    status: (userId: string) => `user:status:${userId}`,
    spaces: (userId: string) => `user:spaces:${userId}`,
    dms: (userId: string) => `user:dms:${userId}`,
    reactions: (userId: string) => `user:reactions:${userId}`,
    unread: (userId: string, roomId: string) => `user:unread:${userId}:${roomId}`,
    unreadTotal: (userId: string) => `user:unreadtotal:${userId}`,
    mentions: (userId: string) => `user:mentions:${userId}`,
    mentionCount: (userId: string) => `user:mentioncount:${userId}`,
    notifications: (userId: string) => `user:notifications:${userId}:recent`,
    notificationsUnread: (userId: string) => `user:notifications:unread:${userId}`,
    filesRecent: (userId: string) => `user:files:recent:${userId}`,
  },

  // Global
  usersOnline: () => 'users:online',

  // Spaces
  space: {
    byId: (spaceId: string) => `space:${spaceId}`,
    rooms: (spaceId: string) => `space:rooms:${spaceId}`,
    members: (spaceId: string) => `space:members:${spaceId}`,
    roomInfo: (spaceId: string, roomId: string) => `space:roominfo:${spaceId}:${roomId}`,
    stats: (spaceId: string) => `space:stats:${spaceId}`,
    invites: (spaceId: string) => `space:invites:${spaceId}`,
    filesShared: (spaceId: string) => `space:files:shared:${spaceId}`,
  },

  // Rooms
  room: {
    byId: (roomId: string) => `room:${roomId}`,
    members: (roomId: string) => `room:members:${roomId}`,
    messages: (roomId: string) => `room:messages:${roomId}`,
    msgCount: (roomId: string) => `room:msgcount:${roomId}`,
    pinned: (roomId: string) => `room:pinned:${roomId}`,
    stats: (roomId: string) => `room:stats:${roomId}`,
    typing: (roomId: string) => `room:typing:${roomId}`,
  },

  // Messages
  message: {
    byId: (messageId: string) => `msg:${messageId}`,
    editHistory: (messageId: string) => `msg:edithistory:${messageId}`,
    replies: (parentId: string) => `msg:replies:${parentId}`,
    replyCount: (messageId: string) => `msg:replycount:${messageId}`,
  },

  // Reactions
  reaction: {
    byMessage: (messageId: string) => `react:msg:${messageId}`,
  },

  // Mentions
  mention: {
    byMessage: (messageId: string) => `mention:msg:${messageId}`,
  },

  // DMs
  dm: {
    byId: (userId1: string, userId2: string) => {
      const sorted = [userId1, userId2].sort();
      return `dm:${sorted[0]}:${sorted[1]}`;
    },
    messages: (userId1: string, userId2: string) => {
      const sorted = [userId1, userId2].sort();
      return `dm:messages:${sorted[0]}:${sorted[1]}`;
    },
    typing: (userId1: string, userId2: string) => {
      const sorted = [userId1, userId2].sort();
      return `dm:typing:${sorted[0]}:${sorted[1]}`;
    },
    unread: (userId: string, otherUserId: string) => `user:dm:unread:${userId}:${otherUserId}`,
  },

  // Search
  search: {
    result: (queryHash: string) => `search:${queryHash}`,
    popular: (type: string) => `search:popular:${type}`,
  },

  // Activity
  memberActivity: (spaceId: string, userId: string) => `member:activity:${spaceId}:${userId}`,

  // Pub/Sub Channels
  channel: {
    room: (roomId: string) => `channel:room:${roomId}`,
    dm: (userId1: string, userId2: string) => {
      const sorted = [userId1, userId2].sort();
      return `channel:dm:${sorted[0]}:${sorted[1]}`;
    },
    user: (userId: string) => `channel:user:${userId}`,
  },
} as const;

export default RedisKeys;
