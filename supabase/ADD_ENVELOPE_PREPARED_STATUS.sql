-- ==========================================
-- MIGRATION: Add 'envelope_prepared' and 'just_created' status
-- ==========================================
-- Run this in Supabase SQL Editor to update existing database
-- https://app.supabase.com/project/[YOUR_PROJECT]/sql
-- ==========================================

-- Step 1: Drop and recreate constraint on packages.status
-- This will work regardless of the constraint name
DO $$ 
BEGIN
    -- Drop any existing status constraint on packages table
    -- Try multiple possible constraint names
    ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
    ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check1;
    
    -- Also try to find and drop any CHECK constraint on status column
    PERFORM 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu 
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'packages'
      AND tc.constraint_type = 'CHECK'
      AND ccu.column_name = 'status';
    
    -- If we found one, we'll handle it in the next step
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table packages does not exist, skipping...';
END $$;

-- Step 2: Add new constraint with all statuses (only if table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'packages'
    ) THEN
        ALTER TABLE packages 
        ADD CONSTRAINT packages_status_check 
        CHECK (status IN (
          'just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 
          'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'
        ));
        RAISE NOTICE 'Updated packages.status constraint';
    ELSE
        RAISE NOTICE 'Table packages does not exist, skipping...';
    END IF;
END $$;

-- Step 3: Drop and recreate constraint on package_status_history.from_status
DO $$ 
BEGIN
    ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check;
    ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check1;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table package_status_history does not exist, skipping...';
END $$;

-- Step 4: Add new constraint for from_status (only if table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'package_status_history'
    ) THEN
        ALTER TABLE package_status_history 
        ADD CONSTRAINT package_status_history_from_status_check 
        CHECK (from_status IS NULL OR from_status IN (
          'just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 
          'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'
        ));
        RAISE NOTICE 'Updated package_status_history.from_status constraint';
    ELSE
        RAISE NOTICE 'Table package_status_history does not exist, skipping...';
    END IF;
END $$;

-- Step 5: Drop and recreate constraint on package_status_history.to_status
DO $$ 
BEGIN
    ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check;
    ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check1;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table package_status_history does not exist, skipping...';
END $$;

-- Step 6: Add new constraint for to_status (only if table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'package_status_history'
    ) THEN
        ALTER TABLE package_status_history 
        ADD CONSTRAINT package_status_history_to_status_check 
        CHECK (to_status IN (
          'just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 
          'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'
        ));
        RAISE NOTICE 'Updated package_status_history.to_status constraint';
    ELSE
        RAISE NOTICE 'Table package_status_history does not exist, skipping...';
    END IF;
END $$;

-- ==========================================
-- Migration complete!
-- You can now use 'envelope_prepared' and 'just_created' as package statuses
-- ==========================================
