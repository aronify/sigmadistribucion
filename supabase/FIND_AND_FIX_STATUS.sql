-- ==========================================
-- FIND AND FIX: Automatically find tables and fix constraints
-- ==========================================
-- This script will find your package tables first, then fix them
-- ==========================================

-- Step 1: Find all tables that might be the packages table
SELECT 
    'FOUND TABLES:' as step,
    table_schema,
    table_name,
    'Use this table name in the fix below' as note
FROM information_schema.tables
WHERE table_name ILIKE '%package%'
   OR table_name ILIKE '%parcel%'
   OR table_name ILIKE '%shipment%'
ORDER BY table_schema, table_name;

-- Step 2: Find the actual table name and fix it dynamically
DO $$
DECLARE
    packages_table_name TEXT;
    history_table_name TEXT;
    constraint_name_var TEXT;
BEGIN
    -- Find packages table
    SELECT table_name INTO packages_table_name
    FROM information_schema.tables
    WHERE table_name ILIKE '%package%'
      AND table_schema = 'public'
    ORDER BY 
        CASE 
            WHEN table_name = 'packages' THEN 1
            WHEN table_name LIKE 'package%' THEN 2
            ELSE 3
        END
    LIMIT 1;
    
    -- Find package_status_history table
    SELECT table_name INTO history_table_name
    FROM information_schema.tables
    WHERE table_name ILIKE '%package%status%history%'
      AND table_schema = 'public'
    LIMIT 1;
    
    -- If not found, try without schema restriction
    IF packages_table_name IS NULL THEN
        SELECT table_name INTO packages_table_name
        FROM information_schema.tables
        WHERE table_name ILIKE '%package%'
        ORDER BY 
            CASE 
                WHEN table_name = 'packages' THEN 1
                WHEN table_name LIKE 'package%' THEN 2
                ELSE 3
            END
        LIMIT 1;
    END IF;
    
    IF history_table_name IS NULL THEN
        SELECT table_name INTO history_table_name
        FROM information_schema.tables
        WHERE table_name ILIKE '%package%status%history%'
        LIMIT 1;
    END IF;
    
    RAISE NOTICE 'Found packages table: %', COALESCE(packages_table_name, 'NOT FOUND');
    RAISE NOTICE 'Found history table: %', COALESCE(history_table_name, 'NOT FOUND');
    
    -- Fix packages table if found
    IF packages_table_name IS NOT NULL THEN
        -- Drop all status-related constraints
        FOR constraint_name_var IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = (packages_table_name)::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status%'
        LOOP
            BEGIN
                EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', 
                    packages_table_name, 
                    constraint_name_var);
                RAISE NOTICE 'Dropped constraint: % from %', constraint_name_var, packages_table_name;
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping %: %', constraint_name_var, SQLERRM;
            END;
        END LOOP;
        
        -- Add new constraint
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS packages_status_check', packages_table_name);
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT packages_status_check CHECK (status IN (''just_created'', ''created'', ''envelope_prepared'', ''queued_for_print'', ''printed'', ''handed_over'', ''in_transit'', ''at_branch'', ''delivered'', ''returned'', ''canceled''))', 
                packages_table_name);
            RAISE NOTICE 'SUCCESS: Added packages_status_check to %', packages_table_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Error adding constraint to %: %', packages_table_name, SQLERRM;
        END;
    END IF;
    
    -- Fix package_status_history table if found
    IF history_table_name IS NOT NULL THEN
        -- Drop from_status constraints
        FOR constraint_name_var IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = (history_table_name)::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%from_status%'
        LOOP
            BEGIN
                EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', 
                    history_table_name, 
                    constraint_name_var);
                RAISE NOTICE 'Dropped constraint: % from %', constraint_name_var, history_table_name;
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping %: %', constraint_name_var, SQLERRM;
            END;
        END LOOP;
        
        -- Drop to_status constraints
        FOR constraint_name_var IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = (history_table_name)::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%to_status%'
        LOOP
            BEGIN
                EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', 
                    history_table_name, 
                    constraint_name_var);
                RAISE NOTICE 'Dropped constraint: % from %', constraint_name_var, history_table_name;
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping %: %', constraint_name_var, SQLERRM;
            END;
        END LOOP;
        
        -- Add new from_status constraint
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS package_status_history_from_status_check', history_table_name);
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT package_status_history_from_status_check CHECK (from_status IS NULL OR from_status IN (''just_created'', ''created'', ''envelope_prepared'', ''queued_for_print'', ''printed'', ''handed_over'', ''in_transit'', ''at_branch'', ''delivered'', ''returned'', ''canceled''))', 
                history_table_name);
            RAISE NOTICE 'SUCCESS: Added from_status constraint to %', history_table_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Error adding from_status constraint: %', SQLERRM;
        END;
        
        -- Add new to_status constraint
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS package_status_history_to_status_check', history_table_name);
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT package_status_history_to_status_check CHECK (to_status IN (''just_created'', ''created'', ''envelope_prepared'', ''queued_for_print'', ''printed'', ''handed_over'', ''in_transit'', ''at_branch'', ''delivered'', ''returned'', ''canceled''))', 
                history_table_name);
            RAISE NOTICE 'SUCCESS: Added to_status constraint to %', history_table_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Error adding to_status constraint: %', SQLERRM;
        END;
    END IF;
    
    IF packages_table_name IS NULL THEN
        RAISE EXCEPTION 'Could not find packages table! Please check the table name in your database.';
    END IF;
END $$;

-- Step 3: Verify the fix worked
SELECT 
    'VERIFICATION:' as step,
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(c.oid) as constraint_definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c ON tc.constraint_name = c.conname
WHERE (tc.table_name ILIKE '%package%')
    AND tc.constraint_type = 'CHECK'
    AND (pg_get_constraintdef(c.oid) LIKE '%status%')
ORDER BY tc.table_name, tc.constraint_name;

-- ==========================================
-- DONE! Check the output above
-- ==========================================

