-- ==========================================
-- AGGRESSIVE FIX: Force update all status constraints
-- ==========================================
-- This will find and drop ALL status-related constraints, then recreate them
-- ==========================================

-- Step 1: Find and show ALL status constraints (for debugging)
SELECT 
    'Current Constraints:' as info,
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(c.oid) as constraint_definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c ON tc.constraint_name = c.conname
WHERE (tc.table_name = 'packages' OR tc.table_name = 'package_status_history')
    AND tc.constraint_type = 'CHECK'
    AND (pg_get_constraintdef(c.oid) LIKE '%status%')
ORDER BY tc.table_name, tc.constraint_name;

-- Step 2: Drop ALL status-related constraints from packages table
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    -- Find and drop all CHECK constraints on packages.status
    FOR constraint_record IN
        SELECT conname, conrelid::regclass::text as table_name
        FROM pg_constraint
        WHERE conrelid = 'packages'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%status%'
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', 
                constraint_record.table_name, 
                constraint_record.conname);
            RAISE NOTICE 'Dropped constraint: % from table: %', 
                constraint_record.conname, 
                constraint_record.table_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Could not drop constraint %: %', 
                    constraint_record.conname, 
                    SQLERRM;
        END;
    END LOOP;
END $$;

-- Step 3: Drop ALL status-related constraints from package_status_history table
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    -- Find and drop all CHECK constraints on package_status_history
    FOR constraint_record IN
        SELECT conname, conrelid::regclass::text as table_name
        FROM pg_constraint
        WHERE conrelid = 'package_status_history'::regclass
        AND contype = 'c'
        AND (pg_get_constraintdef(oid) LIKE '%status%' 
             OR pg_get_constraintdef(oid) LIKE '%from_status%' 
             OR pg_get_constraintdef(oid) LIKE '%to_status%')
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', 
                constraint_record.table_name, 
                constraint_record.conname);
            RAISE NOTICE 'Dropped constraint: % from table: %', 
                constraint_record.conname, 
                constraint_record.table_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Could not drop constraint %: %', 
                    constraint_record.conname, 
                    SQLERRM;
        END;
    END LOOP;
END $$;

-- Step 4: Wait a moment for constraints to be fully dropped
SELECT pg_sleep(0.5);

-- Step 5: Add NEW constraint to packages.status (with all statuses)
DO $$
BEGIN
    -- Drop any remaining constraint with the name we want to use
    ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
    
    -- Add the new constraint
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
    
    RAISE NOTICE 'SUCCESS: Added packages_status_check constraint';
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint packages_status_check already exists';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error adding packages_status_check: %', SQLERRM;
END $$;

-- Step 6: Add NEW constraint to package_status_history.from_status
DO $$
BEGIN
    ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_from_status_check;
    
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
    
    RAISE NOTICE 'SUCCESS: Added package_status_history_from_status_check constraint';
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint package_status_history_from_status_check already exists';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error adding from_status constraint: %', SQLERRM;
END $$;

-- Step 7: Add NEW constraint to package_status_history.to_status
DO $$
BEGIN
    ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS package_status_history_to_status_check;
    
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
    
    RAISE NOTICE 'SUCCESS: Added package_status_history_to_status_check constraint';
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint package_status_history_to_status_check already exists';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error adding to_status constraint: %', SQLERRM;
END $$;

-- Step 8: Verify the new constraints
SELECT 
    'VERIFICATION - New Constraints:' as info,
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(c.oid) as constraint_definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c ON tc.constraint_name = c.conname
WHERE (tc.table_name = 'packages' OR tc.table_name = 'package_status_history')
    AND tc.constraint_type = 'CHECK'
    AND (pg_get_constraintdef(c.oid) LIKE '%status%')
ORDER BY tc.table_name, tc.constraint_name;

-- ==========================================
-- DONE! Check the output above
-- The constraint should now include 'envelope_prepared'
-- ==========================================

