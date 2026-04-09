# Redis Data Structure Design for VinClassroom

> **Purpose:** This document defines the Redis data structures for the VinClassroom chat application. It serves as the single source of truth for Redis data access patterns, optimized for AI agents to quickly retrieve and manipulate data.

---

## Architecture Overview

### Key Naming Convention

```
{prefix}:{entity}:{id}:{field}
```

**Prefixes:**
| Prefix | Entity | Description |
|--------|--------|-------------|
| `space:` | Spaces | Space containers |
| `room:` | Rooms | Rooms within spaces |
| `msg:` | Messages | Individual messages |
| `dm:` | Direct Messages | DM conversations |
| `user:` | Users | User-specific data |
| `react:` | Reactions | Message reactions |
| `mention:` | Mentions | @mention indexes |
| `channel:` | Pub/Sub | Real-time channels |

### Data Hierarchy

```
User
├── Spaces (user:spaces:{userId})
│   └── Space (space:{spaceId})
│       ├── Rooms (space:rooms:{spaceId})
│       │   └── Room (room:{roomId})
│       │       ├── Members (room:members:{roomId})
│       │       ├── Messages (room:messages:{roomId})
│       │       │   └── Message (msg:{messageId})
│       │       ├── Pinned (room:pinned:{roomId})
│       │       └── Typing (room:typing:{roomId})
│       ├── Members (space:members:{spaceId})
│       └── Invitations (space:invites:{spaceId})
├── Direct Messages (user:dms:{userId})
│   └── DM (dm:{dmId})
│       ├── Messages (dm:messages:{dmId})
│       └── Typing (dm:typing:{userId1}:{userId2})
├── Notifications (user:notifications:{userId}:recent)
├── Mentions (user:mentions:{userId})
└── Unread Counts (user:unreadtotal:{userId})
```

---

## 1. Message Storage

### Message Hash

Each message is stored as a Redis Hash. **Note:** Edit history is stored separately (see Section 7).

```
msg:{messageId}
  ├── id: "1712345678001"
  ├── roomId: "toan-cao-cap"
  ├── spaceId: "khoa-toan"          # null for DM messages
  ├── roomType: "space" | "dm"
  ├── senderId: "user123"
  ├── senderName: "Minh"            # Denormalized for read performance
  ├── content: "Hello @Linh!"       # Raw text with @mentions
  ├── mentions: '[{"userId":"user456","username":"Linh","position":6}]'
  ├── timestamp: 1712345678001      # Unix milliseconds
  ├── edited: "false" | "true"      # Flag only, history in msg:edithistory:{id}
  ├── replyTo: "1712345678000"      # Parent messageId for threads
  ├── threadReplyCount: "5"         # Quick count without ZCARD
  ├── pinned: "false" | "true"
  ├── deleted: "false" | "true"     # Soft delete
  └── attachment: '{"url":"...","name":"file.pdf","size":1234,"type":"application/pdf"}'
```

### Message Lists (Sorted Sets)

**Space/Room messages** - ordered by timestamp:

```
room:messages:{roomId}
  └── member: msg:{messageId}, score: timestamp
```

**DM messages** - ordered by timestamp:

```
dm:messages:{dmId}
  └── member: msg:{messageId}, score: timestamp
```

### Example Commands

```bash
# Create message
HSET msg:1712345678001 id "1712345678001" roomId "toan-cao-cap" spaceId "khoa-toan" roomType "space" senderId "user123" senderName "Minh" content "Hello @Linh!" mentions '[{"userId":"user456","username":"Linh","position":6}]' timestamp 1712345678001 edited "false" replyTo "" pinned "false" deleted "false"

# Add to room message list
ZADD room:messages:toan-cao-cap 1712345678001 msg:1712345678001

# Get recent messages (last 50)
ZRANGE room:messages:toan-cao-cap -50 -1 WITHSCORES

# Get message details
HGETALL msg:1712345678001

# Get messages by range (pagination)
ZRANGEBYSCORE room:messages:toan-cao-cap 0 1712345678001 LIMIT 0 20
```

---

## 2. Space Storage

### Space Hash

```
space:{spaceId}
  ├── id: "khoa-toan"
  ├── name: "Khoa Toán"
  ├── description: "Khoa Toán - Trường Đại học XYZ"
  ├── avatar: "https://..."
  ├── createdAt: 1712345678000
  ├── createdBy: "user123"
  ├── roomCount: 5
  ├── memberCount: 150
  └── lastActivity: 1712345678000
```

