// Re-export from supabaseClient.ts to ensure single source of truth
export { supabase, getSupabaseClient, getLogoUrl } from './supabaseClient'

export interface User {
  id: string
  name: string
  pin_hash: string
  role: 'admin' | 'standard'
  active: boolean
  created_at: string
}

export interface Session {
  id: string
  user_id: string
  created_at: string
  ended_at?: string
}

export interface Package {
  id: string
  short_code: string
  created_by: string
  origin: string
  destination_branch_id: string
  contents_note: string
  status: PackageStatus
  current_location: string
  symbology: 'code128' | 'qr'
  encoded_payload: string
  created_at: string
}

export type PackageStatus = 
  | 'created'
  | 'queued_for_print'
  | 'printed'
  | 'handed_over'
  | 'in_transit'
  | 'at_branch'
  | 'delivered'
  | 'returned'
  | 'canceled'

export interface PackageStatusHistory {
  id: string
  package_id: string
  from_status: PackageStatus | null
  to_status: PackageStatus
  location: string
  scanned_by: string
  scanned_at: string
  note?: string
}

export interface Scan {
  id: string
  package_id: string
  raw_data: string
  symbology: 'code128' | 'qr'
  location: string
  scanned_by: string
  scanned_at: string
  device_label: string
}

export interface InventoryItem {
  id: string
  sku: string
  name: string
  unit: string
  stock_on_hand: number
  min_threshold: number
  active: boolean
}

export interface InventoryMovement {
  id: string
  item_id: string
  delta: number
  reason: string
  ref_package_id?: string
  user_id: string
  created_at: string
}

export interface Branch {
  id: string
  code: string
  name: string
  address: string
}

export interface LabelTemplate {
  id: string
  file_path: string
  overlay_x: number
  overlay_y: number
  overlay_w: number
  symbology: 'code128' | 'qr'
  dpi_hint: number
  active: boolean
  updated_by: string
  updated_at: string
}

export interface AuditLog {
  id: string
  user_id: string
  entity: string
  entity_id: string
  action: string
  before_json: any
  after_json: any
  ip: string
  ua: string
  created_at: string
}
