# Token Efficiency Skill for VinClassroom API

> **Mục đích:** Tối ưu token usage khi làm việc với Kimi Code CLI trên dự án VinClassroom API.

---

## 📋 Quy Tắc Vàng

### 1. LUÔN KIỂM TRA CONTEXT TRƯỚC

Trước khi bắt đầu task mới, hãy đọc 3 file tracking:
- `plans/PROGRESS.md` - Biết module nào đã xong
- `plans/DECISIONS.md` - Biết kiến trúc đã quyết định
- `plans/ISSUES.md` - Biết vấn đề đang có

### 2. ĐỌC FILE CÓ CHỌN LỌC

**❌ Không làm:**
```
# Không dùng wildcard đọc toàn bộ src
ReadFile src/modules/**/*.ts
```

**✅ Nên làm:**
```
# Đọc cụ thể file cần thiết
ReadFile src/modules/auth/auth.service.ts
ReadFile src/common/guards/jwt-auth.guard.ts
```

### 3. GREP TRƯỚC, ĐỌC SAU

**Luôn dùng Grep để tìm vị trí trước:**
```bash
# Tìm trước
Grep pattern="createUser" type=ts

# Sau đó đọc file cụ thể
ReadFile src/modules/users/users.service.ts
```

### 4. HẠN CHẾ TOOL CALLS LIÊN TIẾP

**❌ Không làm:**
```
ReadFile A.ts
ReadFile B.ts
ReadFile C.ts
ReadFile D.ts
# (4 tool calls liên tiếp)
```

**✅ Nên làm:**
```
# Kết hợp trong 1 shell command
cat src/modules/auth/*.ts
```

---

## 🔧 Patterns Tiết Kiệm Token

### Pattern 1: Module Development

Khi làm 1 module mới (vd: Auth):

```
Step 1: Grep xem có gì liên quan không
  ↓
Step 2: Đọc file cần reference ( Guards, Decorators)
  ↓
Step 3: Viết code module (Controller, Service, DTO)
  ↓
Step 4: Cập nhật PROGRESS.md
```

### Pattern 2: Debugging

```
Step 1: Shell để xem error message
  ↓
Step 2: Grep tìm vị trí error
  ↓
Step 3: ReadFile đúng file đó
  ↓
Step 4: Fix
```

### Pattern 3: Refactoring

```
Step 1: Grep tìm tất cả usages
  ↓
Step 2: ReadFile những file cần sửa
  ↓
Step 3: StrReplaceFile nhiều edit 1 lúc
  ↓
Step 4: Verify với shell
```

---

## 📝 Checklist Trước Mỗi Session

- [ ] Đã đọc PROGRESS.md?
- [ ] Biết mình sẽ làm module nào?
- [ ] Đã xem DECISIONS.md cho architecture?
- [ ] Biết file nào cần đọc trước?

---

## 🚫 Anti-Patterns (Tránh)

| Anti-Pattern | Tại sao tệ | Thay thế |
|--------------|-----------|----------|
| `ReadFile` nhiều file cùng lúc | Tốn token, context bloat | `cat` trong Shell |
| `Grep` không có `head_limit` | Output quá dài | `head_limit: 20` |
| Đọc cả file dù chỉ sửa 1 hàm | Lãng phí token | Dùng `line_offset` + `n_lines` |
| Không track progress | Lặp lại công việc | Update PROGRESS.md |
| Bỏ qua DECISIONS.md | Code sai architecture | Check trước khi code |

---

## 📊 Token Budget Guidelines

| Task Type | Est. Token Usage | Tips |
|-----------|-----------------|------|
| 1 module CRUD | ~5k-8k | Grep trước, đọc reference |
| Bug fix đơn giản | ~1k-2k | Shell error → Grep → ReadFile |
| Refactor nhỏ | ~2k-4k | StrReplaceFile batch edits |
| WebSocket Gateway | ~8k-12k | Phase 4 riêng biệt |
| Full feature set | ~20k+ | Chia thành nhiều session |

---

## 🔗 Quick Reference

```bash
# Tìm pattern trong src
grep -r "pattern" src/ --include="*.ts"

# Xem nhanh file không cần ReadFile
cat src/modules/auth/auth.service.ts

# List directory
ls src/modules/

# Check git status
git status
```

---

## 💡 Tips Đặc Biệt Cho VinClassroom API

1. **Redis Keys:** Đã định nghĩa trong `src/redis/keys.ts` - dùng lại đừng tạo mới

2. **Database Schema:** Xem `plans/deployment-plan.md` section 1.1

3. **Module Structure:** NestJS standard - mỗi module có controller, service, module, dto

4. **Error Handling:** Đã có global filter - không cần try-catch thủ công trong service

5. **Testing:** Viết test song song với code - đừng để cuối cùng

---

*Skill này giúp tối ưu token usage và duy trì context hiệu quả.*
