# Phase 1: Infrastructure Setup Guide

Hướng dẫn chi tiết thiết lập infrastructure cho VinClassroom API với **External Redis Server**.

---

## 📋 Prerequisites

- Node.js 20+
- npm hoặc yarn
- Tài khoản Supabase (free tier)
- **Redis Server** (cổng và connection string)

---

## 🚀 Quick Start (3 phút)

### Bước 1: Cài đặt Dependencies

```bash
npm install
```

### Bước 2: Setup Environment Variables

```bash
cp .env.example .env
```

Chỉnh sửa file `.env`:

```bash
# Redis External Server (quan trọng!)
REDIS_URL=redis://:your-password@your-redis-server.com:6379/0
# Hoặc nếu có TLS: REDIS_URL=rediss://:password@host:6380/0
```

### Bước 3: Chạy Application

```bash
npm run start:dev
```

Truy cập: http://localhost:3000/health

---

## 🔧 Detailed Setup

### 1. Supabase Setup (Giống cũ)

#### 1.1 Tạo Project

1. Truy cập [https://supabase.com](https://supabase.com)
2. Sign up/Login
3. Click "New Project"
4. Điền thông tin và create

#### 1.2 Lấy API Keys

Project Dashboard > Project Settings > API:
- **Project URL** → `SUPABASE_URL`
- **anon public** → `SUPABASE_ANON_KEY`
- **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY`

#### 1.3 Chạy Migration

SQL Editor > New query > Copy từ `migrations/001_initial_schema.sql` > Run

---

### 2. External Redis Setup ⭐

Bạn đã có Redis server riêng. Cấu hình như sau:

#### Option A: Redis URL (Khuyến nghị)

Format URL:
```
redis://[username]:password@host:port/database
```

Ví dụ:
```bash
# Redis không có password
REDIS_URL=redis://your-redis-server.com:6379

# Redis có password
REDIS_URL=redis://:your-password@your-redis-server.com:6379/0

# Redis với username (Redis 6+)
REDIS_URL=redis://default:your-password@your-redis-server.com:6379

# Redis với TLS/SSL
REDIS_URL=rediss://:your-password@your-redis-server.com:6380/0
```

#### Option B: Individual Settings

Nếu không muốn dùng URL:
```bash
REDIS_HOST=your-redis-server.com
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0
REDIS_USERNAME=default  # optional
```

#### TLS/SSL Configuration

Nếu Redis server yêu cầu TLS:
```bash
REDIS_TLS=true
REDIS_TLS_REJECT_UNAUTHORIZED=true
# Set false nếu dùng self-signed certificates
```

#### Connection Settings (Tuning)

```bash
# Số lần retry khi connection fail
REDIS_MAX_RETRIES=3

# Timeout kết nối (milliseconds)
REDIS_CONNECT_TIMEOUT=10000
```

---

### 3. Environment Configuration

File `.env` đầy đủ:

```bash
# ======================================
# Application
# ======================================
NODE_ENV=development
PORT=3000
API_PREFIX=api
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# ======================================
# Supabase
# ======================================
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

# ======================================
# Redis - External Server
# ======================================
# URL format (recommended)
REDIS_URL=redis://:your-password@your-redis-server.com:6379/0

# TLS nếu cần
REDIS_TLS=false

# Connection tuning
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=10000

# ======================================
# JWT
# ======================================
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-key-min-32-chars
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# ======================================
# Rate Limiting
# ======================================
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_MESSAGE_MAX=30
RATE_LIMIT_API_MAX=100
```

---

## ✅ Verification

### 1. Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": true,
  "redis": {
    "connected": true,
    "status": "ready"
  },
  "timestamp": "2026-04-09T12:00:00.000Z"
}
```

### 2. Redis Connection Logs

Khi khởi động, bạn sẽ thấy:
```
[Nest] 12345  - 04/09/2026, 12:00:00 PM     LOG [RedisService] Connecting to Redis via URL: redis://****@your-redis-server.com:6379/0
[Nest] 12345  - 04/09/2026, 12:00:00 PM     LOG [RedisService] Redis client connected
[Nest] 12345  - 04/09/2026, 12:00:00 PM     LOG [RedisService] Redis subscriber connected
```

**Lưu ý:** Password được ẩn trong logs (`****`) để bảo mật.

### 3. Test Redis Commands

```bash
# Test ping
curl http://localhost:3000/health

# Nếu muốn test trực tiếp Redis server
redis-cli -h your-redis-server.com -p 6379 -a your-password ping
```

---

## 🔧 Troubleshooting

### Redis Connection Error

```
Error: connect ECONNREFUSED your-redis-server.com:6379
```

**Solution:**
```bash
# 1. Kiểm tra kết nối đến server
ping your-redis-server.com

# 2. Kiểm tra port có mở không
telnet your-redis-server.com 6379

# 3. Kiểm tra firewall/security group
# - Đảm bảo IP của bạn được whitelist
# - Port 6379 (hoặc port custom) được mở
```

### Redis Authentication Error

```
Error: NOAUTH Authentication required
```

**Solution:**
```bash
# Kiểm tra password trong REDIS_URL
REDIS_URL=redis://:correct-password@host:6379/0
```

### TLS/SSL Error

```
Error: unable to verify the first certificate
```

**Solution:**
```bash
# Nếu dùng self-signed certificate
REDIS_TLS_REJECT_UNAUTHORIZED=false
```

### Connection Timeout

```
Error: connect ETIMEDOUT
```

**Solution:**
```bash
# Tăng timeout
REDIS_CONNECT_TIMEOUT=30000

# Hoặc kiểm tra network latency
ping your-redis-server.com
```

---

## 📁 Project Structure (Updated)

```
vinclassroom-api/
├── src/
│   ├── config/           # Configuration modules
│   │   ├── redis.config.ts    # External Redis config
│   │   └── ...
│   ├── database/         # Supabase integration
│   ├── redis/            # Redis service (external server)
│   │   ├── redis.service.ts   # Connection với retry logic
│   │   └── ...
│   └── ...
├── migrations/
├── docker-compose.yml         # API only (no Redis)
├── docker-compose.redis.yml   # Optional: local Redis for dev
├── Dockerfile
└── .env.example
```

---

## 🐳 Docker Deployment

### Production (External Redis)

```bash
# Build và chạy API (không bao gồm Redis)
docker-compose up -d api

# Hoặc build image riêng
docker build -t vinclassroom-api .
docker run -d --env-file .env -p 3000:3000 vinclassroom-api
```

### Development (Optional Local Redis)

Nếu bạn muốn test với Redis local:

```bash
# Chạy Redis local
docker-compose -f docker-compose.redis.yml up -d

# Update .env
REDIS_URL=redis://localhost:6379

# Chạy API
npm run start:dev
```

---

## 📚 Next Steps

Phase 1 đã hoàn thành với external Redis configuration!

**Phase 2 Checklist:**
- [ ] Auth Module (JWT Strategy, Guards)
- [ ] Users Module (CRUD, search)
- [ ] DTOs và Validation
- [ ] Swagger Documentation

---

## 📖 References

- [API Specification](./api-service-specification.md)
- [Redis Data Structure](./redis-data-structure.md)
- [Supabase Docs](https://supabase.com/docs)
- [Redis URL Format](https://www.iana.org/assignments/uri-schemes/prov/redis)
