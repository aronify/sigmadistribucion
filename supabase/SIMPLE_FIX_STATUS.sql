-- ==========================================
-- SIMPLE FIX: Check what exists, then fix it
-- ==========================================
-- Run this step by step
-- ==========================================

-- STEP 1: First, let's see what tables exist
SELECT 
    'STEP 1 - Finding tables:' as info,
    table_schema,
    table_name
FROM information_schema.tables
WHERE table_name IN ('packages', 'package_status_history')
   OR table_name ILIKE '%package%'
ORDER BY table_schema, table_name;

-- STEP 2: If you see tables above, note the schema (usually 'public')
-- Then run this to see current constraints:
SELECT 
    'STEP 2 - Current constraints:' as info,
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(c.oid) as definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c ON tc.constraint_name = c.conname
WHERE (tc.table_name = 'packages' OR tc.table_name = 'package_status_history')
    AND tc.constraint_type = 'CHECK'
    AND pg_get_constraintdef(c.oid) LIKE '%status%'
ORDER BY tc.table_name;

-- STEP 3: Drop old constraints (adjust schema if needed - replace 'public' with your schema)
ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS packages_status_check1;
ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS packages_status_check2;

ALTER TABLE public.package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check;
ALTER TABLE public.package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check1;
ALTER TABLE public.package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check;
ALTER TABLE public.package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check1;

-- STEP 4: Add new constraints with envelope_prepared
ALTER TABLE public.packages 
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

ALTER TABLE public.package_status_history 
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

ALTER TABLE public.package_status_history 
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

-- STEP 5: Verify it worked
SELECT 
    'STEP 5 - Verification:' as info,
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(c.oid) as definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c ON tc.constraint_name = c.conname
WHERE (tc.table_name = 'packages' OR tc.table_name = 'package_status_history')
    AND tc.constraint_type = 'CHECK'
    AND pg_get_constraintdef(c.oid) LIKE '%status%'
ORDER BY tc.table_name;

-- ==========================================
-- If STEP 1 shows tables in a different schema, 
-- replace 'public' with your schema name in STEPS 3-4
-- ==========================================

