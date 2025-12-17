-- ==========================================
-- SIMPLE FIX: Add 'envelope_prepared' and 'just_created' status
-- ==========================================
-- Copy and paste this ENTIRE file into Supabase SQL Editor and run it
-- ==========================================

-- Step 1: Drop the old constraint (try all possible names)
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check1;
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check2;

-- Step 2: Add the new constraint with all statuses
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

-- Step 3: Fix package_status_history.from_status constraint
ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check;
ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check1;

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

-- Step 4: Fix package_status_history.to_status constraint
ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check;
ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check1;

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

-- ==========================================
-- DONE! Now you can use 'envelope_prepared' status
-- ==========================================

