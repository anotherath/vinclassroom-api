# Supabase Storage Setup Guide

> **Required for:** Files Module  
> **Date:** 2026-04-10

---

## 1. Tạo Storage Bucket

Trong Supabase Dashboard:

1. Vào **Storage** → **New Bucket**
2. Tên bucket: `files`
3. Chọn **Public bucket** (để có thể truy cập URL public)
4. Click **Create bucket**

---

## 2. Cấu hình RLS Policies

Chạy SQL sau trong Supabase SQL Editor:

```sql
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can upload their own files
CREATE POLICY "Users can upload their own files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'files' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can read files in their spaces
CREATE POLICY "Users can read files in their spaces"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'files'
);

-- Policy: Users can delete their own files
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'files' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

---

## 3. CORS Configuration (nếu cần)

Trong Supabase Dashboard:

1. Vào **Storage** → **Policies** → **CORS**
2. Add your frontend domain:
   ```
   http://localhost:3000
   https://your-domain.com
   ```

---

## 4. File Types Allowed

Hệ thống chấp nhận các file types sau:

| Category | MIME Types |
|----------|------------|
| **Image** | image/jpeg, image/png, image/gif, image/webp, image/svg+xml |
| **Video** | video/mp4, video/webm, video/ogg, video/quicktime |
| **Audio** | audio/mpeg, audio/ogg, audio/wav, audio/webm |
| **Document** | application/pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, text/plain |

**Max file size:** 100MB

---

## 5. Kiểm tra

Upload test file qua API:

```bash
curl -X POST http://localhost:3000/files \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test-image.png" \
  -F "description=Test upload"
```

---

## Lưu ý

- Files được lưu theo path: `{userId}/{timestamp}_{filename}`
- Metadata được lưu trong bảng `files` (PostgreSQL)
- Redis cache cho recent files và file metadata
- Xóa file sẽ xóa cả trong Storage và Database