### Space Structure

```
space:rooms:{spaceId}           -> Set of roomIds
space:members:{spaceId}         -> Set of userIds
space:roominfo:{spaceId}:{roomId} -> Hash with room metadata
user:spaces:{userId}            -> Sorted Set (spaceId, score: lastActivity)
space:invites:{spaceId}         -> Hash of pending invitations
```

### Space Room Info Hash

Quick lookup for room info within a space:

```
space:roominfo:{spaceId}:{roomId}
  ├── name: "Toán cao cấp"
  ├── description: "Phòng thảo luận Toán cao cấp"
  ├── createdAt: 1712345678000
  ├── memberCount: 45
  ├── messageCount: 1523
  └── lastMessageAt: 1712345678000
```

### Example Commands

```bash
# Get user's spaces (sorted by last activity)
ZREVRANGE user:spaces:user123 0 -1 WITHSCORES

# Get space details
HGETALL space:khoa-toan

# Get rooms in space
SMEMBERS space:rooms:khoa-toan

# Get space members
SMEMBERS space:members:khoa-toan

# Update space last activity
HSET space:khoa-toan lastActivity 1712345678001
ZADD user:spaces:user123 1712345678001 khoa-toan
```

---

## 3. Room Storage

### Room Hash

```
room:{roomId}
  ├── id: "toan-cao-cap"
  ├── name: "Toán cao cấp"
  ├── spaceId: "khoa-toan"
  ├── description: "Phòng thảo luận Toán cao cấp"
  ├── type: "text" | "voice" | "announcement"
  ├── isPrivate: "false" | "true"
  ├── createdAt: 1712345678000
  ├── createdBy: "user123"
  ├── memberCount: 45
  ├── messageCount: 1523
  └── lastActivity: 1712345678000
```

### Room Structure

```
room:members:{roomId}     -> Set of userIds
room:msgcount:{roomId}    -> String (message count)
room:pinned:{roomId}      -> Set of messageIds
room:typing:{roomId}      -> Set of userIds (TTL: 10s)
room:stats:{roomId}       -> Hash with statistics
```

### Room Stats Hash

```
room:stats:{roomId}
  ├── totalMessages: 1523
  ├── totalMembers: 45
  ├── activeToday: 12
  ├── lastMessageAt: 1712345678000
  └── peakHour: 14
```

### Example Commands

```bash
# Get room details
HGETALL room:toan-cao-cap

# Get room members
SMEMBERS room:members:toan-cao-cap

# Get pinned messages
SMEMBERS room:pinned:toan-cao-cap

# Get typing users (auto-expires in 10s)
SMEMBERS room:typing:toan-cao-cap

# Add typing user (with TTL)
SADD room:typing:toan-cao-cap user123
EXPIRE room:typing:toan-cao-cap 10

# Increment message count
INCR room:msgcount:toan-cao-cap
```

---

## 4. Direct Message Storage

### DM ID Generation

```
dm:{userId1}:{userId2}  # UserIds sorted alphabetically
Example: dm:minh:you
```

### DM Metadata Hash

```
dm:{dmId}
  ├── id: "dm:minh:you"
  ├── user1Id: "minh"
  ├── user2Id: "you"
  ├── lastMessageId: "msg:1712345678001"
  ├── lastMessageAt: 1712345678001
  ├── user1Unread: 3
  └── user2Unread: 0
```

### DM Structure

```
user:dms:{userId}             -> Sorted Set (dmId, score: lastMessageAt)
dm:messages:{dmId}            -> Sorted Set (msg:{messageId}, score: timestamp)
dm:typing:{userId1}:{userId2} -> Set of userIds typing (TTL: 10s)
```

### Example Commands

```bash
# Get user's DMs (sorted by last message)
ZREVRANGE user:dms:user123 0 -1 WITHSCORES

# Get DM metadata
HGETALL dm:minh:you

# Get DM messages (last 50)
ZRANGE dm:messages:minh:you -50 -1 WITHSCORES

# Update unread count
HINCRBY dm:minh:you user2Unread 1

# Mark as read
HSET dm:minh:you user2Unread 0
```

---

## 5. Reactions Storage

### Message Reactions Hash

```
react:msg:{messageId}
  ├── 👍: '{"count":2,"users":["user1","user2"]}'
  ├── ❤️: '{"count":1,"users":["user3"]}'
  └── 😂: '{"count":1,"users":["user1"]}'
```

### User's Reactions Set

