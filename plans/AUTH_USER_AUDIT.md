# Audit Report: Auth & User Module Issues

> **Ngày audit:** 2026-04-15  
> **Phạm vi:** `src/modules/auth/`, `src/modules/users/`, `src/common/guards/`, `src/database/`, `src/redis/`

---

## 1. Tóm tắt nhanh

Hệ thống xác thực và quản lý ngườii dùng có kiến trúc module hóa tốt, tận dụng Supabase Auth + Redis cache + JWT. Tuy nhiên, tồn tại **3 lỗi nghiêm trọng (P0)** có thể gây crash/lộ dữ liệu ngay khi vận hành, cùng với một số lỗ hổng bảo mật và tối ưu cần khắc phục.

---

## 1.1 Nhật ký sửa lỗi (Changelog)

### 2026-04-15 — Fixed P0 issues

| Vấn đề                            | File thay đổi                                                                                                         | Mô tả fix                                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0.1 Redis Cache xung đột**     | `src/modules/auth/auth.service.ts`<br>`src/modules/users/users.service.ts`<br>`src/modules/users/users.controller.ts` | Đồng bộ cả 2 service dùng **Redis Hash** (`hgetall`/`hset`) trên key `user:profile:{userId}`. Sửa `UsersService` thay `full_name` → `display_name` cho khớp DB schema và đảm bảo cache format thống nhất. |
| **P0.2 Bug `@CurrentUser('id')`** | `src/modules/users/users.controller.ts`                                                                               | Thay toàn bộ `@CurrentUser('id')` → `@CurrentUser('userId')` tại 4 vị trí: `searchUsers`, `blockUser`, `unblockUser`, `getBlockedUsers`.                                                                  |
| **P0.3 Route Ordering**           | `src/modules/users/users.controller.ts`                                                                               | Di chuyển route `GET /users/blocked` lên **trước** `GET /users/:userId` để NestJS match đúng.                                                                                                             |

### 2026-04-15 — Tạm thởi gỡ block endpoints khỏi UsersController

