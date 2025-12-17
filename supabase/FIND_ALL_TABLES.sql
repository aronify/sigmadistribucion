-- ==========================================
-- FIND ALL TABLES: Discover your actual table names
-- ==========================================
-- Run this FIRST to see what tables you actually have
-- ==========================================

-- Find ALL tables in ALL schemas
SELECT 
    'ALL TABLES:' as info,
    table_schema,
    table_name,
    'Check this table' as note
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY table_schema, table_name;

-- Find tables that might be packages (case-insensitive search)
SELECT 
    'PACKAGE-RELATED TABLES:' as info,
    table_schema,
    table_name,
    'This might be your packages table' as note
FROM information_schema.tables
WHERE table_name ILIKE '%package%'
   OR table_name ILIKE '%parcel%'
   OR table_name ILIKE '%shipment%'
   OR table_name ILIKE '%delivery%'
ORDER BY table_schema, table_name;

-- Find tables with a 'status' column (likely the packages table)
SELECT 
    'TABLES WITH STATUS COLUMN:' as info,
    tc.table_schema,
    tc.table_name,
    'Has a status column - likely packages table' as note
FROM information_schema.table_columns tc
WHERE tc.column_name = 'status'
ORDER BY tc.table_schema, tc.table_name;

-- Find tables with a 'short_code' column (definitely packages table)
SELECT 
    'TABLES WITH SHORT_CODE COLUMN:' as info,
    tc.table_schema,
    tc.table_name,
    'Has short_code - THIS IS YOUR PACKAGES TABLE!' as note
FROM information_schema.table_columns tc
WHERE tc.column_name = 'short_code'
ORDER BY tc.table_schema, tc.table_name;

-- ==========================================
-- After running this, tell me:
-- 1. What schema is your packages table in?
-- 2. What is the exact table name?
-- Then I'll create the exact fix for your setup
-- ==========================================