```
user:reactions:{userId}
  └── member: "{messageId}:{emoji}"
```

### Example Commands

```bash
# Add reaction
HGET react:msg:12345 👍
# Parse JSON, add user, update
HSET react:msg:12345 👍 '{"count":3,"users":["user1","user2","user4"]}'
SADD user:reactions:user4 "12345:👍"

# Remove reaction
# Parse JSON, remove user, update or delete key
HDEL react:msg:12345 👍
SREM user:reactions:user1 "12345:👍"

# Get all reactions for a message
HGETALL react:msg:12345

# Check if user reacted with emoji
SISMEMBER user:reactions:user1 "12345:👍"
```

---

## 6. @Mentions Storage

### Message Mentions Set

```
mention:msg:{messageId}
  └── member: mentionedUserId
```

### User's Mentions Sorted Set

```
user:mentions:{userId}
  └── member: msg:{messageId}, score: timestamp
```

### User's Unread Mention Count

```
user:mentioncount:{userId} = 3
```

### Example Commands

```bash
# Add mentions for a message
SADD mention:msg:12345 user456 user789
ZADD user:mentions:user456 1712345678001 msg:12345
ZADD user:mentions:user789 1712345678001 msg:12345
INCR user:mentioncount:user456

# Get user's unread mentions
ZRANGE user:mentions:user456 0 -1 WITHSCORES
GET user:mentioncount:user456

# Mark mentions as read
DEL user:mentions:user456
SET user:mentioncount:user456 0
```

---

## 7. Edit History Storage

### Edit History List

**Note:** Edit history is stored separately from the Message Hash to keep the Hash small and allow independent TTL.

```
msg:edithistory:{messageId}
  └── LPUSH: '{"content":"Original text","editedAt":1712345600000,"editedBy":"user1"}'
```

**TTL:** 30 days (2592000 seconds)

### Example Commands

```bash
# Store edit history (when message is edited)
LPUSH msg:edithistory:12345 '{"content":"Original text","editedAt":1712345600000,"editedBy":"user1"}'
EXPIRE msg:edithistory:12345 2592000

# Get edit history
LRANGE msg:edithistory:12345 0 -1

# Update message edited flag
HSET msg:12345 edited "true"
```

---

## 8. Reply/Thread Storage

### Thread Replies Sorted Set

```
msg:replies:{parentMessageId}
  └── member: msg:{replyMessageId}, score: timestamp
```

### Thread Reply Count

```
msg:replycount:{messageId} = 5
```

### Example Commands

```bash
# Add reply
ZADD msg:replies:12345 1712345678001 msg:12346
INCR msg:replycount:12345
HSET msg:12345 threadReplyCount 5

# Get thread replies
ZRANGE msg:replies:12345 0 -1 WITHSCORES

# Get reply count
GET msg:replycount:12345
```

---

## 9. Unread Count Storage

### Per-Room Unread Count

```
user:unread:{userId}:{roomId} = 5
```

### Total Unread Count

```
user:unreadtotal:{userId} = 23
```

### Example Commands

```bash
# Increment unread for a room
INCR user:unread:user123:toan-cao-cap
INCR user:unreadtotal:user123

# Decrement unread (mark as read)
SET user:unread:user123:toan-cao-cap 0
# Recalculate total
# Sum all user:unread:user123:* or maintain counter
```

---

## 10. User Online Status

### User Status Hash

```
user:status:{userId}
  ├── online: "true" | "false"
  ├── lastSeen: 1712345678000
  └── socketId: "socket123"
```

### Online Users Set

```
users:online
  └── member: userId
```

### Example Commands

```bash
# Set user online
HSET user:status:user123 online "true" lastSeen 1712345678000 socketId "socket123"
SADD users:online user123

# Set user offline
HSET user:status:user123 online "false" lastSeen 1712345678000
SREM users:online user123

# Check if user is online
SISMEMBER users:online user123
HGET user:status:user123 online

# Get all online users
SMEMBERS users:online
```

---

## 11. Notification Storage

### User's Recent Notifications List

```
user:notifications:{userId}:recent
  └── LPUSH: '{"id":"notif1","type":"mention","title":"You were mentioned","message":"@Minh in Toán cao cấp","data":{"messageId":"12345","roomId":"toan-cao-cap"},"isRead":false,"createdAt":1712345678000}'
```

**Max size:** 50 items (LTRIM)
**TTL:** 7 days (604800 seconds)

### Unread Notification Count

