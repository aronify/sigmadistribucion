-- ==========================================
-- DIAGNOSTIC: Check what actually exists
-- ==========================================
-- Run this to see what's in your database
-- ==========================================

-- Check current database and schema
SELECT 
    'CURRENT DATABASE:' as info,
    current_database() as database_name,
    current_schema() as current_schema;

-- List ALL schemas
SELECT 
    'ALL SCHEMAS:' as info,
    nspname as schema_name
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema', 'pg_temp_1', 'pg_toast_temp_1')
ORDER BY nspname;

-- List ALL tables in ALL schemas
SELECT 
    'ALL TABLES:' as info,
    schemaname as schema_name,
    tablename as table_name
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY schemaname, tablename;

-- Check if you have access to information_schema
SELECT 
    'TESTING ACCESS:' as info,
    COUNT(*) as table_count
FROM information_schema.tables
WHERE table_schema = 'public';

-- Try to find ANY table with a status column
SELECT DISTINCT
    'TABLES WITH STATUS COLUMN:' as info,
    table_schema,
    table_name
FROM information_schema.columns
WHERE column_name = 'status'
ORDER BY table_schema, table_name;

-- Try to find ANY table with short_code column
SELECT DISTINCT
    'TABLES WITH SHORT_CODE COLUMN:' as info,
    table_schema,
    table_name
FROM information_schema.columns
WHERE column_name = 'short_code'
ORDER BY table_schema, table_name;

-- ==========================================
-- IMPORTANT: 
-- 1. Are you running this in the SAME Supabase project that your app uses?
-- 2. Check your .env file or Supabase config - what's the project URL?
-- 3. Share the output of "ALL TABLES" query above
-- ==========================================