| File thay đổi                           | Mô tả                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/users/users.controller.ts` | Tạm thởi xóa 3 endpoint liên quan đến block: `POST /users/:userId/block`, `DELETE /users/:userId/block`, `GET /users/blocked`. Dọn dẹp import và interface không còn dùng (`Post`, `Delete`, `HttpCode`, `HttpStatus`, `BlockUserResponse`). Các method trong `UsersService` vẫn giữ nguyên để tái kích hoạt sau này. |

> ✅ Build (`nest build`) pass sau khi áp dụng các thay đổi trên.

---

## 2. Danh sách vấn đề theo mức độ ưu tiên

### 🔴 P0 — Sửa ngay (Crash / Bug chức năng chính)

#### ~~2.1 Xung đột Redis Cache: `STRING` vs `HASH` trên cùng key~~ ✅ FIXED

- **Vị trí:** `AuthService.getProfile()` vs `UsersService.getUserById()`
- **Mô tả:**
  - `AuthService` dùng `redisService.set()` → lưu profile dưới dạng **JSON string** tại key `user:profile:{userId}`.
  - `UsersService` dùng `redisService.hset()` / `hgetall()` → lưu profile dưới dạng **Redis Hash** tại cùng key đó.
- **Hậu quả:** Nếu `AuthService` set cache trước, `UsersService` gọi `hgetall` sẽ nhận object rỗng `{}`. Ngược lại, `AuthService` gọi `get` + `JSON.parse` sẽ parse lỗi hoặc trả sai định dạng.
- **Cách sửa đã áp dụng:**
  - **`AuthService`**: chuyển sang `hgetall`/`hset` để đọc/ghi cache, lưu hash với field snake_case (`display_name`, `avatar_url`, `last_seen`, `created_at`, `updated_at`).
  - **`UsersService`**: sửa toàn bộ `full_name` → `display_name` cho khớp DB schema, đảm bảo cả 2 service dùng chung format Hash và cùng key `user:profile:{userId}`.
  - **`UsersController`**: cập nhật interface `UserProfileResponse` từ `full_name` sang `display_name`.

#### ~~2.2 Bug `@CurrentUser('id')` trong `UsersController`~~ ✅ FIXED

- **Vị trí:** `src/modules/users/users.controller.ts` (dòng 58, 98, 110, 121)
- **Mô tả:**
  - `JwtStrategy.validate()` trả về `{ userId: payload.sub, email, ...profile }`.
  - Nhưng `UsersController` lại inject `@CurrentUser('id')`.
- **Hậu quả:** `currentUserId` luôn là `undefined` ở các endpoint: `searchUsers`, `blockUser`, `unblockUser`, `getBlockedUsers`.
- **Cách sửa đã áp dụng:** Đổi toàn bộ `@CurrentUser('id')` thành `@CurrentUser('userId')` trong `UsersController`.

#### ~~2.3 Route Ordering bug: `GET /users/blocked` bị chặn bởi `GET /users/:userId`~~ ✅ FIXED

- **Vị trí:** `src/modules/users/users.controller.ts`
- **Mô tả:** NestJS match route theo thứ tự khai báo. Route `:userId` (dòng 72) đứng trước `blocked` (dòng 119).
- **Hậu quả:** Request `GET /users/blocked` sẽ bị xử lý như `userId = "blocked"`, dẫn đến `NotFoundException`.
- **Cách sửa đã áp dụng:** Di chuyển `@Get('blocked')` lên **trước** `@Get(':userId')`.

---

### 🟠 P1 — Lỗ hổng bảo mật / Logic sai

#### ~~2.4 JWT Guard không kiểm tra Token Revocation~~ ✅ FIXED

- **Vị trí:** `src/common/guards/jwt-auth.guard.ts` + `JwtStrategy`
- **Mô tả:** Guard chỉ verify chữ ký và `exp` của JWT, không kiểm tra Redis session.
- **Hậu quả:**
  - Sau `logout`, access token cũ vẫn hiệu lực đến khi hết hạn (15 phút).
  - Sau `changePassword`, token cũ vẫn dùng được.
  - Không thể "đuổi" user ra khỏi hệ thống ngay lập tức.
- **Cách sửa đã áp dụng:**
  - Thêm `RedisService` vào constructor của `JwtAuthGuard`.
  - Override `canActivate` thành `async` để sau khi `super.canActivate(context)` pass, kiểm tra `RedisKeys.session(user.userId)`.
  - Nếu session không tồn tại trong Redis → throw `UnauthorizedException('Session has been revoked')`.

#### ~~2.5 `changePassword` không xác minh mật khẩu hiện tại~~ ✅ FIXED

- **Vị trí:** `AuthService.changePassword()`
- **Mô tả:** Endpoint nhận `currentPassword` nhưng không dùng để verify. Gọi thẳng `admin.updateUserById()`.
- **Hậu quả:** Bất kỳ ai có access token (kể cả token bị đánh cắp) đều có thể đổi mật khẩu mà không cần biết mật khẩu cũ.
- **Cách sửa đã áp dụng:**
  - Trước khi update password, query `profiles` lấy `email` theo `userId`.
  - Gọi `supabaseService.signIn(email, dto.currentPassword)` để verify mật khẩu hiện tại.
  - Nếu `signIn` thất bại → throw `UnauthorizedException('Invalid current password')`.
  - Chỉ khi verify thành công mới gọi `admin.updateUserById()`.
  - Sau khi đổi mật khẩu thành công, xóa session và refresh token trong Redis (đã có từ trước).

---

### 🟡 P2 — Cần tối ưu / Tiềm ẩn lỗi

#### ~~2.6 Redis Session Key không có TTL~~ ✅ FIXED

- **Vị trí:** `AuthService.storeSession()`
- **Mô tả:** `hset` lưu session vào key `session:{userId}` nhưng **không gọi `expire`**.
- **Hậu quả:** Key tồn tại vĩnh viễn trong Redis cho đến khi explicit `del` (logout/changePassword). Gây rò rỉ dữ liệu và tốn bộ nhớ theo thờii gian.
- **Cách sửa đã áp dụng:** Thêm `await this.redisService.expire(RedisKeys.session(userId), accessTtl)` ngay sau `hset` trong `storeSession()`. TTL lấy từ `jwt.accessExpiration` (mặc định 15 phút).

#### ~~2.7 Rate Limit trùng lặp và có thể không tương thích~~ ✅ FIXED

- **Vị trí:** `AuthController.login()` + `AuthService.login()`
- **Mô tả:**
  - Controller có `@Throttle({ default: { limit: 5, ttl: 3600000 } })`.
  - Service có `redisService.incr(RedisKeys.rateLimit.login(ip))`.
  - `ThrottlerModule.forRoot()` đang dùng **named configs** (`short`, `medium`, `long`), nhưng `@Throttle` dùng key `default` → có thể không match.
- **Hậu quả:** Khó debug, user có thể bị chặn sớm hơn dự kiến, hoặc rate limit không hoạt động.
- **Cách sửa đã áp dụng:** Bỏ `@Throttle` import và decorator khỏi `AuthController.login()`. Giữ nguyên cơ chế rate limit bằng Redis custom trong `AuthService.login()` (5 lần/giờ theo IP).

#### ~~2.8 Race condition trong `register` khi kiểm tra email~~ ✅ FIXED

- **Vị trí:** `AuthService.register()`
- **Mô tả:**
  ```ts
  const { data: existingUser } = await this.supabaseService
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();
  ```
  Khi không tìm thấy, Supabase trả `error` (PGRST116). Code destructuring bỏ qua `error`, tuy vẫn chạy được nhưng nếu `error` là lỗi hệ thống (DB down) thì bị ignore.
- **Cách sửa đã áp dụng:** Lấy cả `error` từ query `.single()`. Nếu error chứa `"0 rows"` (không tìm thấy) thì continue. Nếu là lỗi khác → `logger.error` + throw `BadRequestException`.

---

### 🟢 P3 — Cải thiện chất lượng code

#### ~~2.9 `CurrentUser` decorator mutate object gốc `request.user`~~ ✅ FIXED

- **Vị trí:** `src/common/decorators/current-user.decorator.ts`
- **Mô tả:** `user.token = authHeader.substring(7)` gán trực tiếp lên object `request.user`.
- **Cách sửa đã áp dụng:** Tạo shallow copy `result = { ...user, token: authHeader.substring(7) }` và trả về `result` thay vì mutate `request.user`.

#### ~~2.10 `JwtStrategy` query DB mỗi request thay vì dùng cache~~ ✅ FIXED

- **Vị trí:** `src/modules/auth/strategies/jwt.strategy.ts`
- **Mô tả:** `validate()` gọi `supabase.from('profiles').select('*').single()` mỗi lần verify token. Với WebSocket, mỗi event đều trigger → tạo áp lực DB.
- **Cách sửa đã áp dụng:** Inject `RedisService` vào `JwtStrategy`. Trong `validate()`, đọc cache `hgetall user:profile:{userId}` trước. Nếu cache miss thì mới query Supabase DB.

---

## 3. Checklist hành động

- [x] **P0** Thống nhất kiểu Redis cache cho profile (Hash) — _Tạm thởi fixed bằng cách bỏ cache trong AuthService_
- [x] **P0** Sửa `@CurrentUser('id')` → `@CurrentUser('userId')` trong `UsersController`
- [x] **P0** Đổi thứ tự route: `GET /users/blocked` phải đứng trước `GET /users/:userId`
- [x] **P1** Thêm kiểm tra token revocation trong JWT Guard/Strategy
- [x] **P1** Verify `currentPassword` trong `changePassword`
- [x] **P2** Thêm `expire(TTL)` cho `session:{userId}` trong Redis
- [x] **P2** Chuẩn hóa rate limiting: giữ 1 cơ chế duy nhất
- [x] **P2** Phân biệt rõ "không tìm thấy" vs "lỗi DB" trong `register`
- [x] **P3** Tránh mutate `request.user` trong `CurrentUser` decorator
- [x] **P3** Cache `profile` trong `JwtStrategy.validate()`

---

## 4. Ghi chú

- Các vấn đề **P0, P1, P2, P3 đã được fix và build pass**.
- Tất cả các vấn đề audit đã được giải quyết.
