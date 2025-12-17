-- ==========================================
-- SIMPLE TABLE FINDER: Find your packages table
-- ==========================================
-- This uses pg_catalog which is more reliable
-- ==========================================

-- Find ALL tables in public schema
SELECT 
    'TABLES IN PUBLIC SCHEMA:' as info,
    schemaname as schema_name,
    tablename as table_name
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Find tables that might be packages (case-insensitive)
SELECT 
    'PACKAGE-RELATED TABLES:' as info,
    schemaname as schema_name,
    tablename as table_name
FROM pg_tables
WHERE tablename ILIKE '%package%'
   OR tablename ILIKE '%parcel%'
   OR tablename ILIKE '%shipment%'
ORDER BY schemaname, tablename;

-- Find columns in tables (to identify packages table by its columns)
SELECT 
    'TABLES WITH STATUS COLUMN:' as info,
    table_schema,
    table_name,
    column_name
FROM information_schema.columns
WHERE column_name = 'status'
ORDER BY table_schema, table_name;

-- Find tables with short_code column (definitely packages)
SELECT 
    'TABLES WITH SHORT_CODE (THIS IS PACKAGES!):' as info,
    table_schema,
    table_name
FROM information_schema.columns
WHERE column_name = 'short_code'
ORDER BY table_schema, table_name;

-- ==========================================
-- Share the output, especially the last query
-- ==========================================

