-- Migration: Storage Setup for Supabase SQL Editor
-- Date: 2026-04-10
-- Description: Setup Supabase Storage for Files Module
-- Run this in: Supabase Dashboard > SQL Editor > New query

-- ============================================
-- 1. STORAGE BUCKETS
-- ============================================

-- Tạo bucket 'files' cho file uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'files',
  'files',
  true,
  104857600, -- 100MB in bytes
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================
-- 2. FILES TABLE RLS POLICIES
-- ============================================

-- Drop existing policies if any (for idempotency)
DROP POLICY IF EXISTS "Files viewable by space members" ON files;
DROP POLICY IF EXISTS "Users can insert own files" ON files;
DROP POLICY IF EXISTS "Users can delete own files" ON files;

-- Policy: Files viewable by space members
CREATE POLICY "Files viewable by space members" ON files
  FOR SELECT USING (
    space_id IS NULL OR
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = files.space_id AND user_id = auth.uid()
    ) OR
    uploader_id = auth.uid()
  );

-- Policy: Users can insert own files
CREATE POLICY "Users can insert own files" ON files
  FOR INSERT WITH CHECK (auth.uid() = uploader_id);

-- Policy: Users can delete own files
CREATE POLICY "Users can delete own files" ON files
  FOR DELETE USING (auth.uid() = uploader_id);

-- ============================================
-- 3. STORAGE FUNCTIONS
-- ============================================

-- Function to clean up storage when file is deleted from database
CREATE OR REPLACE FUNCTION delete_storage_object_on_file_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from storage.objects
  DELETE FROM storage.objects 
  WHERE bucket_id = 'files' 
  AND name = OLD.file_url;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-delete storage object when file record is deleted
DROP TRIGGER IF EXISTS trigger_delete_storage_object ON files;
CREATE TRIGGER trigger_delete_storage_object
  AFTER DELETE ON files
  FOR EACH ROW
  EXECUTE FUNCTION delete_storage_object_on_file_delete();

-- ============================================
-- 4. VALIDATION
-- ============================================

-- Verify bucket creation
SELECT 'Storage bucket created' as status
WHERE EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'files');
