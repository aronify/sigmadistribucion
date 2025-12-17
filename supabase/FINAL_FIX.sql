-- ==========================================
-- FINAL FIX: Update status constraints
-- ==========================================
-- Make sure you're in the project: rfzkpgtancqsjxivrnts
-- ==========================================

-- First, let's see what exists
SELECT 'Checking what exists...' as step;

-- Show all tables
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Now try to fix - this will work if tables exist
-- If you get errors, the tables don't exist and you need to run COMPLETE_SETUP.sql first

BEGIN;

-- Drop old constraints (ignore errors if they don't exist)
DO $$ 
BEGIN
    -- Try to drop packages constraint
    BEGIN
        ALTER TABLE packages DROP CONSTRAINT packages_status_check;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE packages DROP CONSTRAINT packages_status_check1;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    
    -- Try to drop history constraints
    BEGIN
        ALTER TABLE package_status_history DROP CONSTRAINT package_status_history_from_status_check;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE package_status_history DROP CONSTRAINT package_status_history_to_status_check;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
END $$;

-- Add new constraints
ALTER TABLE packages 
ADD CONSTRAINT packages_status_check 
CHECK (status IN (
  'just_created',
  'created', 
  'envelope_prepared', 
  'queued_for_print', 
  'printed', 
  'handed_over', 
  'in_transit', 
  'at_branch', 
  'delivered', 
  'returned', 
  'canceled'
));

ALTER TABLE package_status_history 
ADD CONSTRAINT package_status_history_from_status_check 
CHECK (from_status IS NULL OR from_status IN (
  'just_created',
  'created', 
  'envelope_prepared', 
  'queued_for_print', 
  'printed', 
  'handed_over', 
  'in_transit', 
  'at_branch', 
  'delivered', 
  'returned', 
  'canceled'
));

ALTER TABLE package_status_history 
ADD CONSTRAINT package_status_history_to_status_check 
CHECK (to_status IN (
  'just_created',
  'created', 
  'envelope_prepared', 
  'queued_for_print', 
  'printed', 
  'handed_over', 
  'in_transit', 
  'at_branch', 
  'delivered', 
  'returned', 
  'canceled'
));

COMMIT;

-- Verify
SELECT 
    'VERIFICATION:' as info,
    conname as constraint_name,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'packages'::regclass
AND contype = 'c'
AND pg_get_constraintdef(oid) LIKE '%status%';

-- ==========================================
-- If you get "relation packages does not exist":
-- 1. Make sure you're in project: rfzkpgtancqsjxivrnts
-- 2. Run supabase/COMPLETE_SETUP.sql FIRST to create tables
-- 3. Then run this script again
-- ==========================================

