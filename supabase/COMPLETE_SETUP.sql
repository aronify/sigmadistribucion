-- ==========================================
-- COMPLETE DATABASE SETUP FOR SIGMA SHIP
-- ==========================================
-- Run this ONE file in Supabase SQL Editor
-- https://app.supabase.com/project/jnicuzhjusibfyomfuxf/sql
-- ==========================================

-- Step 1: Drop all existing tables if they exist
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS scans CASCADE;
DROP TABLE IF EXISTS package_status_history CASCADE;
DROP TABLE IF EXISTS packages CASCADE;
DROP TABLE IF EXISTS label_templates CASCADE;
DROP TABLE IF EXISTS inventory_movements CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Step 2: Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 3: Create Users  table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'standard')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Create other tables
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock_on_hand INTEGER NOT NULL DEFAULT 0,
  min_threshold INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_package_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE label_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_path TEXT NOT NULL,
  overlay_x INTEGER NOT NULL DEFAULT 0,
  overlay_y INTEGER NOT NULL DEFAULT 0,
  overlay_w INTEGER NOT NULL DEFAULT 100,
  symbology TEXT NOT NULL CHECK (symbology IN ('code128', 'qr')),
  dpi_hint INTEGER NOT NULL DEFAULT 300,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  short_code TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'Main Office',
  destination_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  contents_note TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 
    'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'
  )),
  current_location TEXT NOT NULL DEFAULT 'Main Office',
  symbology TEXT NOT NULL CHECK (symbology IN ('code128', 'qr')),
  encoded_payload TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE package_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  from_status TEXT CHECK (from_status IN (
    'just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 
    'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 
    'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'
  )),
  location TEXT NOT NULL,
  scanned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  note TEXT
);

CREATE TABLE scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  raw_data TEXT NOT NULL,
  symbology TEXT NOT NULL CHECK (symbology IN ('code128', 'qr')),
  location TEXT NOT NULL,
  scanned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  device_label TEXT NOT NULL
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  ip TEXT,
  ua TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 5: Create indexes
CREATE INDEX idx_packages_short_code ON packages(short_code);
CREATE INDEX idx_packages_status ON packages(status);
CREATE INDEX idx_packages_created_at ON packages(created_at);
CREATE INDEX idx_scans_package_id ON scans(package_id);
CREATE INDEX idx_scans_scanned_at ON scans(scanned_at);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_inventory_movements_item_id ON inventory_movements(item_id);
CREATE INDEX idx_inventory_movements_created_at ON inventory_movements(created_at);

-- Step 6: Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Step 7: Create basic RLS policies (allow all for now)
CREATE POLICY "Allow all operations on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on branches" ON branches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on inventory_items" ON inventory_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on inventory_movements" ON inventory_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on packages" ON packages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on package_status_history" ON package_status_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on scans" ON scans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on audit_log" ON audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on label_templates" ON label_templates FOR ALL USING (true) WITH CHECK (true);

-- Step 8: Insert seed data (only if not exists)
INSERT INTO users (name, pin_hash, role, active)
SELECT * FROM (VALUES
  ('Admin User', '123456', 'admin', true),
  ('Manager Admin', '654321', 'admin', true),
  ('John Smith', '111111', 'standard', true),
  ('Jane Doe', '222222', 'standard', true),
  ('Mike Johnson', '333333', 'standard', true)
) AS v(name, pin_hash, role, active)
WHERE NOT EXISTS (SELECT 1 FROM users WHERE pin_hash = v.pin_hash);

INSERT INTO branches (code, name, address)
SELECT * FROM (VALUES
  ('MAIN', 'Main Office', '123 Main Street, City, State 12345'),
  ('BRANCH1', 'Downtown Branch', '456 Downtown Ave, City, State 12345'),
  ('BRANCH2', 'Uptown Branch', '789 Uptown Blvd, City, State 12345')
) AS v(code, name, address)
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE code = v.code);

INSERT INTO inventory_items (sku, name, unit, stock_on_hand, min_threshold, active)
SELECT * FROM (VALUES
  ('BAG001', 'Small Shipping Bag', 'each', 150, 20, true),
  ('ENV002', 'Large Envelope', 'each', 75, 15, true),
  ('BOX003', 'Medium Box', 'each', 30, 5, true),
  ('TAG004', 'Shipping Tag', 'each', 200, 50, true)
) AS v(sku, name, unit, stock_on_hand, min_threshold, active)
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE sku = v.sku);

-- Done!
-- Success message
SELECT 'Database setup complete! Users, branches, and products are ready.' AS message;

