# Agent Instructions - VinClassroom API

> **Dự án:** VinClassroom API  
> **Stack:** NestJS + Supabase (PostgreSQL) + Redis + Socket.io

---

## 📁 Important Files

### Plans & Tracking
| File | Purpose |
|------|---------|
| [plans/deployment-plan.md](./plans/deployment-plan.md) | Kế hoạch triển khai đầy đủ (8 tuần) |
| [plans/PROGRESS.md](./plans/PROGRESS.md) | **Tiến độ từng module** - ĐỌC TRƯỚC MỖI SESSION |
| [plans/DECISIONS.md](./plans/DECISIONS.md) | **Quyết định kiến trúc** - ĐỌC TRƯỚC KHI CODE |
| [plans/ISSUES.md](./plans/ISSUES.md) | **Bug & Limitations** - CHECK TRƯỚC KHI DEBUG |
| [plans/api-service-specification.md](./plans/api-service-specification.md) | API specification |
| [plans/redis-data-structure.md](./plans/redis-data-structure.md) | Redis keys & data structures |

### Skill
| File | Purpose |
|------|---------|
| [skills/token-efficiency/SKILL.md](./skills/token-efficiency/SKILL.md) | Guidelines tiết kiệm token |

---

## 🚀 Quick Start

```bash
# Development
npm run start:dev

# Build
npm run build

# Test
npm run test
```

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        VinClassroom API                      │
├─────────────────────────────────────────────────────────────┤
│  Hot Data: Redis (recent messages, online users, typing)     │
│  Warm Data: Redis + Supabase (profiles, room metadata)       │
│  Cold Data: Supabase (old messages, history, analytics)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Workflow

1. **Trước mỗi session:**
   - Đọc `plans/PROGRESS.md` để biết tiến độ
   - Đọc `plans/DECISIONS.md` để biết kiến trúc
   - Check `plans/ISSUES.md` để biết vấn đề hiện tại

2. **Trong session:**
   - Grep trước, đọc sau (tiết kiệm token)
   - Code theo module
   - Test thường xuyên

3. **Sau session:**
   - Update `plans/PROGRESS.md`
   - Thêm decision vào `plans/DECISIONS.md` (nếu có)
   - Ghi issue vào `plans/ISSUES.md` (nếu có)

---

## ⚠️ Important Notes

- **Redis:** External server (không trong docker-compose)
- **Supabase:** Dùng RLS policies cho security
- **Modules:** NestJS modular structure
- **Token Efficiency:** Xem skill `skills/token-efficiency/`

---

*Cập nhật: 2026-04-10*
