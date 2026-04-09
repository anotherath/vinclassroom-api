# VinClassroom API - Known Issues & Limitations

> **Mục đích:** Theo dõi bug, limit gặp phải và cách workaround.

---

## 🐛 Active Issues

### ISSUE-001: Duplicate Module Directories
**Status:** ⚠️ Open  
**Date:** 2026-04-10

**Problem:** Có 2 thư mục database và redis trùng lặp:
- `src/database/` và `src/modules/database/`
- `src/redis/` và `src/modules/redis/`

**Impact:** Confusion, potential import errors

**Solution:** Refactor để dùng 1 structure thống nhất (recommend: `src/database/`, `src/redis/`)

---

### ISSUE-002: Missing Business Modules
**Status:** ⏳ Planned  
**Date:** 2026-04-10

**Problem:** Chưa có modules:
- `src/modules/auth/`
- `src/modules/users/`
- `src/modules/spaces/`
- `src/modules/rooms/`
- `src/modules/members/`
- `src/modules/messages/`
- `src/modules/dms/`
- `src/modules/files/`
- `src/modules/notifications/`
- `src/modules/search/`

**Solution:** Triển khai theo deployment plan phases

---

### ISSUE-003: Missing WebSocket Gateway
**Status:** ⏳ Planned  
**Date:** 2026-04-10

**Problem:** Chưa có `src/gateways/chat.gateway.ts`

**Impact:** Real-time features không hoạt động

**Solution:** Phase 4 implementation

---

## 🔧 Technical Debt

### TD-001: JWT Guard Implementation
**Status:** 🔄 In Progress  
**Date:** 2026-04-10

**Current:** `src/common/guards/jwt-auth.guard.ts` cơ bản

**Needed:**
- Integration với Supabase token verification
- WebSocket JWT guard cho Socket.io
- Refresh token handling

---

### TD-002: Config Validation
**Status:** ⏳ Planned  
**Date:** 2026-04-10

**Problem:** Config không có validation schema (dùng Joi hoặc class-validator)

**Impact:** Runtime errors nếu env variables thiếu

**Solution:** Thêm `ConfigValidationSchema` trong `src/config/`

---

### TD-003: Logging Strategy
**Status:** ⏳ Planned  
**Date:** 2026-04-10

**Problem:** Chỉ dùng NestJS default Logger

**Needed:**
- Structured logging (JSON format)
- Log levels (DEBUG, INFO, WARN, ERROR)
- Request correlation ID
- Integration với external service (Sentry, LogRocket)

---

## ⚠️ Limitations

### LIM-001: Context Window Management
**Type:** Kimi Code CLI Limit  
**Date:** 2026-04-10

**Issue:** Risk hitting token limit khi làm với codebase lớn

**Workaround:**
1. Chia nhỏ session, mỗi session focus 1-2 modules
2. Đọc file cần thiết, tránh `src/**/*.ts` wildcard
3. Dùng `head_limit` khi grep
4. Luôn cập nhật PROGRESS.md để track

---

### LIM-002: Redis External Server
**Type:** Infrastructure  
**Date:** 2026-04-10

**Issue:** Redis external cần quản lý connection riêng, không có trong docker-compose

**Impact:** 
- Cần REDIS_URL environment variable
- Không chạy được locally nếu không có Redis server

**Workaround:** 
- Dev: Dùng Redis Cloud free tier hoặc local Redis
- Production: Redis Cloud hoặc self-hosted

---

### LIM-003: Supabase RLS Policies
**Type:** Security  
**Date:** 2026-04-10

**Issue:** RLS policies trong SQL migration chưa được define

**Impact:** Data security risk

**Solution:** Cần bổ sung policies trong Phase 1

---

## 📝 Session Notes

| Date | Issue | Action Taken |
|------|-------|--------------|
| 2026-04-10 | Setup tracking files | Created PROGRESS, DECISIONS, ISSUES |

---

## 🔗 Related

- [Progress Tracker](./PROGRESS.md)
- [Architecture Decisions](./DECISIONS.md)
- [Deployment Plan](./deployment-plan.md)
