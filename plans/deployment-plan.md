# Kế Hoạch Triển Khai VinClassroom API

> **Dự án:** VinClassroom API  
> **Stack:** NestJS + Supabase (PostgreSQL) + Redis + Socket.io  
> **Phiên bản:** 1.0.0  
> **Cập nhật:** 2026-04-10

---

## 📋 Tổng Quan

Dự án VinClassroom API là backend cho ứng dụng chat/classroom, sử dụng kiến trúc:
- **Hot Data**: Redis (recent messages, online users, unread counts, typing indicators)
- **Warm Data**: Redis + Supabase (user profiles, room metadata, message history)
- **Cold Data**: Supabase (old messages, edit history, deleted items, analytics)

---

## 🎯 Phases Triển Khai

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VINCLASSROOM API DEPLOYMENT                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 1: Infrastructure Setup (Tuần 1)                     ✅ COMPLETE     │
│  Phase 2: Core Implementation (Tuần 2-3)                    ✅ COMPLETE     │
│  Phase 3: Feature Implementation (Tuần 4)                   ✅ COMPLETE     │
│  Phase 4: WebSocket & Real-time (Tuần 5-6)                  ✅ COMPLETE     │
│  Phase 5: Testing & Optimization (Tuần 7)                   ⏳ PLANNED      │
│  Phase 6: Deployment & Monitoring (Tuần 8)                  ⏳ PLANNED      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Infrastructure Setup (Tuần 1)

### 1.1 Supabase Setup

| Task | Description | Priority |
|------|-------------|----------|
| Tạo project | Tạo project mới trên Supabase | 🔴 Cao |
| Cấu hình Auth | Bật Email/Password provider | 🔴 Cao |
| Cấu hình RLS | Row Level Security policies | 🔴 Cao |
| Storage buckets | Tạo buckets cho avatars, files, attachments | 🟡 Trung bình |

#### Database Migration SQL
```sql
-- Chạy trong Supabase SQL Editor
-- File: migrations/001_initial_schema.sql

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

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE dm_messages;
```

### 1.2 Redis Setup (External Server)

Bạn đang sử dụng **Redis server riêng** (external). Cấu hình kết nối:

**Format URL:**
```bash
# Standard
REDIS_URL=redis://:password@your-redis-server.com:6379/0

# Với TLS/SSL
REDIS_URL=rediss://:password@your-redis-server.com:6380/0
```

**Hoặc individual settings:**
```bash
REDIS_HOST=your-redis-server.com
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0
REDIS_TLS=false
```

### 1.3 Environment Configuration

Tạo file `.env`:
```bash
# Database (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Redis
REDIS_URL=rediss://default:password@host:6379

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-key-min-32-chars
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Server
PORT=3000
NODE_ENV=production

# CORS
CORS_ORIGIN=https://your-frontend-domain.com

# Rate Limiting
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_MESSAGE_MAX=30
RATE_LIMIT_API_MAX=100
```

---

## Phase 2: Core Implementation (Tuần 2-3)

### 2.1 Cài Đặt Dependencies

```bash
# Core NestJS
npm install @nestjs/config @nestjs/throttler @nestjs/websockets @nestjs/platform-socket.io

# Database & Cache
npm install @supabase/supabase-js ioredis

# Authentication
npm install @nestjs/passport @nestjs/jwt passport passport-jwt bcrypt

# Validation & Serialization
npm install class-validator class-transformer

# Utilities
npm install nanoid date-fns

# Dev dependencies
npm install -D @types/bcrypt @types/passport-jwt
```

### 2.2 Project Structure Implementation

```
src/
├── config/
│   ├── database.config.ts
│   ├── redis.config.ts
│   ├── jwt.config.ts
│   └── app.config.ts
├── common/
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── public.decorator.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── ws-jwt.guard.ts
│   ├── interceptors/
│   │   └── transform.interceptor.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   └── pipes/
│       └── validation.pipe.ts
├── database/
│   ├── supabase.service.ts
│   ├── supabase.module.ts
│   └── types/
├── redis/
│   ├── redis.service.ts
│   ├── redis.module.ts
│   └── keys.ts
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── strategies/
│   │   └── dto/
│   ├── users/
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── users.module.ts
│   ├── spaces/
│   │   ├── spaces.controller.ts
│   │   ├── spaces.service.ts
│   │   └── spaces.module.ts
│   ├── rooms/
│   │   ├── rooms.controller.ts
│   │   ├── rooms.service.ts
│   │   └── rooms.module.ts
│   ├── messages/
│   │   ├── messages.controller.ts
│   │   ├── messages.service.ts
│   │   └── messages.module.ts
│   ├── dms/
│   │   ├── dms.controller.ts
│   │   ├── dms.service.ts
│   │   └── dms.module.ts
│   ├── members/
│   │   ├── members.controller.ts
│   │   ├── members.service.ts
│   │   └── members.module.ts
│   ├── notifications/
│   │   ├── notifications.controller.ts
│   │   ├── notifications.service.ts
│   │   └── notifications.module.ts
│   ├── files/
│   │   ├── files.controller.ts
│   │   ├── files.service.ts
│   │   └── files.module.ts
│   └── search/
│       ├── search.controller.ts
│       ├── search.service.ts
│       └── search.module.ts
├── gateways/
│   ├── chat.gateway.ts
│   ├── chat.gateway.module.ts
│   └── adapters/
│       └── redis.adapter.ts
├── app.module.ts
└── main.ts
```

