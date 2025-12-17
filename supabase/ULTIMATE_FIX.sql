-- ==========================================
-- ULTIMATE FIX: Works with any schema/table name
-- ==========================================
-- This will find and fix your tables automatically
-- ==========================================

DO $$
DECLARE
    packages_table_schema TEXT;
    packages_table_name TEXT;
    history_table_schema TEXT;
    history_table_name TEXT;
    constraint_rec RECORD;
BEGIN
    -- Find packages table by looking for short_code column
    SELECT table_schema, table_name 
    INTO packages_table_schema, packages_table_name
    FROM information_schema.columns
    WHERE column_name = 'short_code'
    LIMIT 1;
    
    -- Find package_status_history table by looking for package_id column
    SELECT table_schema, table_name 
    INTO history_table_schema, history_table_name
    FROM information_schema.columns
    WHERE column_name = 'package_id'
      AND table_name ILIKE '%history%'
    LIMIT 1;
    
    RAISE NOTICE 'Found packages table: %.%', packages_table_schema, packages_table_name;
    RAISE NOTICE 'Found history table: %.%', history_table_schema, history_table_name;
    
    -- Fix packages table
    IF packages_table_name IS NOT NULL THEN
        -- Drop all status constraints
        FOR constraint_rec IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = (packages_table_schema || '.' || packages_table_name)::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status%'
        LOOP
            EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                packages_table_schema,
                packages_table_name,
                constraint_rec.conname);
            RAISE NOTICE 'Dropped constraint: %', constraint_rec.conname;
        END LOOP;
        
        -- Add new constraint
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT packages_status_check CHECK (status IN (''just_created'', ''created'', ''envelope_prepared'', ''queued_for_print'', ''printed'', ''handed_over'', ''in_transit'', ''at_branch'', ''delivered'', ''returned'', ''canceled''))',
            packages_table_schema,
            packages_table_name);
        RAISE NOTICE 'SUCCESS: Added constraint to packages table';
    END IF;
    
    -- Fix history table
    IF history_table_name IS NOT NULL THEN
        -- Drop from_status constraints
        FOR constraint_rec IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = (history_table_schema || '.' || history_table_name)::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%from_status%'
        LOOP
            EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                history_table_schema,
                history_table_name,
                constraint_rec.conname);
        END LOOP;
        
        -- Drop to_status constraints
        FOR constraint_rec IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = (history_table_schema || '.' || history_table_name)::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%to_status%'
        LOOP
            EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                history_table_schema,
                history_table_name,
                constraint_rec.conname);
        END LOOP;
        
        -- Add new constraints
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT package_status_history_from_status_check CHECK (from_status IS NULL OR from_status IN (''just_created'', ''created'', ''envelope_prepared'', ''queued_for_print'', ''printed'', ''handed_over'', ''in_transit'', ''at_branch'', ''delivered'', ''returned'', ''canceled''))',
            history_table_schema,
            history_table_name);
            
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT package_status_history_to_status_check CHECK (to_status IN (''just_created'', ''created'', ''envelope_prepared'', ''queued_for_print'', ''printed'', ''handed_over'', ''in_transit'', ''at_branch'', ''delivered'', ''returned'', ''canceled''))',
            history_table_schema,
            history_table_name);
            
        RAISE NOTICE 'SUCCESS: Added constraints to history table';
    END IF;
    
    IF packages_table_name IS NULL THEN
        RAISE EXCEPTION 'Could not find packages table! Make sure your database is set up correctly.';
    END IF;
END $$;

-- Verify it worked
SELECT 
    'VERIFICATION - New Constraints:' as info,
    n.nspname as schema_name,
    c.relname as table_name,
    con.conname as constraint_name,
    pg_get_constraintdef(con.oid) as definition
FROM pg_constraint con
JOIN pg_class c ON con.conrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE con.contype = 'c'
AND pg_get_constraintdef(con.oid) LIKE '%status%'
AND pg_get_constraintdef(con.oid) LIKE '%envelope_prepared%'
ORDER BY n.nspname, c.relname;

-- ==========================================
-- DONE! Check the output above
-- ==========================================

