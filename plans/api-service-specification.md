# VinClassroom API Service Specification

> **Backend Stack:** NestJS + Supabase (PostgreSQL) + Redis
> **Purpose:** This document defines all API endpoints needed for the VinClassroom frontend application. For Redis data structures, see [`redis-data-structure.md`](./redis-data-structure.md).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication API](#2-authentication-api)
3. [User API](#3-user-api)
4. [Space API](#4-space-api)
5. [Room API](#5-room-api)
6. [Message API](#6-message-api)
7. [Direct Message API](#7-direct-message-api)
8. [Member API](#8-member-api)
9. [Notification API](#9-notification-api)
10. [File API](#10-file-api)
11. [Search API](#11-search-api)
12. [WebSocket Events](#12-websocket-events)
13. [Module Structure](#13-module-structure)

---

## 1. Architecture Overview

### Data Storage Strategy

| Layer         | Storage          | Purpose                                                         |
| ------------- | ---------------- | --------------------------------------------------------------- |
| **Hot Data**  | Redis            | Recent messages, online users, unread counts, typing indicators |
| **Warm Data** | Redis + Supabase | User profiles, room metadata, message history                   |
| **Cold Data** | Supabase         | Old messages, edit history, deleted items, analytics            |

### Redis Documentation

All Redis data structures are documented in [`redis-data-structure.md`](./redis-data-structure.md). Key patterns referenced below link to that document.

### Supabase Schema

Core tables are defined in the [Database Schema](#database-schema) section at the end of this document.

---

## 2. Authentication API

**Controller:** `AuthController` (`/api/auth`)

| Method | Endpoint                | Description              | Request Body                                | Response                  | Auth Required |
| ------ | ----------------------- | ------------------------ | ------------------------------------------- | ------------------------- | ------------- |
| POST   | `/auth/register`        | Register new account     | `{ email, password, displayName, avatar? }` | `{ user, token }`         | No            |
| POST   | `/auth/login`           | Login                    | `{ email, password }`                       | `{ user, token }`         | No            |
| POST   | `/auth/logout`          | Logout                   | -                                           | `{ message }`             | Yes           |
| POST   | `/auth/refresh`         | Refresh token            | `{ refreshToken }`                          | `{ token, refreshToken }` | No            |
| GET    | `/auth/profile`         | Get current user profile | -                                           | `{ user }`                | Yes           |
| PATCH  | `/auth/profile`         | Update profile           | `{ displayName?, avatar?, bio? }`           | `{ user }`                | Yes           |
| POST   | `/auth/change-password` | Change password          | `{ currentPassword, newPassword }`          | `{ message }`             | Yes           |
| POST   | `/auth/forgot-password` | Request password reset   | `{ email }`                                 | `{ message }`             | No            |
| POST   | `/auth/reset-password`  | Reset password           | `{ token, newPassword }`                    | `{ message }`             | No            |
| POST   | `/auth/verify-email`    | Verify email             | `{ token }`                                 | `{ message }`             | No            |

### Redis Operations

| Operation           | Key Pattern             | Type   | TTL |
| ------------------- | ----------------------- | ------ | --- |
| Store session       | `session:{userId}`      | Hash   | -   |
| Rate limit login    | `rate:login:{ip}`       | String | 1h  |
| Store refresh token | `refreshToken:{userId}` | String | 7d  |
| Set online status   | `user:status:{userId}`  | Hash   | -   |
| Add to online users | `users:online`          | Set    | -   |

---

## 3. User API

**Controller:** `UserController` (`/api/users`)

| Method | Endpoint                | Description       | Request Body                    | Response                       | Auth Required |
| ------ | ----------------------- | ----------------- | ------------------------------- | ------------------------------ | ------------- |
| GET    | `/users/search`         | Search users      | Query: `{ q, limit?, offset? }` | `{ users, total }`             | Yes           |
| GET    | `/users/:userId`        | Get user profile  | -                               | `{ user }`                     | Yes           |
| GET    | `/users/:userId/status` | Get online status | -                               | `{ userId, status, lastSeen }` | Yes           |
| POST   | `/users/:userId/block`  | Block user        | -                               | `{ message }`                  | Yes           |
| DELETE | `/users/:userId/block`  | Unblock user      | -                               | `{ message }`                  | Yes           |
| GET    | `/users/blocked`        | Get blocked users | -                               | `{ blockedUsers }`             | Yes           |

### Redis Operations

| Operation         | Key Pattern             | Type       | TTL |
| ----------------- | ----------------------- | ---------- | --- |
| Cache profile     | `user:profile:{userId}` | JSON       | 1h  |
| Get status        | `user:status:{userId}`  | Hash       | -   |
| Check online      | `users:online`          | Set        | -   |
| Get user's spaces | `user:spaces:{userId}`  | Sorted Set | 5m  |
| Get user's DMs    | `user:dms:{userId}`     | Sorted Set | 5m  |

---

## 4. Space API

**Controller:** `SpaceController` (`/api/spaces`)

| Method | Endpoint                                | Description          | Request Body                                | Response                     | Auth Required |
| ------ | --------------------------------------- | -------------------- | ------------------------------------------- | ---------------------------- | ------------- |
| GET    | `/spaces`                               | Get all user spaces  | -                                           | `{ spaces }`                 | Yes           |
| GET    | `/spaces/:spaceId`                      | Get space by ID      | -                                           | `{ space }`                  | Yes           |
| POST   | `/spaces`                               | Create new space     | `{ name, description?, icon?, isPrivate? }` | `{ space }`                  | Yes           |
| PATCH  | `/spaces/:spaceId`                      | Update space         | `{ name?, description?, icon? }`            | `{ space }`                  | Yes           |
| DELETE | `/spaces/:spaceId`                      | Delete space         | -                                           | `{ message }`                | Yes           |
| GET    | `/spaces/search`                        | Search spaces        | Query: `{ q }`                              | `{ spaces }`                 | Yes           |
| GET    | `/spaces/:spaceId/rooms`                | Get rooms in space   | -                                           | `{ rooms }`                  | Yes           |
| GET    | `/spaces/:spaceId/members`              | Get space members    | -                                           | `{ members }`                | Yes           |
| POST   | `/spaces/:spaceId/members`              | Add member           | `{ userId, role? }`                         | `{ member }`                 | Yes           |
| DELETE | `/spaces/:spaceId/members/:userId`      | Remove member        | -                                           | `{ message }`                | Yes           |
| PATCH  | `/spaces/:spaceId/members/:userId/role` | Update member role   | `{ role }`                                  | `{ member }`                 | Yes           |
| POST   | `/spaces/:spaceId/invite`               | Generate invite code | -                                           | `{ inviteCode, inviteLink }` | Yes           |
| POST   | `/spaces/join/:code`                    | Join by invite code  | -                                           | `{ space }`                  | Yes           |
| POST   | `/spaces/:spaceId/leave`                | Leave space          | -                                           | `{ message }`                | Yes           |
| GET    | `/spaces/:spaceId/settings`             | Get space settings   | -                                           | `{ settings }`               | Yes           |
| PATCH  | `/spaces/:spaceId/settings`             | Update settings      | `{ ...settings }`                           | `{ settings }`               | Yes           |
| GET    | `/spaces/:spaceId/stats`                | Get space statistics | -                                           | `{ stats }`                  | Yes           |
| POST   | `/spaces/:spaceId/icon`                 | Upload space icon    | `FormData: { icon }`                        | `{ iconUrl }`                | Yes           |
| DELETE | `/spaces/:spaceId/icon`                 | Remove space icon    | -                                           | `{ message }`                | Yes           |

### Redis Operations

| Operation          | Key Pattern                         | Type       | TTL |
| ------------------ | ----------------------------------- | ---------- | --- |
| Cache space        | `space:{spaceId}`                   | Hash       | 1h  |
| Get rooms          | `space:rooms:{spaceId}`             | Set        | -   |
| Get members        | `space:members:{spaceId}`           | Set        | 5m  |
| Cache room info    | `space:roominfo:{spaceId}:{roomId}` | Hash       | 1h  |
| Update user spaces | `user:spaces:{userId}`              | Sorted Set | 5m  |
| Cache stats        | `space:stats:{spaceId}`             | Hash       | 5m  |

---

## 5. Room API

**Controller:** `RoomController` (`/api/rooms`)

| Method | Endpoint                         | Description         | Request Body                                | Response       | Auth Required |
| ------ | -------------------------------- | ------------------- | ------------------------------------------- | -------------- | ------------- |
| POST   | `/spaces/:spaceId/rooms`         | Create room         | `{ name, description?, type?, isPrivate? }` | `{ room }`     | Yes           |
| GET    | `/rooms/:roomId`                 | Get room details    | -                                           | `{ room }`     | Yes           |
| PATCH  | `/rooms/:roomId`                 | Update room         | `{ name?, description?, type? }`            | `{ room }`     | Yes           |
| DELETE | `/rooms/:roomId`                 | Delete room         | -                                           | `{ message }`  | Yes           |
| GET    | `/rooms/:roomId/members`         | Get room members    | -                                           | `{ members }`  | Yes           |
| POST   | `/rooms/:roomId/members`         | Add member          | `{ userId }`                                | `{ member }`   | Yes           |
| DELETE | `/rooms/:roomId/members/:userId` | Remove member       | -                                           | `{ message }`  | Yes           |
| GET    | `/rooms/:roomId/settings`        | Get room settings   | -                                           | `{ settings }` | Yes           |
| PATCH  | `/rooms/:roomId/settings`        | Update settings     | `{ ...settings }`                           | `{ settings }` | Yes           |
| GET    | `/rooms/:roomId/stats`           | Get room statistics | -                                           | `{ stats }`    | Yes           |

### Redis Operations

| Operation       | Key Pattern              | Type       | TTL |
| --------------- | ------------------------ | ---------- | --- |
| Cache room      | `room:{roomId}`          | Hash       | 1h  |
| Get members     | `room:members:{roomId}`  | Set        | 5m  |
| Get messages    | `room:messages:{roomId}` | Sorted Set | -   |
| Message count   | `room:msgcount:{roomId}` | String     | -   |
| Pinned messages | `room:pinned:{roomId}`   | Set        | -   |
| Cache stats     | `room:stats:{roomId}`    | Hash       | 5m  |
| Typing users    | `room:typing:{roomId}`   | Set        | 10s |

---

## 6. Message API

**Controller:** `MessageController` (`/api/rooms/:roomId/messages`)

| Method | Endpoint                                              | Description              | Request Body                                  | Response                            | Auth Required |
| ------ | ----------------------------------------------------- | ------------------------ | --------------------------------------------- | ----------------------------------- | ------------- |
| GET    | `/rooms/:roomId/messages`                             | Get messages             | Query: `{ limit?, cursor?, before?, after? }` | `{ messages, hasMore, nextCursor }` | Yes           |
| POST   | `/rooms/:roomId/messages`                             | Send message             | `{ content, attachments?, replyToId? }`       | `{ message }`                       | Yes           |
| GET    | `/rooms/:roomId/messages/:messageId`                  | Get message by ID        | -                                             | `{ message }`                       | Yes           |
| PATCH  | `/rooms/:roomId/messages/:messageId`                  | Update message           | `{ content }`                                 | `{ message }`                       | Yes           |
| DELETE | `/rooms/:roomId/messages/:messageId`                  | Delete message           | -                                             | `{ message }`                       | Yes           |
| POST   | `/rooms/:roomId/messages/:messageId/reactions`        | Add reaction             | `{ emoji }`                                   | `{ reaction }`                      | Yes           |
| DELETE | `/rooms/:roomId/messages/:messageId/reactions/:emoji` | Remove reaction          | -                                             | `{ message }`                       | Yes           |
| POST   | `/rooms/:roomId/messages/:messageId/pin`              | Pin message              | -                                             | `{ message }`                       | Yes           |
| DELETE | `/rooms/:roomId/messages/:messageId/pin`              | Unpin message            | -                                             | `{ message }`                       | Yes           |
| GET    | `/rooms/:roomId/messages/pinned`                      | Get pinned messages      | -                                             | `{ messages }`                      | Yes           |
| POST   | `/rooms/:roomId/messages/read`                        | Mark as read             | -                                             | `{ message }`                       | Yes           |
| GET    | `/rooms/:roomId/messages/unread-count`                | Get unread count         | -                                             | `{ count }`                         | Yes           |
| POST   | `/rooms/:roomId/messages/:messageId/forward`          | Forward message          | `{ targetRoomId }`                            | `{ message }`                       | Yes           |
| GET    | `/rooms/:roomId/messages/:messageId/thread`           | Get thread replies       | Query: `{ limit?, cursor? }`                  | `{ messages, hasMore }`             | Yes           |
| POST   | `/rooms/:roomId/messages/:messageId/thread`           | Send thread reply        | `{ content }`                                 | `{ message }`                       | Yes           |
| GET    | `/rooms/:roomId/messages/search`                      | Search messages          | Query: `{ q }`                                | `{ messages }`                      | Yes           |
| POST   | `/rooms/:roomId/messages/upload`                      | Upload file with message | `FormData: { file, content? }`                | `{ message, fileUrl }`              | Yes           |

### Redis Operations

| Operation      | Key Pattern                     | Type       | TTL |
| -------------- | ------------------------------- | ---------- | --- |
| Create message | `msg:{messageId}`               | Hash       | -   |
| Add to room    | `room:messages:{roomId}`        | Sorted Set | -   |
| Edit history   | `msg:edithistory:{messageId}`   | List       | 30d |
| Thread replies | `msg:replies:{parentId}`        | Sorted Set | -   |
| Reply count    | `msg:replycount:{messageId}`    | String     | -   |
| Reactions      | `react:msg:{messageId}`         | Hash       | -   |
| User unread    | `user:unread:{userId}:{roomId}` | String     | -   |
| Total unread   | `user:unreadtotal:{userId}`     | String     | -   |
| Typing         | `room:typing:{roomId}`          | Set        | 10s |
| Mentions       | `mention:msg:{messageId}`       | Set        | -   |
| User mentions  | `user:mentions:{userId}`        | Sorted Set | 7d  |

### Message Creation Flow

```bash
# 1. Create message hash
HSET msg:{messageId} id "{messageId}" roomId "{roomId}" spaceId "{spaceId}" roomType "space" senderId "{userId}" senderName "{name}" content "{content}" mentions "{mentionsJson}" timestamp {timestamp} edited "false" replyTo "{replyToId}" pinned "false" deleted "false"

# 2. Add to room messages
ZADD room:messages:{roomId} {timestamp} msg:{messageId}

# 3. If reply to message
ZADD msg:replies:{replyToId} {timestamp} msg:{messageId}
INCR msg:replycount:{replyToId}
HSET msg:{replyToId} threadReplyCount {count}

# 4. If has mentions
SADD mention:msg:{messageId} {mentionedUserId}
ZADD user:mentions:{mentionedUserId} {timestamp} msg:{messageId}
INCR user:mentioncount:{mentionedUserId}

# 5. Update room activity
HSET room:{roomId} lastActivity {timestamp}
INCR room:msgcount:{roomId}

# 6. Increment unread for other members
INCR user:unread:{otherUserId}:{roomId}
INCR user:unreadtotal:{otherUserId}

# 7. Publish to Pub/Sub
PUBLISH channel:room:{roomId} message:new
```

---

## 7. Direct Message API

**Controller:** `DMController` (`/api/dms`)

| Method | Endpoint                | Description               | Request Body                 | Response                     | Auth Required |
| ------ | ----------------------- | ------------------------- | ---------------------------- | ---------------------------- | ------------- |
| GET    | `/dms`                  | Get all DM conversations  | -                            | `{ conversations }`          | Yes           |
| GET    | `/dms/:userId`          | Get DM with user          | -                            | `{ conversation, messages }` | Yes           |
| GET    | `/dms/:userId/messages` | Get DM messages           | Query: `{ limit?, cursor? }` | `{ messages, hasMore }`      | Yes           |
| POST   | `/dms/:userId/messages` | Send DM message           | `{ content, attachments? }`  | `{ message }`                | Yes           |
| POST   | `/dms/:userId/read`     | Mark DM as read           | -                            | `{ message }`                | Yes           |
| GET    | `/dms/unread-count`     | Get total unread DM count | -                            | `{ count }`                  | Yes           |

### Redis Operations

| Operation   | Key Pattern                     | Type       | TTL |
| ----------- | ------------------------------- | ---------- | --- |
| DM metadata | `dm:{dmId}`                     | Hash       | -   |
| DM messages | `dm:messages:{dmId}`            | Sorted Set | -   |
| User DMs    | `user:dms:{userId}`             | Sorted Set | 5m  |
| DM unread   | `user:dm:unread:{userId}`       | String     | -   |
| DM typing   | `dm:typing:{userId1}:{userId2}` | Set        | 10s |

### DM ID Generation

DM IDs are generated by sorting user IDs alphabetically:

```
dm:{userId1}:{userId2}  # where userId1 < userId2 alphabetically
Example: dm:alice:bob
```

---

## 8. Member API

**Controller:** `MemberController` (`/api/spaces/:spaceId/members`)

| Method | Endpoint                                    | Description         | Request Body   | Response       | Auth Required |
| ------ | ------------------------------------------- | ------------------- | -------------- | -------------- | ------------- |
| GET    | `/spaces/:spaceId/members`                  | Get all members     | -              | `{ members }`  | Yes           |
| GET    | `/spaces/:spaceId/members/search`           | Search members      | Query: `{ q }` | `{ members }`  | Yes           |
| GET    | `/spaces/:spaceId/members/:userId/role`     | Get member role     | -              | `{ role }`     | Yes           |
| PATCH  | `/spaces/:spaceId/members/:userId/role`     | Update role         | `{ role }`     | `{ member }`   | Yes           |
| GET    | `/spaces/:spaceId/members/:userId/activity` | Get member activity | -              | `{ activity }` | Yes           |

### Redis Operations

| Operation       | Key Pattern                          | Type | TTL |
| --------------- | ------------------------------------ | ---- | --- |
| Member activity | `member:activity:{spaceId}:{userId}` | Hash | 1h  |
| Space members   | `space:members:{spaceId}`            | Set  | 5m  |
| Room members    | `room:members:{roomId}`              | Set  | 5m  |

---

## 9. Notification API

**Controller:** `NotificationController` (`/api/notifications`)

| Method | Endpoint                              | Description               | Request Body                        | Response                     | Auth Required |
| ------ | ------------------------------------- | ------------------------- | ----------------------------------- | ---------------------------- | ------------- |
| GET    | `/notifications`                      | Get notifications         | Query: `{ limit?, cursor?, type? }` | `{ notifications, hasMore }` | Yes           |
| GET    | `/notifications/unread-count`         | Get unread count          | -                                   | `{ count }`                  | Yes           |
| POST   | `/notifications/:notificationId/read` | Mark as read              | -                                   | `{ notification }`           | Yes           |
| POST   | `/notifications/read-all`             | Mark all as read          | -                                   | `{ message }`                | Yes           |
| DELETE | `/notifications/:notificationId`      | Delete notification       | -                                   | `{ message }`                | Yes           |
| GET    | `/notifications/settings`             | Get notification settings | -                                   | `{ settings }`               | Yes           |
| PATCH  | `/notifications/settings`             | Update settings           | `{ ...settings }`                   | `{ settings }`               | Yes           |

### Redis Operations

| Operation            | Key Pattern                          | Type          | TTL |
| -------------------- | ------------------------------------ | ------------- | --- |
| Unread count         | `user:notifications:unread:{userId}` | String        | -   |
| Recent notifications | `user:notifications:{userId}:recent` | List (max 50) | 7d  |
| Pub/Sub              | `channel:user:{userId}`              | Pub/Sub       | -   |

---

## 10. File API

**Controller:** `FileController` (`/api/files`)

| Method | Endpoint                  | Description      | Request Body                           | Response      | Auth Required |
| ------ | ------------------------- | ---------------- | -------------------------------------- | ------------- | ------------- |
| GET    | `/files/recent`           | Get recent files | Query: `{ limit?, spaceId? }`          | `{ files }`   | Yes           |
| GET    | `/files/shared`           | Get shared files | Query: `{ spaceId?, roomId?, limit? }` | `{ files }`   | Yes           |
| GET    | `/files/search`           | Search files     | Query: `{ q, spaceId? }`               | `{ files }`   | Yes           |
| GET    | `/files/:fileId`          | Get file details | -                                      | `{ file }`    | Yes           |
| GET    | `/files/:fileId/download` | Download file    | -                                      | `File stream` | Yes           |
| DELETE | `/files/:fileId`          | Delete file      | -                                      | `{ message }` | Yes           |
| POST   | `/files/:fileId/share`    | Share file       | `{ targetRoomId? }`                    | `{ file }`    | Yes           |

### Redis Operations

| Operation    | Key Pattern                    | Type          | TTL |
| ------------ | ------------------------------ | ------------- | --- |
| Recent files | `user:files:recent:{userId}`   | List (max 20) | 1h  |
| Shared files | `space:files:shared:{spaceId}` | JSON          | 5m  |

---

## 11. Search API

**Controller:** `SearchController` (`/api/search`)

| Method | Endpoint           | Description              | Request Body                    | Response       | Auth Required |
| ------ | ------------------ | ------------------------ | ------------------------------- | -------------- | ------------- |
| GET    | `/search`          | Global search            | Query: `{ q, type?, spaceId? }` | `{ results }`  | Yes           |
| GET    | `/search/messages` | Search messages globally | Query: `{ q, spaceId? }`        | `{ messages }` | Yes           |
| GET    | `/search/users`    | Search users             | Query: `{ q }`                  | `{ users }`    | Yes           |
| GET    | `/search/spaces`   | Search spaces            | Query: `{ q }`                  | `{ spaces }`   | Yes           |

### Redis Operations

| Operation        | Key Pattern             | Type       | TTL |
| ---------------- | ----------------------- | ---------- | --- |
| Search cache     | `search:{queryHash}`    | JSON       | 1m  |
| Popular searches | `search:popular:{type}` | Sorted Set | 1h  |

---

## 12. WebSocket Events

**Gateway:** `ChatGateway` (Socket.io)

### Connection

- **Auth:** Token-based authentication via `auth: { token }`
- **Transports:** `["websocket"]`

### Events

| Event               | Direction       | Payload                        | Description         |
| ------------------- | --------------- | ------------------------------ | ------------------- |
| `joinRoom`          | Client → Server | `{ roomId }`                   | Join a room         |
| `leaveRoom`         | Client → Server | `{ roomId }`                   | Leave a room        |
| `newMessage`        | Server → Client | `{ message }`                  | New message         |
| `messageDeleted`    | Server → Client | `{ messageId, roomId }`        | Message deleted     |
| `messageUpdated`    | Server → Client | `{ message }`                  | Message edited      |
| `messagePinned`     | Server → Client | `{ message }`                  | Message pinned      |
| `reactionAdded`     | Server → Client | `{ reaction }`                 | Reaction added      |
| `reactionRemoved`   | Server → Client | `{ messageId, emoji, userId }` | Reaction removed    |
| `typing`            | Server → Client | `{ userId, roomId }`           | User typing         |
| `stopTyping`        | Server → Client | `{ userId, roomId }`           | Stop typing         |
| `userStatusChanged` | Server → Client | `{ userId, status }`           | Status changed      |
| `userJoined`        | Server → Client | `{ userId, roomId }`           | User joined room    |
| `userLeft`          | Server → Client | `{ userId, roomId }`           | User left room      |
| `memberJoinedSpace` | Server → Client | `{ userId, spaceId }`          | Member joined space |
| `memberLeftSpace`   | Server → Client | `{ userId, spaceId }`          | Member left space   |
| `newDM`             | Server → Client | `{ message, conversation }`    | New DM              |
| `dmRead`            | Server → Client | `{ userId, conversationId }`   | DM read receipt     |
| `notification`      | Server → Client | `{ notification }`             | New notification    |

### Pub/Sub Integration

WebSocket events are triggered by Redis Pub/Sub messages:

```
channel:room:{roomId}    → message:new, message:edit, message:delete, reaction:add
channel:dm:{dmId}        → message:new, message:edit, typing:start, typing:stop
channel:user:{userId}    → mention:new, dm:new, status:change, notification:new
```

---

## 13. Module Structure

```
src/
├── auth/
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── auth.module.ts
├── users/
│   ├── users.controller.ts
│   ├── users.service.ts
│   └── users.module.ts
├── spaces/
│   ├── spaces.controller.ts
│   ├── spaces.service.ts
│   └── spaces.module.ts
├── rooms/
│   ├── rooms.controller.ts
│   ├── rooms.service.ts
│   └── rooms.module.ts
├── messages/
│   ├── messages.controller.ts
│   ├── messages.service.ts
│   └── messages.module.ts
├── dms/
│   ├── dms.controller.ts
│   ├── dms.service.ts
│   └── dms.module.ts
├── members/
│   ├── members.controller.ts
│   ├── members.service.ts
│   └── members.module.ts
├── notifications/
│   ├── notifications.controller.ts
│   ├── notifications.service.ts
│   └── notifications.module.ts
├── files/
│   ├── files.controller.ts
│   ├── files.service.ts
│   └── files.module.ts
├── search/
│   ├── search.controller.ts
│   ├── search.service.ts
│   └── search.module.ts
├── gateways/
│   ├── chat.gateway.ts
│   └── chat.gateway.module.ts
├── common/
│   ├── decorators/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   └── pipes/
└── app.module.ts
```

---

## Database Schema

### Core Tables (Supabase)

```sql
-- Users (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  status TEXT DEFAULT 'offline',
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spaces
CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  owner_id UUID REFERENCES profiles(id),
  is_private BOOLEAN DEFAULT false,
  invite_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'text',
  is_private BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Space Members
CREATE TABLE space_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id, user_id)
);

-- Room Members
CREATE TABLE room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  content TEXT,
  reply_to_id UUID REFERENCES messages(id),
  is_pinned BOOLEAN DEFAULT false,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Message Attachments
CREATE TABLE message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reactions
CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- Direct Messages
CREATE TABLE dm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID REFERENCES profiles(id),
  user2_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user1_id, user2_id)
);

CREATE TABLE dm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id),
  content TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blocked Users
CREATE TABLE blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID REFERENCES profiles(id),
  blocked_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);

-- Invitations
CREATE TABLE space_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_by UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Files
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id UUID REFERENCES profiles(id),
  space_id UUID REFERENCES spaces(id),
  room_id UUID REFERENCES rooms(id),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Implementation Notes

### Supabase Integration

- Use Supabase client for database operations
- Enable Row Level Security (RLS) on all tables
- Use Supabase Storage for file uploads

### Redis Integration

- Use `@nestjs/cache-manager` for caching
- Use `@nestjs/bull` or `@nestjs/bullmq` for job queues
- Use Redis Pub/Sub for WebSocket broadcasting
- See [`redis-data-structure.md`](./redis-data-structure.md) for all Redis patterns

### WebSocket Gateway

- Use `@nestjs/websockets` with Socket.io
- Implement JWT authentication for WebSocket connections
- Use Redis adapter for horizontal scaling

### Security

- JWT authentication with access/refresh tokens
- Rate limiting with `@nestjs/throttler`
- CORS configuration
- Input sanitization

---

_API specification for VinClassroom_
_Last Updated: 2026-04-07_