```
user:notifications:unread:{userId} = 3
```

### Example Commands

```bash
# Add notification
LPUSH user:notifications:user123:recent '{"id":"notif1",...}'
LTRIM user:notifications:user123:recent 0 49
EXPIRE user:notifications:user123:recent 604800
INCR user:notifications:unread:user123

# Get notifications
LRANGE user:notifications:user123:recent 0 -1

# Mark as read
SET user:notifications:unread:user123 0
```

---

## 12. File Storage

### Recent Files List

```
user:files:recent:{userId}
  └── LPUSH: '{"id":"file1","name":"document.pdf","url":"...","size":1234,"type":"application/pdf","uploadedAt":1712345678000,"roomId":"toan-cao-cap","spaceId":"khoa-toan"}'
```

**Max size:** 20 items (LTRIM)
**TTL:** 1 hour (3600 seconds)

### Shared Files Cache

```
space:files:shared:{spaceId}
  └── JSON array of file objects
```

### Example Commands

```bash
# Add recent file
LPUSH user:files:recent:user123 '{"id":"file1",...}'
LTRIM user:files:recent:user123 0 19
EXPIRE user:files:recent:user123 3600
```

---

## 13. Search Cache

### Search Result Cache

```
search:{queryHash} = JSON result
```

**TTL:** 60 seconds

### Popular Searches Sorted Set

```
search:popular:{type}
  └── member: query, score: count
```

### Example Commands

```bash
# Cache search result
SET search:abc123 '{"results":[...]}'
EXPIRE search:abc123 60

# Track popular search
ZINCRBY search:popular:messages 1 "tích phân"
```

---

## 14. Rate Limiting

### Login Rate Limit

```
rate:login:{ip} = count
```

**TTL:** 1 hour (3600 seconds)

### Message Rate Limit

```
rate:message:{userId} = count
```

**TTL:** 60 seconds

### API Rate Limit

```
rate:api:{userId}:{endpoint} = count
```

**TTL:** 60 seconds

---

## 15. Session Storage

### User Session Hash

```
session:{userId}
  ├── token: "jwt..."
  ├── refreshToken: "refresh..."
  ├── createdAt: 1712345678000
  ├── lastActive: 1712345678000
  └── device: "Chrome on Windows"
```

### Refresh Token

```
refreshToken:{userId} = "refresh_token_string"
```

**TTL:** 7 days

---

## Complete Redis Key Reference Table

