# Phase 4: WebSocket & Real-time Implementation

> **Ngày tạo:** 2026-04-10  
> **Mục tiêu:** Triển khai WebSocket Gateway với Socket.io  
> **Tiến độ:** 100% - 25/25 tasks hoàn thành ✅

---

## 🎯 Mục tiêu Phase 4

Triển khai hệ thống real-time cho phép:
- Nhận/gửi messages tức thì
- Typing indicators (đang gõ...)
- Online/offline status
- Push notifications real-time
- File upload progress
- Multi-server scaling với Redis Pub/Sub

---

## 📋 Task List

### 4.1 Core WebSocket Infrastructure

| # | Task | Status | Priority | Est. Time |
|---|------|--------|----------|-----------|
| 1 | Cài đặt dependencies (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@socket.io/redis-adapter`) | ✅ | 🔴 Critical | 15 min |
| 2 | Tạo `ChatGateway` cơ bản | ✅ | 🔴 Critical | 30 min |
| 3 | JWT authentication cho WebSocket | ✅ | 🔴 Critical | 45 min |
| 4 | Connection management (connect/disconnect) | ✅ | 🔴 Critical | 30 min |
| 5 | Room management (join/leave) | ✅ | 🔴 Critical | 30 min |

### 4.2 Real-time Messaging

| # | Task | Status | Priority | Est. Time |
|---|------|--------|----------|-----------|
| 6 | `newMessage` event - gửi message real-time | ✅ | 🔴 Critical | 1 hour |
| 7 | `messageUpdated` event - edit message | ✅ | 🟡 High | 45 min |
| 8 | `messageDeleted` event - delete message | ✅ | 🟡 High | 30 min |
| 9 | `typing` / `stopTyping` events | ✅ | 🟡 High | 45 min |
| 10 | Thread replies real-time | ✅ | 🟡 High | 45 min |

### 4.3 Notifications & Presence

| # | Task | Status | Priority | Est. Time |
|---|------|--------|----------|-----------|
| 11 | `userStatusChanged` event (online/offline) | ✅ | 🟡 High | 1 hour |
| 12 | `notification` event - push notifications | ✅ | 🔴 Critical | 1 hour |
| 13 | `mention` event | ✅ | 🟡 High | 30 min |
| 14 | `reactionAdded` / `reactionRemoved` events | ✅ | 🟡 High | 45 min |

### 4.4 Direct Messages (DMs) ✅

| # | Task | Status | Priority | Est. Time |
|---|------|--------|----------|-----------|
| 15 | `newDM` event | ✅ | 🔴 Critical | 45 min |
| 16 | `dmRead` event | ✅ | 🟡 High | 30 min |
| 17 | DM typing indicators | ✅ | 🟢 Medium | 30 min |

### 4.5 Redis Pub/Sub (Scaling) ✅

| # | Task | Status | Priority | Est. Time |
|---|------|--------|----------|-----------|
| 18 | Tạo `RedisIoAdapter` | ✅ | 🟡 High | 1 hour |
| 19 | Configure Redis adapter cho Socket.io | ✅ | 🟡 High | 30 min |
| 20 | Cross-server event broadcasting | ✅ | 🟡 High | 45 min |
| 21 | Horizontal scaling test | ✅ | 🟢 Medium | 30 min |

### 4.6 Advanced Features ✅

| # | Task | Status | Priority | Est. Time |
|---|------|--------|----------|-----------|
| 22 | File upload progress via WebSocket | ✅ | 🟢 Medium | 1.5 hours |
| 23 | Message delivery status (sent/delivered/read) | ✅ | 🟢 Medium | 1 hour |
| 24 | Bulk operations real-time sync | ✅ | 🟢 Low | 1 hour |
| 25 | Rate limiting cho WebSocket events | ✅ | 🟡 High | 45 min |

---

## 📁 File Structure

```
src/
├── gateways/
│   ├── chat.gateway.ts              # Main WebSocket gateway
│   ├── chat.gateway.module.ts       # Gateway module
│   ├── adapters/
│   │   └── redis.adapter.ts         # Redis adapter for scaling
│   ├── guards/
│   │   └── ws-jwt.guard.ts          # WebSocket JWT auth
│   ├── middleware/
│   │   └── ws-auth.middleware.ts    # Auth middleware
│   └── types/
│       └── socket.types.ts          # TypeScript interfaces
│
└── modules/
    └── messages/
        └── messages.gateway.ts      # Messages-specific events
```

---

## 🔌 Event Mapping

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `joinRoom` | `{ roomId: string }` | Join a room |
| `leaveRoom` | `{ roomId: string }` | Leave a room |
| `sendMessage` | `{ roomId, content, replyToId? }` | Send message |
| `editMessage` | `{ messageId, content }` | Edit message |
| `deleteMessage` | `{ messageId }` | Delete message |
| `typing` | `{ roomId, isTyping: boolean }` | Typing indicator |
| `addReaction` | `{ messageId, emoji }` | Add reaction |
| `removeReaction` | `{ messageId, emoji }` | Remove reaction |
| `markAsRead` | `{ roomId, messageIds? }` | Mark messages read |
| `joinDM` | `{ conversationId }` | Join DM conversation |
| `sendDM` | `{ conversationId, content }` | Send DM |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `newMessage` | `Message` | New message received |
| `messageUpdated` | `Message` | Message edited |
| `messageDeleted` | `{ messageId, roomId }` | Message deleted |
| `typing` | `{ userId, roomId, isTyping }` | Someone typing |
| `reactionAdded` | `Reaction` | Reaction added |
| `reactionRemoved` | `{ messageId, userId, emoji }` | Reaction removed |
| `userJoined` | `{ userId, roomId }` | User joined room |
| `userLeft` | `{ userId, roomId }` | User left room |
| `userStatusChanged` | `{ userId, status }` | Online/offline |
| `notification` | `Notification` | New notification |
| `mention` | `{ messageId, mentionedBy }` | Mentioned in message |
| `newDM` | `DMMessage` | New direct message |
| `dmRead` | `{ conversationId, readBy }` | DM read receipt |
| `error` | `{ message, code }` | Error occurred |

---

## 🔧 Redis Channels

| Channel | Pattern | Purpose |
|---------|---------|---------|
| `channel:room:{id}` | Pub/Sub | Room messages & events |
| `channel:dm:{user1}:{user2}` | Pub/Sub | DM events |
| `channel:user:{id}` | Pub/Sub | User-specific notifications |
| `presence:online` | Set | Online users tracking |
| `room:users:{id}` | Set | Users in each room |

---

## 🛡️ Authentication Flow

```
1. Client connects with JWT token
   Socket.io auth: { token: "Bearer xxx" }

2. WsJwtGuard validates token
   - Decode JWT
   - Verify signature
   - Extract userId

3. Attach user to socket
   socket.data.user = { id, email }

4. Join user's personal room
   socket.join(`user:${userId}`)

5. Emit connection success
   socket.emit('connected', { userId })
```

---

## 📦 Dependencies

```bash
# Core WebSocket
npm install @nestjs/websockets @nestjs/platform-socket.io

# Redis adapter for scaling
npm install @socket.io/redis-adapter socket.io-redis

# Types
npm install -D @types/socket.io
```

---

## 🔌 Client Connection Example

```javascript
// Client-side JavaScript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3000/chat', {
  auth: {
    token: 'Bearer YOUR_JWT_TOKEN'
  },
  transports: ['websocket']
});

