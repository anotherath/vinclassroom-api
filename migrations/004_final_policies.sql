-- Migration: Final RLS Policies for Supabase SQL Editor
-- Date: 2026-04-10
-- Description: Complete RLS policies for all tables
-- Run this in: Supabase Dashboard > SQL Editor > New query

-- ============================================
-- 1. MESSAGE ATTACHMENTS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Message attachments viewable by room members" ON message_attachments;
DROP POLICY IF EXISTS "Users can insert attachments to own messages" ON message_attachments;
DROP POLICY IF EXISTS "Users can delete own message attachments" ON message_attachments;

-- Policy: Viewable by room members
CREATE POLICY "Message attachments viewable by room members" ON message_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN room_members rm ON m.room_id = rm.room_id
      WHERE m.id = message_attachments.message_id
      AND rm.user_id = auth.uid()
    )
  );

-- Policy: Insert only to own messages
CREATE POLICY "Users can insert attachments to own messages" ON message_attachments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages 
      WHERE id = message_attachments.message_id 
      AND user_id = auth.uid()
    )
  );

-- Policy: Delete own attachments
CREATE POLICY "Users can delete own message attachments" ON message_attachments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM messages 
      WHERE id = message_attachments.message_id 
      AND user_id = auth.uid()
    )
  );

-- ============================================
-- 2. REACTIONS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Reactions viewable by room members" ON reactions;
DROP POLICY IF EXISTS "Users can add own reactions" ON reactions;
DROP POLICY IF EXISTS "Users can remove own reactions" ON reactions;

-- Policy: Viewable by room members
CREATE POLICY "Reactions viewable by room members" ON reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN room_members rm ON m.room_id = rm.room_id
      WHERE m.id = reactions.message_id
      AND rm.user_id = auth.uid()
    )
  );

-- Policy: Users can add their own reactions
CREATE POLICY "Users can add own reactions" ON reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can remove their own reactions
CREATE POLICY "Users can remove own reactions" ON reactions
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. ROOM MEMBERS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Room members manageable by space admins" ON room_members;
DROP POLICY IF EXISTS "Room members viewable by space members" ON room_members;
DROP POLICY IF EXISTS "Users can join public rooms" ON room_members;

-- Policy: Viewable by space members
CREATE POLICY "Room members viewable by space members" ON room_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = (
        SELECT space_id FROM rooms WHERE id = room_members.room_id
      )
      AND user_id = auth.uid()
    )
  );

-- Policy: Insert by space admins or room managers
CREATE POLICY "Room members insertable by space admins" ON room_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = (
        SELECT space_id FROM rooms WHERE id = room_members.room_id
      )
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- Policy: Delete by space admins or self
CREATE POLICY "Room members deletable by admins or self" ON room_members
  FOR DELETE USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = (
        SELECT space_id FROM rooms WHERE id = room_members.room_id
      )
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================
-- 4. SPACE INVITATIONS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Space invitations viewable by space admins" ON space_invitations;
DROP POLICY IF EXISTS "Space invitations manageable by space admins" ON space_invitations;

-- Policy: Viewable by space admins
CREATE POLICY "Space invitations viewable by space admins" ON space_invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = space_invitations.space_id 
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- Policy: Insert by space admins
CREATE POLICY "Space invitations insertable by space admins" ON space_invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = space_invitations.space_id 
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- Policy: Update by space admins
CREATE POLICY "Space invitations updatable by space admins" ON space_invitations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = space_invitations.space_id 
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- Policy: Delete by space admins
CREATE POLICY "Space invitations deletable by space admins" ON space_invitations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM space_members 
      WHERE space_id = space_invitations.space_id 
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================
-- 5. BLOCKED USERS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Blocked users viewable by blocker" ON blocked_users;
DROP POLICY IF EXISTS "Users can block others" ON blocked_users;
DROP POLICY IF EXISTS "Users can unblock" ON blocked_users;

