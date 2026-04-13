# Search Module Setup Guide

> **Module:** Search  
> **Date:** 2026-04-10  
> **Database:** PostgreSQL (Supabase) with pg_trgm

---

## 1. Database Setup

Chạy migration để tạo indexes:

```bash
# Trong Supabase SQL Editor, chạy:
psql -f migrations/002_search_indexes.sql
```

Hoặc chạy trực tiếp SQL:

```sql
-- Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create indexes for search
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm 
ON messages USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_display_name_trgm 
ON profiles USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm 
ON profiles USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_spaces_name_trgm 
ON spaces USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_files_file_name_trgm 
ON files USING gin (file_name gin_trgm_ops);
```

---

## 2. API Endpoints

### Global Search
```http
GET /search?q=keyword&type=all&page=1&limit=20
```

**Query Parameters:**
- `q` (required): Search query
- `type` (optional): `all` | `messages` | `users` | `spaces` | `files`
- `spaceId` (optional): Limit search to specific space
- `roomId` (optional): Limit search to specific room
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 20, max: 50)

### Type-Specific Search
```http
GET /search/messages?q=hello
GET /search/users?q=john
GET /search/spaces?q=general
GET /search/files?q=document
```

### Popular Searches
```http
GET /search/popular?type=messages
```

---

## 3. Response Format

```json
{
  "success": true,
  "data": [
    {
      "type": "message",
      "id": "uuid",
      "title": "Message in General",
      "content": "Hello everyone!",
      "highlight": "...Hello everyone...",
      "metadata": {
        "authorName": "John",
        "roomId": "uuid",
        "spaceId": "uuid"
      },
      "score": 85,
      "createdAt": "2026-04-10T10:00:00Z"
    }
  ],
  "meta": {
    "query": "hello",
    "total": 42,
    "hasMore": true,
    "page": 1,
    "limit": 20,
    "byType": {
      "messages": 30,
      "users": 5,
      "spaces": 2,
      "files": 5
    }
  }
}
```

---

## 4. Search Scoring

Hệ thống scoring dựa trên:

| Factor | Score |
|--------|-------|
| Exact match | +100 |
| Starts with query | +50 |
| Contains query | +30 |
| Word match | +10 |

Kết quả được sắp xếp theo score giảm dần, sau đó theo thờigian.

---

## 5. Caching

- **Cache key:** MD5 hash của `userId:query:type:spaceId:roomId`
- **TTL:** 5 minutes (300 seconds)
- **Redis key:** `search:{hash}`

---

## 6. Performance Notes

- Sử dụng `pg_trgm` (trigram) indexes cho text search
- Giới hạn 100 ký tự cho search query
- Tối thiểu 2 ký tự để search
- Mỗi loại search giới hạn 50 kết quả trước khi merge

---

## 7. Security

- Chỉ search trong spaces mà user là member
- Chỉ search messages trong rooms có access
- Chỉ search files do user upload hoặc trong shared spaces