### 2.3 Core Modules Implementation

#### Week 2: Auth, Users, Database, Redis ✅

| Module | Files | Status |
|--------|-------|--------|
| Config | `config/*` | ✅ Complete |
| Database | `database/*` | ✅ Complete |
| Redis | `redis/*` | ✅ Complete |
| Auth | `modules/auth/*` | ✅ Complete |
| Users | `modules/users/*` | ✅ Complete |

#### Week 3: Spaces, Rooms, Members ✅

| Module | Files | Status |
|--------|-------|--------|
| Spaces | `modules/spaces/*` | ✅ Complete |
| Rooms | `modules/rooms/*` | ✅ Complete |
| Members | `modules/members/*` | ✅ Complete |

#### Week 4: Phase 3 Complete ✅

| Module | Files | Status |
|--------|-------|--------|
| Messages | `modules/messages/*` | ✅ Complete |
| DMs | `modules/dms/*` | ✅ Complete |
| Notifications | `modules/notifications/*` | ✅ Complete |
| Files | `modules/files/*` | ✅ Complete |
| Search | `modules/search/*` | ✅ Complete |

> **Phase 3: 100% Complete!** 🎉

---

## Phase 3: Feature Implementation (Tuần 4-5)

### 3.1 Messages & DMs ✅

| Feature | API Endpoints | Redis Keys | Status |
|---------|---------------|------------|--------|
| Send message | `POST /rooms/:roomId/messages` | `msg:{id}`, `room:messages:{id}` | ✅ |
| Get messages | `GET /rooms/:roomId/messages` | `room:messages:{id}` | ✅ |
| Edit message | `PATCH /messages/:messageId` | `msg:edithistory:{id}` | ✅ |
| Delete message | `DELETE /messages/:messageId` | Soft delete flag | ✅ |
| Reactions | `POST/DELETE /messages/:id/reactions` | `react:msg:{id}` | ✅ |
| Thread replies | `GET /messages/:id/thread` | `msg:replies:{id}` | ✅ |
| Pin message | `POST/DELETE /messages/:id/pin` | `room:pinned:{id}` | ✅ |
| DM conversations | `GET/POST /dms/*` | `dm:{id}`, `dm:messages:{id}` | ✅ |

> **Note:** See [Phase 3 Summary](./phase3-summary.md) for detailed implementation status.

### 3.2 Notifications ✅

| Feature | API Endpoints | Redis Keys | Status |
|---------|---------------|------------|--------|
| List notifications | `GET /notifications` | `user:notifications:{id}` | ✅ |
| Unread count | `GET /notifications/unread-count` | `user:notifications:unread:{id}` | ✅ |
| Mark as read | `POST /notifications/read` | - | ✅ |
| Delete notification | `DELETE /notifications/:id` | - | ✅ |

> **Completed:** Week 4 (2026-04-10)

### 3.3 Files ✅

| Feature | API Endpoints | Redis Keys | Status |
|---------|---------------|------------|--------|
| Upload file | `POST /files` | `user:files:recent:{id}` | ✅ |
| Get files | `GET /files` | `file:{id}` | ✅ |
| Get recent files | `GET /files/recent` | `user:files:recent:{id}` | ✅ |
| Get file stats | `GET /files/stats` | - | ✅ |
| Delete file | `DELETE /files/:id` | - | ✅ |
| Get space files | `GET /spaces/:spaceId/files` | `space:files:shared:{id}` | ✅ |

> **Completed:** Week 4 (2026-04-10)

### 3.4 Search ✅

| Feature | API Endpoints | Redis Keys | Status |
|---------|---------------|------------|--------|
| Global search | `GET /search` | `search:{hash}` | ✅ |
| Search messages | `GET /search/messages` | `search:{hash}` | ✅ |
| Search users | `GET /search/users` | `search:{hash}` | ✅ |
| Search spaces | `GET /search/spaces` | `search:{hash}` | ✅ |
| Search files | `GET /search/files` | `search:{hash}` | ✅ |
| Popular searches | `GET /search/popular` | `search:popular:{type}` | ✅ |

