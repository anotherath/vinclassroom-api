-- Migration: Search Performance Indexes
-- Date: 2026-04-10
-- Description: Add indexes and functions for full-text search functionality

-- ============================================
-- 1. ENABLE EXTENSIONS
-- ============================================

-- Enable pg_trgm extension for trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable unaccent extension for better text search (optional but recommended)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================
-- 2. INDEXES FOR MESSAGES SEARCH
-- ============================================

-- Trigram index for content search (fuzzy matching)
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm 
ON messages USING gin (content gin_trgm_ops);

-- B-tree index for exact content search
CREATE INDEX IF NOT EXISTS idx_messages_content 
ON messages (content);

-- Composite index for room-based queries
CREATE INDEX IF NOT EXISTS idx_messages_room_id_created_at 
ON messages (room_id, created_at DESC);

-- Partial index for non-deleted messages (common case)
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted 
ON messages (room_id, created_at DESC) 
WHERE deleted_at IS NULL;

-- ============================================
-- 3. INDEXES FOR PROFILES SEARCH
-- ============================================

-- Trigram index for display name search
CREATE INDEX IF NOT EXISTS idx_profiles_display_name_trgm 
ON profiles USING gin (display_name gin_trgm_ops);

-- Trigram index for email search
CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm 
ON profiles USING gin (email gin_trgm_ops);

-- B-tree index for exact display name match
CREATE INDEX IF NOT EXISTS idx_profiles_display_name 
ON profiles (display_name);

-- ============================================
-- 4. INDEXES FOR SPACES SEARCH
-- ============================================

-- Trigram index for space name search
CREATE INDEX IF NOT EXISTS idx_spaces_name_trgm 
ON spaces USING gin (name gin_trgm_ops);

-- Trigram index for space description search
CREATE INDEX IF NOT EXISTS idx_spaces_description_trgm 
ON spaces USING gin (description gin_trgm_ops);

-- Composite index for private space filtering
CREATE INDEX IF NOT EXISTS idx_spaces_private_name 
ON spaces (is_private, name);

-- ============================================
-- 5. INDEXES FOR FILES SEARCH
-- ============================================

-- Trigram index for file name search
CREATE INDEX IF NOT EXISTS idx_files_file_name_trgm 
ON files USING gin (file_name gin_trgm_ops);

-- B-tree index for file name exact match
CREATE INDEX IF NOT EXISTS idx_files_file_name 
ON files (file_name);

-- Composite index for space-based file queries
CREATE INDEX IF NOT EXISTS idx_files_space_uploader 
ON files (space_id, uploader_id, created_at DESC);

-- ============================================
-- 6. INDEXES FOR DM SEARCH
-- ============================================

-- Trigram index for DM content search
CREATE INDEX IF NOT EXISTS idx_dm_messages_content_trgm 
ON dm_messages USING gin (content gin_trgm_ops);

-- Composite index for conversation queries
CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_created 
ON dm_messages (conversation_id, created_at DESC);

-- ============================================
-- 7. SEARCH HELPER FUNCTIONS
-- ============================================

-- Function to calculate search relevance score
CREATE OR REPLACE FUNCTION calculate_search_score(
  search_query TEXT,
  target_text TEXT
) RETURNS INTEGER AS $$
DECLARE
  score INTEGER := 0;
  normalized_query TEXT;
  normalized_target TEXT;
BEGIN
  -- Normalize texts
  normalized_query := lower(trim(search_query));
  normalized_target := lower(trim(target_text));
  
  -- Exact match: +100
  IF normalized_target = normalized_query THEN
    score := score + 100;
  END IF;
  
  -- Starts with query: +50
  IF normalized_target LIKE normalized_query || '%' THEN
    score := score + 50;
  END IF;
  
  -- Contains query: +30
  IF normalized_target LIKE '%' || normalized_query || '%' THEN
    score := score + 30;
  END IF;
  
  -- Word match using trigram similarity: +10
  IF similarity(normalized_target, normalized_query) > 0.3 THEN
    score := score + 10;
  END IF;
  
  RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to highlight search matches
CREATE OR REPLACE FUNCTION highlight_search(
  search_query TEXT,
  target_text TEXT,
  max_length INTEGER DEFAULT 100
) RETURNS TEXT AS $$
DECLARE
  result TEXT;
  normalized_query TEXT;
  pos INTEGER;
  start_pos INTEGER;
  end_pos INTEGER;
BEGIN
  normalized_query := lower(trim(search_query));
  
  -- Find position of match
  pos := position(normalized_query in lower(target_text));
  
  IF pos = 0 THEN
    -- No direct match, return beginning of text
    RETURN left(target_text, max_length);
  END IF;
  
  -- Calculate highlight window
  start_pos := greatest(1, pos - 20);
  end_pos := least(length(target_text), pos + length(search_query) + 20);
  
  -- Extract and highlight
  result := substring(target_text from start_pos for (end_pos - start_pos + 1));
  
  -- Add ellipsis if truncated
  IF start_pos > 1 THEN
    result := '...' || result;
  END IF;
  IF end_pos < length(target_text) THEN
    result := result || '...';
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 8. UPDATE STATISTICS
-- ============================================

-- Update statistics for query planner
ANALYZE messages;
ANALYZE profiles;
ANALYZE spaces;
ANALYZE files;
ANALYZE dm_messages;

-- ============================================
-- 9. VALIDATION
-- ============================================

-- Verify indexes were created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_messages_content_trgm'
  ) THEN
    RAISE EXCEPTION 'Search indexes were not created properly';
  END IF;
END $$;
