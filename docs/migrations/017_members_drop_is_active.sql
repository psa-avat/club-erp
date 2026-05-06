-- Migration 017: drop deprecated members.is_active in favor of status

ALTER TABLE members
  DROP COLUMN IF EXISTS is_active;