> **Completed:** Week 4 (2026-04-10)

**Database Migration:**
```sql
-- Run: migrations/002_search_indexes.sql
```

---

## Phase 4: WebSocket & Real-time (Tuần 5-6) ✅

> **Status:** Complete  
> **Progress:** 100%  
> **Document:** [Phase 4 Summary](./phase4-summary.md)

### 4.1 Overview

Triển khai WebSocket Gateway với Socket.io để hỗ trợ real-time features:
- Real-time messaging
- Typing indicators
- Online/offline presence
- Push notifications
- Multi-server scaling với Redis

### 4.2 Architecture

```
┌─────────────┐     WebSocket      ┌─────────────────┐
│   Client    │ ◄────────────────► │  Chat Gateway   │
│  (Browser)  │                    │   (Socket.io)   │
└─────────────┘                    └────────┬────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              │             │             │
                        ┌─────▼─────┐ ┌────▼────┐ ┌─────▼──────┐
                        │  Redis    │ │  Redis  │ │   Redis    │
                        │  Pub/Sub  │ │ Presence│ │  Rooms     │
                        └───────────┘ └─────────┘ └────────────┘
```

### 4.3 Key Components

| Component | File | Status |
|-----------|------|--------|
| Chat Gateway | `gateways/chat.gateway.ts` | ✅ |
| Redis Adapter | `gateways/adapters/redis.adapter.ts` | ✅ |
| WS JWT Guard | `gateways/guards/ws-jwt.guard.ts` | ✅ |
| WS Rate Limit Guard | `gateways/guards/ws-rate-limit.guard.ts` | ✅ |
| Connection Manager | `gateways/chat.gateway.ts` | ✅ |

### 4.4 Event Mapping

| Redis Channel | Socket Event | Direction |
|---------------|--------------|-----------|
| `channel:room:{id}` | `newMessage`, `messageDeleted`, `messageUpdated` | Server → Client |
| `channel:dm:{id}` | `newDM`, `dmRead` | Server → Client |
| `channel:user:{id}` | `notification`, `mention` | Server → Client |

### 4.5 Task Breakdown

| Task | Priority | Est. Time | Status |
|------|----------|-----------|--------|
| Core WebSocket Infrastructure | 🔴 Critical | 2.5h | ✅ |
| Real-time Messaging | 🔴 Critical | 3.5h | ✅ |
| Notifications & Presence | 🟡 High | 3h | ✅ |
| DMs Real-time | 🔴 Critical | 1.5h | ✅ |
| Redis Pub/Sub Scaling | 🟡 High | 3h | ✅ |
| Advanced Features | 🟢 Medium | 4h | ✅ |

---

## Phase 5: Testing & Optimization (Tuần 7)

### 5.1 Testing Strategy

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

| Test Type | Coverage Target |
|-----------|-----------------|
| Controllers | 80% |
| Services | 70% |
| Gateways | 60% |
| DTOs | 100% validation |

### 5.2 Performance Optimization

| Area | Optimization | Expected Impact |
|------|--------------|-----------------|
| Redis | Pipeline commands | -50% latency |
| Database | Connection pooling | Better concurrency |
| API | Response caching | -70% DB queries |
| WebSocket | Binary protocol | -30% bandwidth |

### 5.3 Security Checklist

- [ ] JWT secret rotation
- [ ] Rate limiting (login: 5/1h, messages: 30/1m)
- [ ] CORS configuration
- [ ] Input sanitization (XSS prevention)
- [ ] File upload validation (type, size)
- [ ] SQL injection prevention (parameterized queries)
- [ ] Redis command injection prevention

---

## Phase 6: Deployment & Monitoring (Tuần 8)

### 6.1 Deployment Options

#### Option A: VPS/Cloud Server (Recommended for control)

| Provider | Spec | Cost/Month |
|----------|------|------------|
| DigitalOcean | 2 vCPU, 4GB RAM | $24 |
| AWS EC2 | t3.medium | ~$30 |
| Vultr | 2 vCPU, 4GB RAM | $20 |

**Docker Deployment:**
```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/main"]
```

```yaml
# docker-compose.yml (API only - External Redis)
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    restart: unless-stopped
    environment:
      - REDIS_URL=${REDIS_URL}
```

#### Option B: Serverless (PaaS)

| Platform | Pros | Cons |
|----------|------|------|
| **Railway** | Easy deploy, auto-scaling | Cost at scale |
| **Render** | Free tier, simple | Cold starts |
| **Fly.io** | Edge deployment | Learning curve |
| **AWS ECS/Fargate** | Enterprise grade | Complex |

