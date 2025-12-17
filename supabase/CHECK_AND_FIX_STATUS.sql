-- ==========================================
-- DIAGNOSTIC & FIX: Check tables and fix status constraints
-- ==========================================
-- This script will:
-- 1. First check what tables exist
-- 2. Find the correct constraint names
-- 3. Update them with the new statuses
-- ==========================================

-- Step 1: Check what tables exist (for debugging)
SELECT 
    table_schema,
    table_name
FROM information_schema.tables
WHERE table_name LIKE '%package%'
ORDER BY table_schema, table_name;

-- Step 2: Find all CHECK constraints on status columns
SELECT 
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name LIKE '%package%'
    AND tc.constraint_type = 'CHECK'
    AND (cc.check_clause LIKE '%status%' OR cc.check_clause LIKE '%from_status%' OR cc.check_clause LIKE '%to_status%')
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name;

-- Step 3: Drop existing constraints (using schema-qualified names)
-- Try with public schema first
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Drop packages.status constraint
    FOR constraint_name_var IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.packages'::regclass 
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%status%'
    LOOP
        EXECUTE 'ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS ' || constraint_name_var;
        RAISE NOTICE 'Dropped constraint: %', constraint_name_var;
    END LOOP;
    
    -- Drop package_status_history constraints
    FOR constraint_name_var IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.package_status_history'::regclass 
        AND contype = 'c'
        AND (pg_get_constraintdef(oid) LIKE '%from_status%' OR pg_get_constraintdef(oid) LIKE '%to_status%')
    LOOP
        EXECUTE 'ALTER TABLE public.package_status_history DROP CONSTRAINT IF EXISTS ' || constraint_name_var;
        RAISE NOTICE 'Dropped constraint: %', constraint_name_var;
    END LOOP;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table does not exist, trying without schema prefix...';
END $$;

-- Step 4: Try without schema prefix (in case tables are in current schema)
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Drop packages.status constraint
    FOR constraint_name_var IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'packages'::regclass 
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%status%'
    LOOP
        EXECUTE 'ALTER TABLE packages DROP CONSTRAINT IF EXISTS ' || constraint_name_var;
        RAISE NOTICE 'Dropped constraint: %', constraint_name_var;
    END LOOP;
    
    -- Drop package_status_history constraints
    FOR constraint_name_var IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'package_status_history'::regclass 
        AND contype = 'c'
        AND (pg_get_constraintdef(oid) LIKE '%from_status%' OR pg_get_constraintdef(oid) LIKE '%to_status%')
    LOOP
        EXECUTE 'ALTER TABLE package_status_history DROP CONSTRAINT IF EXISTS ' || constraint_name_var;
        RAISE NOTICE 'Dropped constraint: %', constraint_name_var;
    END LOOP;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table does not exist';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
END $$;

-- Step 5: Add new constraints (only if tables exist)
DO $$
BEGIN
    -- Check if packages table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE (table_schema = 'public' AND table_name = 'packages')
           OR table_name = 'packages'
    ) THEN
        -- Add packages.status constraint
        BEGIN
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
            RAISE NOTICE 'Added packages.status constraint';
        EXCEPTION
            WHEN duplicate_object THEN
                RAISE NOTICE 'Constraint already exists, skipping...';
        END;
    ELSE
        RAISE NOTICE 'packages table does not exist';
    END IF;
    
    -- Check if package_status_history table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE (table_schema = 'public' AND table_name = 'package_status_history')
           OR table_name = 'package_status_history'
    ) THEN
        -- Add from_status constraint
        BEGIN
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
            RAISE NOTICE 'Added package_status_history.from_status constraint';
        EXCEPTION
            WHEN duplicate_object THEN
                RAISE NOTICE 'from_status constraint already exists, skipping...';
        END;
        
        -- Add to_status constraint
        BEGIN
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
            RAISE NOTICE 'Added package_status_history.to_status constraint';
        EXCEPTION
            WHEN duplicate_object THEN
                RAISE NOTICE 'to_status constraint already exists, skipping...';
        END;
    ELSE
        RAISE NOTICE 'package_status_history table does not exist';
    END IF;
END $$;

-- ==========================================
-- DONE! Check the output above to see what was found and fixed
-- ==========================================