-- Policy: Viewable by blocker only
CREATE POLICY "Blocked users viewable by blocker" ON blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

-- Policy: Users can block others
CREATE POLICY "Users can block others" ON blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

-- Policy: Users can unblock
CREATE POLICY "Users can unblock" ON blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);

-- ============================================
-- 6. NOTIFICATIONS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Notifications viewable by owner" ON notifications;
DROP POLICY IF EXISTS "Notifications insertable by system" ON notifications;
DROP POLICY IF EXISTS "Notifications updatable by owner" ON notifications;
DROP POLICY IF EXISTS "Notifications deletable by owner" ON notifications;

-- Policy: Viewable by owner
CREATE POLICY "Notifications viewable by owner" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Insertable by authenticated users (for mentions, etc.)
CREATE POLICY "Notifications insertable by system" ON notifications
  FOR INSERT WITH CHECK (true);

-- Policy: Updatable by owner (mark as read)
CREATE POLICY "Notifications updatable by owner" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Deletable by owner
CREATE POLICY "Notifications deletable by owner" ON notifications
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 7. DM CONVERSATIONS POLICIES
-- ============================================

DROP POLICY IF EXISTS "DM conversations viewable by participants" ON dm_conversations;
DROP POLICY IF EXISTS "Users can create DM conversations" ON dm_conversations;

-- Policy: Viewable by participants
CREATE POLICY "DM conversations viewable by participants" ON dm_conversations
  FOR SELECT USING (
    auth.uid() = user1_id OR auth.uid() = user2_id
  );

-- Policy: Users can create DM conversations
CREATE POLICY "Users can create DM conversations" ON dm_conversations
  FOR INSERT WITH CHECK (
    auth.uid() = user1_id OR auth.uid() = user2_id
  );

-- ============================================
-- 8. DM MESSAGES POLICIES
-- ============================================

DROP POLICY IF EXISTS "DM messages viewable by participants" ON dm_messages;
DROP POLICY IF EXISTS "Participants can send DM messages" ON dm_messages;
DROP POLICY IF EXISTS "Users can update own DM messages" ON dm_messages;
DROP POLICY IF EXISTS "Users can delete own DM messages" ON dm_messages;

-- Policy: Viewable by conversation participants
CREATE POLICY "DM messages viewable by participants" ON dm_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM dm_conversations 
      WHERE id = conversation_id 
      AND (user1_id = auth.uid() OR user2_id = auth.uid())
    )
  );

-- Policy: Only participants can send messages
CREATE POLICY "Participants can send DM messages" ON dm_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM dm_conversations 
      WHERE id = conversation_id 
      AND (user1_id = auth.uid() OR user2_id = auth.uid())
    )
  );

-- Policy: Users can update own messages
CREATE POLICY "Users can update own DM messages" ON dm_messages
  FOR UPDATE USING (
    sender_id = auth.uid() AND 
    deleted_at IS NULL
  );

-- Policy: Users can soft delete own messages
CREATE POLICY "Users can delete own DM messages" ON dm_messages
  FOR DELETE USING (sender_id = auth.uid());

-- ============================================
-- 9. VALIDATION
-- ============================================

-- Verify all tables have RLS enabled
DO $$
DECLARE
  rls_disabled_tables TEXT[];
BEGIN
  SELECT ARRAY_AGG(tablename)
  INTO rls_disabled_tables
  FROM pg_tables
  WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'spaces', 'rooms', 'space_members', 'room_members',
    'messages', 'message_attachments', 'reactions', 'dm_conversations',
    'dm_messages', 'notifications', 'blocked_users', 'space_invitations', 'files'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relname = tablename
    AND c.relrowsecurity = true
  );
  
  IF rls_disabled_tables IS NOT NULL THEN
    RAISE WARNING 'Tables without RLS: %', rls_disabled_tables;
  END IF;
END $$;

-- Count policies per table
SELECT 
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