**Railway Deployment:**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login và deploy
railway login
railway init

# Thêm biến môi trường REDIS_URL (external)
railway variables set REDIS_URL=redis://:password@your-redis-server.com:6379/0

# Deploy
railway up
```

### 6.2 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Railway
        run: railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### 6.3 Monitoring & Logging

| Tool | Purpose | Cost |
|------|---------|------|
| **Sentry** | Error tracking | Free tier |
| **LogRocket** | Session replay | Free tier |
| **UptimeRobot** | Uptime monitoring | Free |
| **Prometheus + Grafana** | Metrics | Self-hosted |

```typescript
// Sentry integration
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### 6.4 Backup Strategy

| Data | Frequency | Method |
|------|-----------|--------|
| Supabase DB | Daily | Automated backups |
| Redis | Hourly | RDB snapshots |
| Files | Real-time | Supabase Storage |

---

## 📊 Timeline Tổng Hợp

```
Tuần 1:  ████████████████████ 100%  Infrastructure Setup            ✅
Tuần 2:  ████████████████████ 100%  Core Auth + Database            ✅
Tuần 3:  ████████████████████ 100%  Spaces + Rooms                  ✅
Tuần 4:  ████████████████████ 100%  Phase 3 Complete!               ✅
Tuần 5:  ████████████████████ 100%  WebSocket Infrastructure        ✅
Tuần 6:  ████████████████████ 100%  Real-time + Scaling             ✅
Tuần 7:  ░░░░░░░░░░░░░░░░░░░░   0%  Testing + Optimization          ⏳
Tuần 8:  ░░░░░░░░░░░░░░░░░░░░   0%  Deployment + Monitoring         ⏳
```

**Phase 3 Detail:**
```
3.1 Messages & DMs:        ████████████████████ 100% ✅
3.2 Notifications:         ████████████████████ 100% ✅
3.3 Files:                 ████████████████████ 100% ✅
3.4 Search:                ████████████████████ 100% ✅
```

---

## 💰 Cost Estimation

### Development Phase

| Service | Tier | Cost/Month |
|---------|------|------------|
| Supabase | Free | $0 |
| Redis (External) | Self-hosted/Existing | $0 |
| Hosting | Local/Dev | $0 |
| **Total** | | **$0** |

### Production Phase (Small Scale)

| Service | Tier | Cost/Month |
|---------|------|------------|
| Supabase | Pro | $25 |
| Redis (External) | Self-hosted | $0 |
| VPS/Railway | 2GB RAM | $20-25 |
| Sentry | Developer | $0 |
| **Total** | | **~$45-50** |

### Production Phase (Medium Scale)

| Service | Tier | Cost/Month |
|---------|------|------------|
| Supabase | Pro | $25 |
| Redis (External) | Self-hosted | $0 |
| VPS | 4 vCPU, 8GB | $40-50 |
| CDN (CloudFlare) | Pro | $20 |
| Sentry | Team | $26 |
| **Total** | | **~$110-120** |

---

## 🚀 Quick Start Checklist

### Ngày 1: Setup
- [ ] Tạo Supabase project
- [ ] Chạy migration SQL
- [ ] Cấu hình Redis URL (external server)
- [ ] Setup `.env` file

### Ngày 2-3: Core
- [ ] Install dependencies
- [ ] Setup Database module (Supabase)
- [ ] Implement Auth module

### Ngày 4-5: Features (Phase 3)
- [x] Spaces API
- [x] Rooms API
- [x] Messages API
- [x] DMs API
- [x] Notifications API
- [x] Files API
- [x] Search API

### Ngày 6-7: Real-time (Phase 4) ✅
- [x] WebSocket Gateway & Socket.io
- [x] JWT Authentication cho WS
- [x] Real-time messaging events
- [x] Typing indicators
- [x] Online/Offline status
- [x] Push notifications (WebSocket)
- [x] Redis Pub/Sub scaling
- [x] Rate limiting cho WebSocket
- [x] Message delivery status
- [x] File upload progress

> **See:** [Phase 4 Summary](./phase4-summary.md)

### Ngày 8: Deploy
- [ ] Docker build
- [ ] Deploy to Railway/VPS
- [ ] Setup monitoring

---

## 📚 Tài Liệu Tham Khảo

1. [API Service Specification](./api-service-specification.md)
2. [Redis Data Structure](./redis-data-structure.md)
3. [NestJS Documentation](https://docs.nestjs.com/)
4. [Supabase Documentation](https://supabase.com/docs)
5. [Redis Commands](https://redis.io/commands/)

---

*Kế hoạch triển khai VinClassroom API v1.0*  
*Ngày tạo: 2026-04-09*