| Category          | Key Pattern                          | Type       | TTL | Description                         |
| ----------------- | ------------------------------------ | ---------- | --- | ----------------------------------- |
| **Sessions**      | `session:{userId}`                   | Hash       | -   | User session data                   |
|                   | `refreshToken:{userId}`              | String     | 7d  | Refresh tokens                      |
| **Rate Limiting** | `rate:login:{ip}`                    | String     | 1h  | Login attempts                      |
|                   | `rate:message:{userId}`              | String     | 1m  | Message rate                        |
|                   | `rate:api:{userId}:{endpoint}`       | String     | 1m  | API rate limit                      |
| **Users**         | `user:profile:{userId}`              | JSON       | 1h  | User profile cache                  |
|                   | `user:status:{userId}`               | Hash       | -   | Online status                       |
|                   | `users:online`                       | Set        | -   | All online users                    |
|                   | `user:friends:{userId}`              | Set        | 1h  | Friend list                         |
|                   | `user:reactions:{userId}`            | Set        | -   | User's reactions                    |
|                   | `user:spaces:{userId}`               | Sorted Set | 5m  | User's spaces (score: lastActivity) |
|                   | `user:dms:{userId}`                  | Sorted Set | 5m  | User's DMs (score: lastMessageAt)   |
| **Spaces**        | `space:{spaceId}`                    | Hash       | 1h  | Space details                       |
|                   | `space:rooms:{spaceId}`              | Set        | -   | Rooms in space                      |
|                   | `space:members:{spaceId}`            | Set        | 5m  | Space members                       |
|                   | `space:roominfo:{spaceId}:{roomId}`  | Hash       | 1h  | Room metadata in space              |
|                   | `space:stats:{spaceId}`              | Hash       | 5m  | Space statistics                    |
|                   | `space:invites:{spaceId}`            | Hash       | 24h | Pending invitations                 |
| **Rooms**         | `room:{roomId}`                      | Hash       | 1h  | Room details                        |
|                   | `room:members:{roomId}`              | Set        | 5m  | Room members                        |
|                   | `room:messages:{roomId}`             | Sorted Set | -   | Messages (score: timestamp)         |
|                   | `room:msgcount:{roomId}`             | String     | -   | Message count                       |
|                   | `room:pinned:{roomId}`               | Set        | -   | Pinned messages                     |
|                   | `room:stats:{roomId}`                | Hash       | 5m  | Room statistics                     |
|                   | `room:typing:{roomId}`               | Set        | 10s | Typing users                        |
| **Messages**      | `msg:{messageId}`                    | Hash       | -   | Message data                        |
|                   | `msg:edithistory:{messageId}`        | List       | 30d | Edit history                        |
|                   | `msg:replies:{parentId}`             | Sorted Set | -   | Thread replies                      |
|                   | `msg:replycount:{messageId}`         | String     | -   | Reply count                         |
| **Reactions**     | `react:msg:{messageId}`              | Hash       | -   | Message reactions                   |
| **Mentions**      | `mention:msg:{messageId}`            | Set        | -   | Mentioned users in message          |
|                   | `user:mentions:{userId}`             | Sorted Set | 7d  | User's mentions                     |
|                   | `user:mentioncount:{userId}`         | String     | -   | Unread mention count                |
| **DMs**           | `dm:{dmId}`                          | Hash       | -   | DM metadata                         |
|                   | `dm:messages:{dmId}`                 | Sorted Set | -   | DM messages                         |
|                   | `dm:typing:{userId1}:{userId2}`      | Set        | 10s | DM typing                           |
| **Unread**        | `user:unread:{userId}:{roomId}`      | String     | -   | Unread per room                     |
|                   | `user:unreadtotal:{userId}`          | String     | -   | Total unread                        |
| **Notifications** | `user:notifications:unread:{userId}` | String     | -   | Unread count                        |
|                   | `user:notifications:{userId}:recent` | List (50)  | 7d  | Recent notifications                |
| **Files**         | `user:files:recent:{userId}`         | List (20)  | 1h  | Recent files                        |
|                   | `space:files:shared:{spaceId}`       | JSON       | 5m  | Shared files                        |
| **Search**        | `search:{queryHash}`                 | JSON       | 1m  | Search cache                        |
|                   | `search:popular:{type}`              | Sorted Set | 1h  | Popular searches                    |
| **Activity**      | `member:activity:{spaceId}:{userId}` | Hash       | 1h  | Member activity                     |

---

## Redis Pub/Sub Channels

```
# Room message events
channel:room:{roomId}
  ├── message:new
  ├── message:edit
  ├── message:delete
  ├── reaction:add
  ├── reaction:remove
  ├── typing:start
  ├── typing:stop

# DM events
channel:dm:{dmId}
  ├── message:new
  ├── message:edit
  ├── typing:start
  ├── typing:stop

# User events
channel:user:{userId}
  ├── mention:new
  ├── dm:new
  ├── status:change
  ├── notification:new
```

---

## Caching Strategy

### Hot Data (Redis only)

- Recent messages (last 100 per room)
- Online users
- Unread counts
- Recent reactions
- Typing indicators

### Warm Data (Redis + Supabase)

- Message history (older messages)
- User profiles
- Room metadata
- Space details

### Cold Data (Supabase only)

- Very old messages (archive)
- Edit history (>30 days)
- Deleted messages
- Historical analytics

---

## Memory Optimization

### Redis Modules

- **RedisJSON:** For nested data (reactions, attachments, file metadata)
- **RedisSearch:** For message search
- **RedisTimeSeries:** For analytics

### Expiration Policies

```
EXPIRE msg:edithistory:{messageId} 2592000  # 30 days
EXPIRE user:mentions:{userId} 604800        # 7 days
EXPIRE user:notifications:{userId}:recent 604800  # 7 days
EXPIRE room:typing:{roomId} 10              # 10 seconds
EXPIRE dm:typing:{userId1}:{userId2} 10     # 10 seconds
EXPIRE search:{queryHash} 60                # 60 seconds
EXPIRE user:files:recent:{userId} 3600      # 1 hour
```

### List Trimming

```
LTRIM user:notifications:{userId}:recent 0 49   # Max 50 items
LTRIM user:files:recent:{userId} 0 19           # Max 20 items
```

---

## Data Flow Examples

### Creating a Space with Rooms