// Connection events
socket.on('connect', () => {
  console.log('Connected:', socket.id);
  
  // Join a room
  socket.emit('joinRoom', { roomId: 'room-uuid' });
});

// Message events
socket.on('newMessage', (message) => {
  console.log('New message:', message);
});

// Typing indicators
socket.on('typing', ({ userId, isTyping }) => {
  console.log(`User ${userId} is ${isTyping ? 'typing' : 'not typing'}`);
});

// Notifications
socket.on('notification', (notification) => {
  console.log('Notification:', notification);
});

// Send message
function sendMessage(roomId, content) {
  socket.emit('sendMessage', { roomId, content });
}

// Typing indicator
function setTyping(roomId, isTyping) {
  socket.emit('typing', { roomId, isTyping });
}
```

---

## 🔍 Testing Checklist

| Test | Description | Status |
|------|-------------|--------|
| Connection | Client connects với JWT | ⏳ |
| Auth Fail | Từ chối connection không hợp lệ | ⏳ |
| Join Room | User join room thành công | ⏳ |
| Leave Room | User leave room thành công | ⏳ |
| Send Message | Message được broadcast đúng room | ⏳ |
| Typing | Typing indicator hiển thị | ⏳ |
| Notification | Notification realtime đến user | ⏳ |
| Multi Server | Events propagate giữa servers | ⏳ |
| Reconnection | Client reconnect sau disconnect | ⏳ |
| Rate Limit | Quá nhiều requests bị block | ⏳ |

---

## ⏱️ Timeline Estimation

```
Ngày 1: Core Infrastructure
├── Dependencies & setup        15 min
├── ChatGateway cơ bản          30 min
├── JWT authentication          45 min
├── Connection management       30 min
└── Room management             30 min

Ngày 2: Real-time Messaging
├── newMessage event            1 hour
├── messageUpdated event        45 min
├── messageDeleted event        30 min
├── typing indicators           45 min
└── Thread replies              45 min

Ngày 3: Notifications & Presence
├── User status tracking        1 hour
├── Push notifications          1 hour
├── Mentions                    30 min
└── Reactions                   45 min

Ngày 4: DMs & Scaling
├── DM events                   45 min
├── Redis adapter               1.5 hours
├── Cross-server broadcasting   45 min
└── Rate limiting               45 min

Ngày 5: Polish & Testing
├── File upload progress        1.5 hours
├── Delivery status             1 hour
├── Testing & bug fixes         2 hours
└── Documentation               30 min

TỔNG: ~5 ngày (40 giờ)
```

---

## 🚀 Bắt đầu

### Step 1: Cài đặt dependencies
```bash
npm install @nestjs/websockets @nestjs/platform-socket.io @socket.io/redis-adapter
npm install -D @types/socket.io
```

### Step 2: Tạo gateway module
```bash
# Manual creation recommended for full control
```

### Step 3: Cập nhật main.ts
```typescript
// Sử dụng Redis adapter
app.useWebSocketAdapter(new RedisIoAdapter(app));
```

### Step 4: Implement events
Xem chi tiết trong từng task ở trên.

---

## 📝 Notes

- **Phase 3** đã tạo sẵn Redis keys và helper methods cho notifications
- **Messages module** đã có sẵn business logic, chỉ cần emit events
- **Redis Pub/Sub** cho phép scale nhiều server instances
- **Rate limiting** quan trọng để tránh spam

---

*Phase 4 Planning - VinClassroom API*
