# VinClassroom API - Architecture Decisions

> **Mục đích:** Ghi lại các quyết định kiến trúc quan trọng để tham chiếu sau này.

---

## ADR-001: Stack Technology

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Context
Backend cho ứng dụng chat/classroom với real-time requirements.

### Decision
- **Framework:** NestJS (TypeScript, modular, built-in DI)
- **Database:** Supabase (PostgreSQL) - Auth + Storage built-in
- **Cache:** Redis (external server) - Hot data, sessions, Pub/Sub
- **Real-time:** Socket.io (WebSocket) + Redis Adapter

### Consequences
✅ **Pros:**
- Supabase giảm thiểu boilerplate auth
- Redis đóng vai trò cache + message broker
- NestJS dễ scale và test

❌ **Cons:**
- Redis external cần quản lý connection riêng
- Supabase RLS policy cần cấu hình cẩn thận

---

## ADR-002: Data Storage Strategy (Hot/Warm/Cold)

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Context
Cần tối ưu hiệu suất cho chat application với lượng message lớn.

### Decision
| Tier | Storage | Data | TTL |
|------|---------|------|-----|
| Hot | Redis | Recent messages, online users, unread counts, typing indicators | 24h |
| Warm | Redis + Supabase | User profiles, room metadata, last 100 messages per room | 7d |
| Cold | Supabase | Old messages, edit history, deleted items, analytics | Permanent |

### Implementation
```
Redis Keys Pattern:
- msg:{id} - Single message
- room:messages:{id} - Recent messages list
- user:online:{id} - Online status
- user:notifications:unread:{id} - Unread count
- typing:{roomId}:{userId} - Typing indicator
```

---

## ADR-003: Module Structure

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Context
Cần organize code cho feature-rich API.

### Decision
```
src/
├── config/          # App configs
├── common/          # Shared decorators, guards, pipes
├── database/        # Supabase module
├── redis/           # Redis module
├── modules/         # Business logic
│   ├── auth/
│   ├── users/
│   ├── spaces/
│   ├── rooms/
│   ├── members/
│   ├── messages/
│   ├── dms/
│   ├── files/
│   ├── notifications/
│   └── search/
└── gateways/        # WebSocket gateways
```

### Rules
- Mỗi module có: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/*.ts`
- Shared logic vào `common/`
- Không import cross-module trực tiếp, dùng DI

---

## ADR-004: Authentication Strategy

**Date:** 2026-04-10  
**Status:** 🔄 Proposed

### Context
Xác thực user và bảo vệ API endpoints.

### Decision
- **Primary:** JWT Access Token (15m expiry) + Refresh Token (7d)
- **Provider:** Supabase Auth
- **Storage:** HttpOnly cookie (recommend) hoặc localStorage

### Flow
```
1. Login/Register → Supabase Auth
2. Return: { access_token, refresh_token, user }
3. Client gửi access_token trong header: `Authorization: Bearer {token}`
4. JWT Guard verify token
5. Refresh token khi access_token hết hạn
```

---

## ADR-005: Rate Limiting

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Decision
Dùng `@nestjs/throttler` với 3 tiers:

| Tier | TTL | Limit | Applied To |
|------|-----|-------|------------|
| short | 1s | 10 | General API |
| medium | 10s | 30 | Message operations |
| long | 60s | 100 | File uploads, search |

Specific limits:
- Login: 5 requests / 1 hour / IP
- Messages: 30 requests / 1 minute / user

---

## ADR-006: Error Handling

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Decision
Global exception filter với format:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-04-10T01:00:00.000Z",
  "path": "/api/rooms"
}
```

### Implementation
- `HttpExceptionFilter` global trong `main.ts`
- Custom exceptions kế thừa `HttpException`
- Không throw raw Error

---

## ADR-007: Database Migration

**Date:** 2026-04-10  
**Status:** 🔄 Proposed

### Decision
- Dùng Supabase SQL Editor cho migrations
- Lưu migrations trong `migrations/*.sql`
- Đặt tên: `{timestamp}_{description}.sql`

### Tables chính
- profiles (extends auth.users)
- spaces
- rooms
- space_members
- room_members
- messages
- message_attachments
- reactions
- dm_conversations
- dm_messages
- notifications
- blocked_users
- files

---

## ADR-008: WebSocket Events

**Date:** 2026-04-10  
**Status:** 🔄 Proposed

### Decision
Namespace: `chat`

### Client → Server Events
| Event | Payload | Description |
|-------|---------|-------------|
| `join_room` | `{ roomId: string }` | Join a room |
| `leave_room` | `{ roomId: string }` | Leave a room |
| `send_message` | `{ roomId, content, replyTo? }` | Send message |
| `typing` | `{ roomId: string, isTyping: boolean }` | Typing indicator |
| `add_reaction` | `{ messageId, emoji }` | Add reaction |
| `remove_reaction` | `{ messageId, emoji }` | Remove reaction |

### Server → Client Events
| Event | Payload | Description |
|-------|---------|-------------|
| `new_message` | Message object | New message in room |
| `message_updated` | Message object | Message edited |
| `message_deleted` | `{ messageId }` | Message deleted |
| `reaction_added` | Reaction object | Reaction added |
| `reaction_removed` | Reaction object | Reaction removed |
| `typing_start` | `{ userId, roomId }` | User typing |
| `typing_stop` | `{ userId, roomId }` | User stopped typing |
| `user_online` | `{ userId }` | User came online |
| `user_offline` | `{ userId }` | User went offline |

---

## ADR-009: Redis Key Naming Convention

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Format
```
{type}:{entity}:{id}[:{subentity}]
```

### Examples
```
# Messages
msg:{messageId}                    # Single message data
room:messages:{roomId}             # Sorted set: score=timestamp, member=messageId
msg:replies:{messageId}            # Thread replies
msg:edithistory:{messageId}        # Edit history

# Rooms
room:metadata:{roomId}             # Room info hash
room:pinned:{roomId}               # Pinned messages set
room:members:{roomId}              # Room members set

# Users
user:profile:{userId}              # User profile hash
user:sessions:{userId}             # Active sessions
user:online:{userId}               # Online status
user:notifications:unread:{userId} # Unread count
user:typing:{roomId}:{userId}      # Typing indicator (TTL 5s)

# Direct Messages
dm:{conversationId}                # DM metadata
dm:messages:{conversationId}       # DM messages

# Rate Limiting
ratelimit:{key}:{identifier}       # Rate limit counter

# Search Cache
search:{hash(query)}               # Search results cache
```

---

## ADR-010: API Response Format

**Date:** 2026-04-10  
**Status:** ✅ Accepted

### Decision
Dùng Transform Interceptor để wrap response:

```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2026-04-10T01:00:00.000Z",
    "requestId": "uuid"
  }
}
```

### Pagination
```json
{
  "data": [ ... ],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

## Pending Decisions

| Topic | Options | Notes |
|-------|---------|-------|
| File upload | Supabase Storage / Direct S3 | Cần evaluate bandwidth |
| Search engine | Supabase Full-text / Algolia | |
| Push notifications | Firebase / OneSignal | Mobile app dependency |
| Message encryption | E2E / At-rest only | Compliance requirement? |

---

*Mỗi khi có quyết định mới, thêm vào file này với format ADR-XXX.*