```bash
# 1. Create Space
HSET space:khoa-toan id "khoa-toan" name "Khoa Toán" description "..." avatar "..." createdAt 1712345678000 createdBy "user123" roomCount 0 memberCount 1 lastActivity 1712345678000
ZADD user:spaces:user123 1712345678000 khoa-toan

# 2. Add Rooms
SADD space:rooms:khoa-toan general toan-cao-cap
HSET room:general id "general" name "General" spaceId "khoa-toan" ...
HSET room:toan-cao-cap id "toan-cao-cap" name "Toán cao cấp" spaceId "khoa-toan" ...
HSET space:roominfo:khoa-toan:general name "General" ...
HSET space:roominfo:khoa-toan:toan-cao-cap name "Toán cao cấp" ...

# 3. Add Members
SADD space:members:khoa-toan user123 user456
SADD room:members:general user123 user456
SADD room:members:toan-cao-cap user123 user456
```

### Sending a Message in a Room

```bash
# 1. Create message
HSET msg:1712345678001 id "1712345678001" roomId "toan-cao-cap" spaceId "khoa-toan" roomType "space" senderId "user123" senderName "Minh" content "Hello @Linh!" mentions '[{"userId":"user456","username":"Linh","position":6}]' timestamp 1712345678001 edited "false" replyTo "" pinned "false" deleted "false"

# 2. Add to room message list
ZADD room:messages:toan-cao-cap 1712345678001 msg:1712345678001

# 3. If has mentions
SADD mention:msg:1712345678001 user456
ZADD user:mentions:user456 1712345678001 msg:1712345678001
INCR user:mentioncount:user456

# 4. If reply
ZADD msg:replies:1712345678000 1712345678001 msg:1712345678001
INCR msg:replycount:1712345678000
HSET msg:1712345678000 threadReplyCount 1

# 5. Update room/space last activity
HSET room:toan-cao-cap lastActivity 1712345678001
HSET space:khoa-toan lastActivity 1712345678001
ZADD user:spaces:user123 1712345678001 khoa-toan

# 6. Increment unread counts for other members
INCR user:unread:user456:toan-cao-cap
INCR user:unreadtotal:user456

# 7. Publish to Redis Pub/Sub
PUBLISH channel:room:toan-cao-cap message:new
```

### Adding a Reaction

```bash
# 1. Get current reactions
HGET react:msg:12345 👍

# 2. Update count and users array
HSET react:msg:12345 👍 '{"count":3,"users":["user1","user2","user4"]}'

# 3. Add to user's reactions
SADD user:reactions:user4 "12345:👍"

# 4. Publish update
PUBLISH channel:room:toan-cao-cap reaction:add
```

### Editing a Message

```bash
# 1. Get current content
HGET msg:12345 content

# 2. Store in edit history
LPUSH msg:edithistory:12345 '{"content":"Original text","editedAt":1712345600000,"editedBy":"user1"}'
EXPIRE msg:edithistory:12345 2592000

# 3. Update content
HSET msg:12345 content "Edited text" edited "true"

# 4. Publish update
PUBLISH channel:room:toan-cao-cap message:edit
```

---

## AI Agent Data Access Patterns

### Quick Message Retrieval

```bash
# Get single message
HGETALL msg:{messageId}

# Get multiple messages (pipeline)
HGETALL msg:1
HGETALL msg:2
HGETALL msg:3

# Get messages in a room (last 50)
ZRANGE room:messages:{roomId} -50 -1 WITHSCORES
# Then pipeline HGETALL for each messageId
```

### User's Complete Chat View

```bash
# Get user's spaces
ZREVRANGE user:spaces:{userId} 0 -1 WITHSCORES

# Get user's DMs
ZREVRANGE user:dms:{userId} 0 -1 WITHSCORES

# Get unread counts
GET user:unreadtotal:{userId}

# Get online status
SISMEMBER users:online {userId}
```

### Room View

```bash
# Get room details
HGETALL room:{roomId}

# Get room members
SMEMBERS room:members:{roomId}

# Get recent messages
ZRANGE room:messages:{roomId} -50 -1 WITHSCORES

# Get pinned messages
SMEMBERS room:pinned:{roomId}

# Get typing users
SMEMBERS room:typing:{roomId}
```

### Message with Thread

```bash
# Get parent message
HGETALL msg:{parentId}

# Get replies
ZRANGE msg:replies:{parentId} 0 -1 WITHSCORES

# Get reactions
HGETALL react:msg:{parentId}
```

---

_Single source of truth for VinClassroom Redis data structures_
_Last Updated: 2026-04-07_
