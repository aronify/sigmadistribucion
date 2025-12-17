import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { useAuth } from './lib/auth'
import { supabase, getLogoUrl } from './lib/supabase'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { BarcodeScanner } from './components/BarcodeScanner'
import { PackageTracking } from './components/PackageTracking'
import LanguageSwitcher from './components/LanguageSwitcher'
import { PinLogin } from './components/auth/PinLogin'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

// Import utilities
import { loadLogoAsBase64, preloadLogo } from './utils/logo'
import { generateQRCode } from './utils/qrCode'
import { parseContentsNote, formatContentsNote } from './utils/packageParsing'
import { labelPrintStyles } from './styles/labelPrintStyles'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// Get Supabase URL and key for environment check
// @ts-ignore - Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
// @ts-ignore - Vite environment variables
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// PinLogin is now imported from components/auth/PinLogin.tsx

// Create Label Modal with proper fields
function CreateLabelModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [step, setStep] = useState(1)
  const [inventoryItems, setInventoryItems] = useState<any[]>([])
  const [importMode, setImportMode] = useState(false) // Toggle between manual and import mode
  const [isBulkImporting, setIsBulkImporting] = useState(false)
  const [bulkImportProgress, setBulkImportProgress] = useState({ current: 0, total: 0 })
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    company: '',
    address: '',
    items: [] as Array<{ productId: string; product: string; quantity: number }>,
  })
  const [createdPackage, setCreatedPackage] = useState<any>(null)
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadInventoryItems()
  }, [])

  // Preload logo when package is created
  useEffect(() => {
    if (createdPackage && printRef.current) {
      const loadLogo = async () => {
        const logoBase64 = await loadLogoAsBase64()
        const logoImg = printRef.current?.querySelector('#label-logo-img') as HTMLImageElement || 
                       printRef.current?.querySelector('.logo') as HTMLImageElement
        if (logoImg) {
          if (logoBase64) {
            logoImg.src = logoBase64
          } else {
            logoImg.src = getLogoUrl()
          }
          logoImg.style.display = 'block'
          logoImg.style.visibility = 'visible'
          logoImg.style.opacity = '1'
        }
      }
      loadLogo()
    }
  }, [createdPackage])

  const loadInventoryItems = async () => {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('active', true)
        .order('name')
      
      if (error) throw error
      setInventoryItems(data || [])
    } catch (error) {
      console.error('Failed to load inventory items:', error)
    }
  }

  const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      // Read Excel file
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as string[][]

      if (jsonData.length < 2) {
        toast.error('Excel file must have at least a header row and one data row')
        return
      }

      // Get header row (first row)
      const headers = jsonData[0].map((h: string) => String(h).trim().toLowerCase())
      
      // Find column indices (all optional except Products should exist for creating packages)
      const beneficiaryIdx = headers.findIndex(h => h.includes('beneficiary'))
      const companyIdx = headers.findIndex(h => h.includes('company'))
      const addressIdx = headers.findIndex(h => h.includes('address'))
      const productsIdx = headers.findIndex(h => h.includes('product'))
      const notesIdx = headers.findIndex(h => h.includes('note'))

      if (productsIdx === -1) {
        toast.error('Excel file must have a Products column')
        return
      }

      // Process ALL data rows (skip header row)
      const dataRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== ''))
      
      if (dataRows.length === 0) {
        toast.error('No data rows found in Excel file')
        return
      }

      // Start bulk import
      setIsBulkImporting(true)
      setBulkImportProgress({ current: 0, total: dataRows.length })

      // Get user and branch info
      if (!user) {
        toast.error('You must be logged in to create packages')
        setIsBulkImporting(false)
        return
      }

      const userId = user.id

      // Get first branch from database
      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (branchError || !branchData) {
        toast.error('Error: No branches found. Please set up branches in the database.')
        setIsBulkImporting(false)
        return
      }

      const branchId = branchData.id
      let successCount = 0
      let errorCount = 0
      const errors: string[] = []

      // Process rows in batches to avoid overwhelming the system
      const BATCH_SIZE = 50
      for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
        const batch = dataRows.slice(i, i + BATCH_SIZE)
        const packageInserts: any[] = []
        const inventoryUpdates: Array<{ itemId: string; delta: number; item: any }> = []
        const inventoryMovements: any[] = []
        // Track running totals of allocated stock per item in this batch
        const allocatedStock = new Map<string, number>()

        // Process each row in the batch
        for (let rowIdx = 0; rowIdx < batch.length; rowIdx++) {
          const row = batch[rowIdx]
          const rowNum = i + rowIdx + 2 // +2 because we start from row 2 (after header)
          
          try {
            const beneficiary = beneficiaryIdx >= 0 ? String(row[beneficiaryIdx] || '').trim() : ''
            const company = companyIdx >= 0 ? String(row[companyIdx] || '').trim() : ''
            const address = addressIdx >= 0 ? String(row[addressIdx] || '').trim() : ''
            const productsStr = String(row[productsIdx] || '').trim()
            const notes = notesIdx >= 0 ? String(row[notesIdx] || '').trim() : ''

            // Skip rows with no products
            if (!productsStr) {
              continue
            }

            // Split beneficiary into name and surname (optional)
            const beneficiaryParts = beneficiary.split(/\s+/).filter(Boolean)
            const name = beneficiaryParts[0] || ''
            const surname = beneficiaryParts.slice(1).join(' ') || ''

            // Parse products (SKUs separated by semicolons)
            const skus = productsStr
              .split(';')
              .map(sku => sku.trim())
              .filter(Boolean)

            if (skus.length === 0) {
              continue
            }

            // Look up products by SKU (case-insensitive)
            const importedItems: Array<{ productId: string; product: string; quantity: number }> = []
            const skuCounts: { [normalizedSku: string]: { count: number; original: string } } = {}

            // Count SKUs
            for (const sku of skus) {
              const normalizedSku = sku.toLowerCase()
              if (skuCounts[normalizedSku]) {
                skuCounts[normalizedSku].count += 1
              } else {
                skuCounts[normalizedSku] = { count: 1, original: sku }
              }
            }

            // Find products in inventory
            for (const [normalizedSku, { count: quantity, original }] of Object.entries(skuCounts)) {
              const product = inventoryItems.find(
                item => item.sku.toLowerCase() === normalizedSku
              )
              
              if (product) {
                importedItems.push({
                  productId: product.id,
                  product: product.name,
                  quantity: quantity
                })
              }
            }

            if (importedItems.length === 0) {
              errors.push(`Row ${rowNum}: No valid products found`)
              errorCount++
              continue
            }

            // Validate stock availability before creating package
            let hasInsufficientStock = false
            const stockIssues: string[] = []
            for (const product of importedItems) {
              const item = inventoryItems.find(i => i.id === product.productId)
              if (item) {
                // Check if we have enough stock (considering all packages already processed in this batch)
                const currentStock = item.stock_on_hand
                const alreadyAllocated = allocatedStock.get(item.id) || 0
                const totalNeeded = alreadyAllocated + product.quantity
                
                if (currentStock < totalNeeded) {
                  hasInsufficientStock = true
                  stockIssues.push(`${item.name}: need ${totalNeeded}, have ${currentStock}`)
                }
              }
            }

            if (hasInsufficientStock) {
              errors.push(`Row ${rowNum}: Insufficient stock - ${stockIssues.join('; ')}`)
              errorCount++
              continue
            }

            // Update allocated stock tracking for this package
            for (const product of importedItems) {
              const currentAllocated = allocatedStock.get(product.productId) || 0
              allocatedStock.set(product.productId, currentAllocated + product.quantity)
            }

            // Generate short code and package ID
            const shortCode = Math.random().toString(36).substr(2, 6).toUpperCase()
            const packageId = crypto.randomUUID()
            const encodedPayload = JSON.stringify({ pkg: packageId, rev: 1 })

            // Build recipient info (all optional)
            const recipientInfo = [
              name && surname ? `${name} ${surname}` : name || surname || '',
              company
            ].filter(Boolean).join(' | ')

            const contentsNote = [
              recipientInfo ? `To: ${recipientInfo}` : '',
              address || '',
              `Items: ${importedItems.map(i => `${i.product} x${i.quantity}`).join(', ')}`
            ].filter(Boolean).join('\n')

            // Prepare package insert
            packageInserts.push({
              short_code: shortCode,
              created_by: userId,
              origin: 'Main Office',
              destination_branch_id: branchId,
              contents_note: contentsNote,
              notes: notes || null, // Use notes column
              status: 'created',
              current_location: 'Main Office',
              symbology: 'code128',
              encoded_payload: encodedPayload,
              _tempId: packageId, // Temporary ID to link movements
              _items: importedItems // Store items for later processing
            })

            // Track inventory updates per package
            for (const product of importedItems) {
              const item = inventoryItems.find(i => i.id === product.productId)
              if (item) {
                inventoryUpdates.push({ itemId: item.id, delta: -product.quantity, item })
              }
            }
          } catch (err) {
            errors.push(`Row ${rowNum}: ${(err as Error).message}`)
            errorCount++
          }
        }

        // Batch insert packages
        if (packageInserts.length > 0) {
          // Remove temporary fields before insert
          const packagesToInsert = packageInserts.map(({ _tempId, _items, ...pkg }) => pkg)
          const { data: createdPackages, error: packageError } = await supabase
            .from('packages')
            .insert(packagesToInsert)
            .select()

          if (packageError) {
            errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${packageError.message}`)
            errorCount += packageInserts.length
          } else if (createdPackages) {
            successCount += createdPackages.length

            // CRITICAL: Deduct stock for all successfully created packages
            // Build a map of items to deduct based on ACTUALLY CREATED packages only
            const stockDeductions = new Map<string, number>()
            const movementsToInsert: any[] = []
            
            for (let pkgIdx = 0; pkgIdx < createdPackages.length; pkgIdx++) {
              const pkg = createdPackages[pkgIdx]
              const originalPkg = packageInserts[pkgIdx]
              const shortCode = pkg.short_code
              
              // Process each item in this successfully created package
              for (const product of originalPkg._items || []) {
                const itemId = product.productId
                const quantity = product.quantity
                
                // Track stock deduction
                const currentDeduction = stockDeductions.get(itemId) || 0
                stockDeductions.set(itemId, currentDeduction + quantity)
                
                // Create inventory movement record
                  movementsToInsert.push({
                  item_id: itemId,
                  delta: -quantity, // Negative for deduction
                  reason: `Package ${shortCode} created via Excel import`,
                    ref_package_id: pkg.id,
                    user_id: userId
                  })
              }
            }

            // Batch insert inventory movements (for audit trail)
            if (movementsToInsert.length > 0) {
              const { error: movementError } = await supabase
                .from('inventory_movements')
                .insert(movementsToInsert)
              
              if (movementError) {
                console.error('Error creating inventory movements:', movementError)
                errors.push(`Warning: Failed to record inventory movements: ${movementError.message}`)
                // Continue anyway - stock update is more important
              }
            }

            // CRITICAL: Update stock for all items that were used
            if (stockDeductions.size > 0) {
              const itemIdsToUpdate = Array.from(stockDeductions.keys())
              
              // Fetch CURRENT stock levels from database (not from stale state)
              const { data: currentItems, error: fetchError } = await supabase
                .from('inventory_items')
                .select('id, stock_on_hand, name, sku')
                .in('id', itemIdsToUpdate)

              if (fetchError) {
                console.error('❌ CRITICAL: Error fetching current stock levels:', fetchError)
                errors.push(`CRITICAL: Error fetching stock levels: ${fetchError.message}`)
                toast.error(`Failed to fetch stock levels. Stock may not be updated correctly!`)
              } else if (currentItems && currentItems.length > 0) {
                // Update stock for each item
                const updatePromises = currentItems.map(async (item) => {
                  const deduction = stockDeductions.get(item.id) || 0
                  if (deduction > 0) {
                    const newStock = item.stock_on_hand - deduction
                    const finalStock = Math.max(0, newStock) // Prevent negative stock
                    
                    const { error: updateError } = await supabase
                      .from('inventory_items')
                      .update({ stock_on_hand: finalStock })
                      .eq('id', item.id)

                    if (updateError) {
                      console.error(`❌ Error updating stock for ${item.name} (${item.sku}):`, updateError)
                      errors.push(`Failed to update stock for ${item.name}: ${updateError.message}`)
                      return false
              } else {
                      console.log(`✅ Stock updated: ${item.name} (${item.sku}) - Deducted ${deduction}, New stock: ${finalStock}`)
                      return true
                    }
                  }
                  return true
                })

                // Wait for all stock updates to complete
                const updateResults = await Promise.all(updatePromises)
                const successCount = updateResults.filter(r => r).length
                const failCount = updateResults.filter(r => !r).length
                
                if (failCount > 0) {
                  console.error(`❌ Failed to update stock for ${failCount} item(s)`)
                  toast.error(`Warning: Failed to update stock for ${failCount} item(s). Check errors.`)
                } else {
                  console.log(`✅ Successfully updated stock for ${successCount} item(s)`)
                }
              } else {
                console.error('❌ No items found when fetching stock levels')
                errors.push('CRITICAL: No items found when updating stock')
              }
            } else {
              console.warn('⚠️ No stock deductions to process (no items in packages?)')
            }
          }
        }

        // Update progress
        setBulkImportProgress({ current: Math.min(i + BATCH_SIZE, dataRows.length), total: dataRows.length })
      }

      // Refresh inventory data to reflect stock changes
      await loadInventoryItems()
      window.dispatchEvent(new Event('inventory-updated'))

      setIsBulkImporting(false)
      
      // Show results with stock update confirmation
      if (successCount > 0) {
        toast.success(
          `✅ Successfully created ${successCount} package(s)! Stock has been deducted for all items.`, 
          { duration: 6000 }
        )
        console.log(`✅ Excel Import Complete: ${successCount} packages created, stock deducted`)
      }
      if (errorCount > 0) {
        toast.error(`Failed to create ${errorCount} package(s). Check console for details.`, { duration: 5000 })
        console.error('Import errors:', errors)
      }
      if (errors.length > 0 && errors.length <= 10) {
        errors.forEach(err => console.error(err))
      }
      
      // Log summary to console for debugging
      console.log('📊 Import Summary:', {
        totalRows: dataRows.length,
        successCount,
        errorCount,
        stockUpdated: successCount > 0 ? 'Yes - Stock deducted for all created packages' : 'No packages created'
      })

      // Reset file input and close modal
      event.target.value = ''
      if (successCount > 0) {
        setTimeout(() => onClose(), 2000)
      }
    } catch (error) {
      console.error('Error importing Excel file:', error)
      toast.error('Failed to import Excel file: ' + (error as Error).message)
      setIsBulkImporting(false)
    }
  }

  const handleNext = () => {
    // All fields are now optional, allow proceeding through steps
    // Bulk import handles everything directly, so this is mainly for manual entry
    setStep(step + 1)
  }

  const handleProductSelect = (item: any) => {
    const existing = formData.items.find(i => i.productId === item.id)
    if (existing) {
      setFormData({
        ...formData,
        items: formData.items.map(i =>
          i.productId === item.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      })
    } else {
      setFormData({
        ...formData,
        items: [...formData.items, {
          productId: item.id,
          product: item.name,
          quantity: 1
        }]
      })
    }
  }

  const handleProductQuantityChange = (productId: string, delta: number) => {
    setFormData({
      ...formData,
      items: formData.items.map(item => {
        if (item.productId === productId) {
          const newQuantity = item.quantity + delta
          if (newQuantity <= 0) return null as any
          return { ...item, quantity: newQuantity }
        }
        return item
      }).filter(Boolean)
    })
  }

  const handleProductRemove = (productId: string) => {
    setFormData({
      ...formData,
      items: formData.items.filter(i => i.productId !== productId)
    })
  }

  const generateBarcodeForPackage = async (pkg: any) => {
    try {
      const dataUrl = await generateQRCode(pkg.short_code)
      if (dataUrl) {
      setBarcodeDataUrl(dataUrl)
        console.log('QR code generated with tracking URL:', `${window.location.origin}/track/${pkg.short_code}`)
      } else {
        toast.error('Failed to generate QR code')
      }
    } catch (error) {
      console.error('QR code generation error:', error)
      toast.error('Failed to generate QR code')
    }
  }

  const handlePrintLabel = async () => {
    if (!createdPackage) {
      toast.error('No package to print')
      return
    }

    console.log('Print button clicked')
    setIsPrinting(true)

    // Generate barcode if not already done
    if (!barcodeDataUrl) {
      await generateBarcodeForPackage(createdPackage)
    }

    // Preload logo as base64 for reliable printing - CRITICAL FOR LOGO TO SHOW
    const logoBase64 = await loadLogoAsBase64()
    console.log('[Print] Logo loaded:', logoBase64 ? 'YES (base64)' : 'NO, using URL')
    
    // Wait for DOM to be ready
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Set logo src - try multiple times to ensure it works
    const setLogo = () => {
      if (printRef.current) {
        const logoImg = printRef.current.querySelector('#label-logo-img') as HTMLImageElement || 
                       printRef.current.querySelector('.logo') as HTMLImageElement
      if (logoImg) {
          if (logoBase64) {
            console.log('[Print] Setting logo src to base64')
        logoImg.src = logoBase64
          } else {
            console.log('[Print] Using logo URL fallback')
            logoImg.src = getLogoUrl()
          }
          logoImg.style.display = 'block'
          logoImg.style.visibility = 'visible'
          logoImg.style.opacity = '1'
          logoImg.style.maxHeight = '5mm'
          logoImg.style.maxWidth = '90%'
          
          // Force logo to load
          logoImg.onload = () => {
            console.log('[Print] Logo loaded successfully')
            logoImg.style.display = 'block'
            logoImg.style.visibility = 'visible'
          }
          logoImg.onerror = () => {
            console.error('[Print] Logo failed to load')
            if (logoBase64) {
              logoImg.src = logoBase64
            } else {
              logoImg.src = getLogoUrl()
            }
          }
          return true
        } else {
          console.error('[Print] Logo img element not found in DOM!')
          return false
        }
      }
      return false
    }
    
    // Try setting logo multiple times
    if (!setLogo()) {
      setTimeout(() => setLogo(), 100)
      setTimeout(() => setLogo(), 300)
    }

    // Wait for barcode to be in DOM
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const images = printRef.current?.querySelectorAll('img')
        
        if (images && images.length > 0) {
          let loadedCount = 0
          const totalImages = images.length
          let hasTriggered = false

          const checkAllLoaded = () => {
            loadedCount++
            if (loadedCount === totalImages && !hasTriggered) {
              hasTriggered = true
              triggerPrint()
            }
          }

          images.forEach((img) => {
            if (img.complete && img.naturalHeight !== 0) {
              checkAllLoaded()
            } else {
              img.addEventListener('load', checkAllLoaded, { once: true })
              img.addEventListener('error', checkAllLoaded, { once: true })
            }
          })

          setTimeout(() => {
            if (!hasTriggered) {
              hasTriggered = true
              triggerPrint()
            }
          }, 2000)
        } else {
          setTimeout(() => triggerPrint(), 300)
        }
      })
    })
  }

  const triggerPrint = () => {
    if (!printRef.current) {
      console.error('Print ref not available')
      setIsPrinting(false)
      toast.error('Print label not ready')
      return
    }

    // Verify label content is actually in DOM
    const labelContainer = document.getElementById('print-label')
    const labelElement = printRef.current?.querySelector('.shipping-label')
    
    if (!labelContainer || !labelElement) {
      console.error('Label not found in DOM', { 
        hasContainer: !!labelContainer, 
        hasElement: !!labelElement,
        hasRef: !!printRef.current 
      })
      setIsPrinting(false)
      toast.error('Label content not ready')
      return
    }

    console.log('Label container found:', labelContainer)
    console.log('Label element found:', labelElement)
    console.log('Label HTML:', labelElement.innerHTML.substring(0, 200))
    console.log('Label container computed style:', window.getComputedStyle(labelContainer))

    // Inject print settings to force 58mm x 40mm for thermal printers
    const injectPrintSettings = () => {
      // Remove any existing print settings
      const existing = document.getElementById('auto-print-settings')
      if (existing) existing.remove()
      
      // Create style element with forced print dimensions - multiple formats for thermal printer compatibility
      const printStyle = document.createElement('style')
      printStyle.id = 'auto-print-settings'
      printStyle.textContent = `
        @page {
          size: 58mm 40mm !important;
          size: 2.283in 1.575in !important;
          margin: 0mm !important;
          margin: 0in !important;
          padding: 0mm !important;
          width: 58mm !important;
          height: 40mm !important;
        }
        @media print {
          @page {
            size: 58mm 40mm !important;
            size: 2.283in 1.575in !important;
            margin: 0mm !important;
            margin: 0in !important;
            padding: 0mm !important;
          }
          @page :first {
            size: 58mm 40mm !important;
            size: 2.283in 1.575in !important;
            margin: 0mm !important;
          }
          html, body {
            width: 58mm !important;
            width: 2.283in !important;
            height: 40mm !important;
            height: 1.575in !important;
            margin: 0mm !important;
            margin: 0in !important;
            padding: 0mm !important;
            padding: 0in !important;
            overflow: hidden !important;
          }
          * {
            box-sizing: border-box !important;
          }
        }
      `
      document.head.appendChild(printStyle)
    }

    injectPrintSettings()

    // Ensure all content is rendered and visible
    setTimeout(() => {
      try {
        // Make sure the container is in the DOM (it should be, but verify)
        if (printRef.current && !document.body.contains(printRef.current)) {
          document.body.appendChild(printRef.current)
        }

        // Force a reflow to ensure layout
        if (printRef.current) {
          void printRef.current.offsetHeight
        }

        console.log('Calling window.print() with 58mm x 40mm settings')
        window.print()
        
        setTimeout(() => {
          // Clean up print settings
          const styleEl = document.getElementById('auto-print-settings')
          if (styleEl) styleEl.remove()
          setIsPrinting(false)
          toast.success('Label sent to printer')
        }, 1000)
      } catch (error) {
        console.error('Print error:', error)
        setIsPrinting(false)
        toast.error('Failed to open print dialog')
      }
    }, 300)
  }

  const handleCreate = async () => {
    try {
      // Get current user from auth context
      if (!user) {
        toast.error('You must be logged in to create a package')
        return
      }

      const userId = user.id

      // 1. PRE-CHECK for sufficient inventory
      let insufficient: Array<{ item: any; qty: number; available: number }> = []
      for (const product of formData.items) {
        const item = inventoryItems.find(i => i.id === product.productId)
        if (!item) {
          insufficient.push({ item: null, qty: product.quantity, available: 0 })
        } else if (item.stock_on_hand < product.quantity) {
          insufficient.push({ item, qty: product.quantity, available: item.stock_on_hand })
        }
      }

      if (insufficient.length > 0) {
        const errorMsg = insufficient.map(x => 
          `${x.item?.name || 'Unknown'}: needed ${x.qty}, available ${x.available}`
        ).join('; ')
        toast.error(`Insufficient stock: ${errorMsg}`)
        return
      }

      // 2. Generate short code and package ID
      const shortCode = Math.random().toString(36).substr(2, 6).toUpperCase()
      const packageId = crypto.randomUUID()
      const encodedPayload = JSON.stringify({ pkg: packageId, rev: 1 })

      // 3. Get first branch from database
      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (branchError) {
        toast.error('Error fetching branches: ' + branchError.message)
        return
      }

      if (!branchData) {
        toast.error('Error: No branches found. Please set up branches in the database.')
        return
      }

      const branchId = branchData.id
      
      // 4. Create package in Supabase
      const { data: packageData, error } = await supabase
        .from('packages')
        .insert({
          short_code: shortCode,
          created_by: userId,
          origin: 'Main Office',
          destination_branch_id: branchId,
          contents_note: `To: ${formData.name} ${formData.surname}${formData.company ? ` | ${formData.company}` : ''}\n${formData.address}\nItems: ${formData.items.map(i => `${i.product} x${i.quantity}`).join(', ')}`,
          status: 'created',
          current_location: 'Main Office',
          symbology: 'code128',
          encoded_payload: encodedPayload
        })
        .select()
        .single()

      console.log('Package creation result:', { data: packageData, error })

      if (error) {
        console.error('Error creating package:', error)
        toast.error(`Error: ${error.message} (Code: ${error.code})`, { duration: 5000 })
        return
      }

      // 5. Deduct inventory for each selected product
      for (const product of formData.items) {
        const item = inventoryItems.find(i => i.id === product.productId)
        if (!item) continue

        // Create inventory movement record
        const { error: movementError } = await supabase
          .from('inventory_movements')
          .insert({
            item_id: item.id,
            delta: -product.quantity, // Negative for deduction
            reason: `Package ${shortCode} created`,
            ref_package_id: packageData.id,
            user_id: userId
          })

        if (movementError) {
          console.error('Error creating inventory movement:', movementError)
          toast.error(`Failed to record inventory movement for ${item.name}`)
          // Continue with other items
        }

        // Update inventory stock
        const { error: updateError } = await supabase
          .from('inventory_items')
          .update({
            stock_on_hand: item.stock_on_hand - product.quantity
          })
          .eq('id', item.id)

        if (updateError) {
          console.error('Error updating inventory:', updateError)
          toast.error(`Failed to update inventory for ${item.name}`)
          // Continue with other items
        }
      }

      // 6. Refresh inventory data
      await loadInventoryItems()
      
      // 7. Signal for inventory views to refresh
      window.dispatchEvent(new Event('inventory-updated'))

      // 8. Store created package and move to step 4 (review/print step)
      setCreatedPackage(packageData)
      setStep(4)
      toast.success(`Package created successfully! ID: ${packageData.short_code}`, { duration: 5000 })
      
      // 9. Auto-generate barcode for printing
      generateBarcodeForPackage(packageData)
    } catch (error) {
      console.error('Unexpected error:', error)
      toast.error('Unexpected error: ' + (error as any).message + '. Please check the browser console for details.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('createLabel.title')}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">×</button>
          </div>
          
          <div className="mt-4 flex items-center space-x-2">
            {[1, 2, 3, 4].map((stepNum) => (
              <div
                key={stepNum}
                className={`flex-1 h-2 rounded-full ${
                  stepNum <= step ? 'bg-red-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Import Mode Toggle - Show at step 1 */}
          {step === 1 && (
            <div className="mb-6">
              <div className="flex items-center justify-center gap-4 p-2 bg-gray-100 rounded-lg">
                <button
                  onClick={() => {
                    setImportMode(false)
                    // Reset form when switching modes
                    setFormData({
                      name: '',
                      surname: '',
                      company: '',
                      address: '',
                      items: [],
                    })
                  }}
                  className={`flex-1 py-2 px-4 rounded-md font-medium text-sm transition-colors ${
                    !importMode
                      ? 'bg-white text-red-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t('createLabel.manualEntry')}
                </button>
                <button
                  onClick={() => {
                    setImportMode(true)
                    // Reset form when switching modes
                    setFormData({
                      name: '',
                      surname: '',
                      company: '',
                      address: '',
                      items: [],
                    })
                  }}
                  className={`flex-1 py-2 px-4 rounded-md font-medium text-sm transition-colors ${
                    importMode
                      ? 'bg-white text-red-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t('createLabel.importFromExcel')}
                </button>
              </div>
            </div>
          )}

          {/* Excel Import Section - Show at step 1 when import mode is active */}
          {step === 1 && importMode && (
            <div className="mb-6 space-y-4">
              <div className="text-center mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900">{t('createLabel.importFromExcel')}</h3>
                <p className="text-sm text-gray-600">{t('createLabel.importFromExcel')}</p>
              </div>

              <div>
                <label className="block w-full">
                  <div className="flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-red-500 hover:bg-red-50 cursor-pointer transition-colors">
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">{t('createLabel.chooseExcelFile')}</span>
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelImport}
                    className="hidden"
                  />
                </label>
                <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs font-semibold text-gray-700 mb-1">{t('createLabel.excelFormat')}</p>
                  <p className="text-xs text-gray-600">
                    {t('createLabel.excelColumns')} <span className="font-mono">Beneficiary</span> | <span className="font-mono">Company</span> | <span className="font-mono">Address</span> | <span className="font-mono">Products</span> | <span className="font-mono">Notes</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    {t('createLabel.excelProductsNote')} <span className="font-mono">6; 5; 9</span>)
                  </p>
                </div>
              </div>

              {/* Bulk import progress */}
              {isBulkImporting && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-semibold text-blue-800 mb-2">{t('createLabel.processingBulkImport')}</p>
                  <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${(bulkImportProgress.current / bulkImportProgress.total) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-blue-700 text-center">
                    {bulkImportProgress.current} {t('createLabel.rowsProcessed')} {bulkImportProgress.total}
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 1 && !importMode && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-red-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900">{t('createLabel.recipientInfo')}</h3>
                <p className="text-sm text-gray-600">{t('createLabel.enterRecipientDetails')}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('createLabel.nameRequired')}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder={t('createLabel.firstNamePlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('createLabel.surnameRequired')}</label>
                  <input
                    type="text"
                    value={formData.surname}
                    onChange={(e) => setFormData({...formData, surname: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder={t('createLabel.lastNamePlaceholder')}
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('createLabel.company')}</label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({...formData, company: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder={t('createLabel.companyPlaceholder')}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-red-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900">{t('createLabel.deliveryAddress')}</h3>
                <p className="text-sm text-gray-600">{t('createLabel.enterDeliveryAddress')}</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('createLabel.addressRequired')}</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  rows={3}
                  placeholder={t('createLabel.addressPlaceholder')}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-red-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900">{t('createLabel.products')}</h3>
                <p className="text-sm text-gray-600">{t('createLabel.selectProductsQuantities')}</p>
              </div>

              
              {/* Selected Products Summary */}
              {formData.items.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">{t('createLabel.selectedProducts')}</h4>
                  <div className="space-y-2">
                    {formData.items.map((item) => {
                      const inventoryItem = inventoryItems.find(i => i.id === item.productId)
                      return (
                        <div key={item.productId} className="flex items-center justify-between bg-white rounded-lg p-3">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{item.product}</div>
                            {inventoryItem && (
                              <div className="text-xs text-gray-500">{t('inventory.sku')}: {inventoryItem.sku} • {t('createLabel.available')} {inventoryItem.stock_on_hand} {inventoryItem.unit}</div>
                            )}
                          </div>
                          <div className="flex items-center space-x-3">
                            <button
                              onClick={() => handleProductQuantityChange(item.productId, -1)}
                              className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center font-bold text-gray-700"
                            >
                              −
                            </button>
                            <span className="text-lg font-semibold text-gray-900 min-w-[2rem] text-center">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleProductQuantityChange(item.productId, 1)}
                              className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center font-bold text-white"
                            >
                              +
                            </button>
                            <button
                              onClick={() => handleProductRemove(item.productId)}
                              className="ml-2 p-1 text-red-600 hover:text-red-700"
                              title={t('createLabel.remove')}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Product Selection Buttons */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {inventoryItems
                  .filter(item => item.stock_on_hand > 0)
                  .map((item) => {
                    const isSelected = formData.items.some(i => i.productId === item.id)
                    const selectedQty = formData.items.find(i => i.productId === item.id)?.quantity || 0
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleProductSelect(item)}
                        disabled={item.stock_on_hand <= 0}
                        className={`w-full p-4 text-left border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          isSelected
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-medium text-gray-900">{item.name}</div>
                        <div className="text-sm text-gray-600">{t('inventory.sku')}: {item.sku} • {t('inventory.stockLabel')} {item.stock_on_hand} {item.unit}</div>
                        {isSelected && (
                          <div className="mt-2 text-xs text-red-600 font-semibold">{t('inventory.selected')} {selectedQty}</div>
                        )}
                        {item.stock_on_hand <= item.min_threshold && (
                          <div className="mt-2 text-xs text-orange-600 font-medium">{t('inventory.lowStock')}</div>
                        )}
                      </button>
                    )
                  })}
              </div>

              {inventoryItems.filter(item => item.stock_on_hand > 0).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>{t('createLabel.noProductsAvailable')}</p>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-green-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900">{t('createLabel.labelCreated')}</h3>
                <p className="text-sm text-gray-600">{t('createLabel.reviewDetailsPrint')}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                {createdPackage && (
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-gray-600">{t('createLabel.packageId')}</span>
                    <span className="text-sm font-mono font-bold">{createdPackage.short_code}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">{t('createLabel.recipient')}:</span>
                  <span className="text-sm font-medium">{formData.name} {formData.surname}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">{t('createLabel.companyLabel')}</span>
                  <span className="text-sm font-medium">{formData.company || t('packages.noNotes')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">{t('createLabel.addressLabel')}</span>
                  <span className="text-sm font-medium">{formData.address}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">{t('createLabel.productsLabel')}</span>
                  {formData.items.length > 0 ? (
                    formData.items.map((item, idx) => (
                      <span key={idx} className="text-sm font-medium">{item.product} x {item.quantity}</span>
                    ))
                  ) : (
                    <span className="text-sm font-medium">{t('createLabel.noProducts')}</span>
                  )}
                </div>
              </div>
              <button
                onClick={handlePrintLabel}
                disabled={isPrinting || !createdPackage}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50"
              >
                {isPrinting ? t('createLabel.preparingPrint') : t('createLabel.printLabel')}
              </button>
            </div>
          )}

          <div className="flex justify-between mt-6">
            {step > 1 && step < 4 && (
              <button
                onClick={() => setStep(step - 1)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-6 rounded-lg transition-colors"
              >
                {t('createLabel.back')}
              </button>
            )}
            
            {step < 3 && (
              <button
                onClick={handleNext}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors ml-auto"
              >
                {t('createLabel.next')}
              </button>
            )}

            {step === 3 && formData.items.length > 0 && (
              <button
                onClick={handleCreate}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors ml-auto"
              >
                {t('createLabel.reviewCreate')}
              </button>
            )}

            {step === 4 && (
              <button
                onClick={onClose}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-6 rounded-lg transition-colors"
              >
                {t('common.close')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Printable Label - Hidden on screen, visible in print */}
      <div id="print-label" ref={printRef} className="print-label-container">
        {createdPackage && barcodeDataUrl ? (
          <div className="shipping-label">
            <div className="label-left-section">
              <div className="logo-section">
                <img 
                  src="" 
                  alt="Sigma Logo" 
                  className="logo" 
                  id="label-logo-img"
                  style={{ display: 'block', visibility: 'visible', opacity: 1 }}
                />
                <div className="logo-separator"></div>
              </div>
              
              <div className="tracking-code-section">
                <div className="tracking-label">{t('createLabel.tracking')}</div>
                <div className="tracking-code">{createdPackage.short_code}</div>
              </div>

              <div className="recipient-section">
                <div className="recipient-name">{formData.name} {formData.surname}</div>
                {formData.company && (
                  <div className="company-name">{formData.company}</div>
                )}
                {formData.address && <div className="address-text">{formData.address}</div>}
              </div>
            </div>

            <div className="label-right-section">
              <img src={barcodeDataUrl} alt="QR Code" className="qr-code" />
            </div>
          </div>
        ) : (
          <div className="shipping-label">
            <div className="tracking-code">{t('createLabel.loading')}</div>
          </div>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        /* TEMPORARY: Show label on screen to see changes - Remove this after testing! */
        #print-label {
          position: fixed !important;
          left: 50% !important;
          top: 50% !important;
          transform: translate(-50%, -50%) scale(2.5) !important;
          width: 58mm !important;
          min-height: 40mm !important;
          z-index: 99999 !important;
          background: white !important;
          border: 4px solid red !important;
          box-shadow: 0 0 30px rgba(0,0,0,0.7) !important;
        }
        
        /* Normal behavior - uncomment this to hide label on screen */
        /* #print-label {
          position: absolute;
          left: -9999px;
          top: -9999px;
          width: 58mm;
          min-height: 40mm;
        } */

        /* Print styles - 58mm x 40mm thermal label - SINGLE PAGE ONLY */
        @media print {
          /* Force hide everything */
          * {
            margin: 0 !important;
            padding: 0 !important;
          }

          body * {
            visibility: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* Show only the label and its children */
          #print-label,
          #print-label * {
            visibility: visible !important;
          }

          #print-label {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 58mm !important;
            height: 40mm !important;
            max-width: 58mm !important;
            max-height: 40mm !important;
            background: white !important;
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 9999 !important;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
            page-break-before: avoid !important;
          }

          /* 58mm x 40mm thermal label - SINGLE PAGE ONLY */
          @page {
            size: 58mm 40mm;
            margin: 0 !important;
            padding: 0 !important;
          }

          html, body {
            width: 58mm !important;
            height: 40mm !important;
            max-width: 58mm !important;
            max-height: 40mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: white !important;
            page-break-after: avoid !important;
            page-break-before: avoid !important;
          }

          /* Main Label Container - SIMPLE FUNCTIONAL DESIGN */
          .shipping-label {
            width: 58mm !important;
            height: 40mm !important;
            max-width: 58mm !important;
            max-height: 40mm !important;
            padding: 0.5mm !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            margin: 0 !important;
            background: #ffffff !important;
            color: #000 !important;
            position: relative !important;
            border: 0.2mm solid #000000 !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            page-break-after: avoid !important;
          }

          /* Left Section - Logo & Content */
          .label-left-section {
            display: flex !important;
            flex-direction: column !important;
            padding: 0 !important;
            margin: 0 !important;
            flex: 1 !important;
            min-width: 0 !important;
            height: 100% !important;
          }

          /* Logo Section - Simple Top Bar - ALWAYS VISIBLE */
          .logo-section {
            background: #000000 !important;
            padding: 0.8mm !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
            height: 6mm !important;
            max-height: 6mm !important;
            min-height: 6mm !important;
            visibility: visible !important;
            opacity: 1 !important;
          }

          .logo {
            max-height: 5mm !important;
            max-width: 90% !important;
            width: auto !important;
            height: auto !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            object-fit: contain !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
            filter: brightness(0) invert(1) !important;
          }
          
          .logo[src=""],
          .logo:not([src]) {
            display: none !important;
          }

          .logo-separator {
            display: none !important;
          }

          /* Tracking Code Section - Simple */
          .tracking-code-section {
            padding: 0.5mm !important;
            background: #ffffff !important;
            border-bottom: 0.2mm solid #000000 !important;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            flex-shrink: 0 !important;
            gap: 0.5mm !important;
            min-height: 3mm !important;
          }

          .tracking-label {
            font-size: 1.5pt !important;
            font-weight: 700 !important;
            color: #000000 !important;
            text-transform: uppercase !important;
            font-family: 'Arial', sans-serif !important;
            margin: 0 !important;
            white-space: nowrap !important;
            line-height: 1.2 !important;
          }

          .tracking-code {
            font-size: 5pt !important;
            font-weight: 800 !important;
            letter-spacing: 0.8px !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            text-transform: uppercase !important;
            font-family: 'Courier New', 'Monaco', monospace !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
            display: inline-block !important;
            flex: 1 !important;
            text-align: right !important;
          }

          /* Main Content Section - Recipient Info */
          .recipient-section {
            display: flex !important;
            flex-direction: column !important;
            padding: 1mm !important;
            gap: 0.5mm !important;
            flex: 1 !important;
            justify-content: flex-start !important;
            background: #ffffff !important;
            position: relative !important;
            min-height: 0 !important;
            overflow: hidden !important;
          }

          /* Beneficiary Name - BIGGEST & BOLDEST */
          .recipient-name {
            font-weight: 800 !important;
            font-size: 10pt !important;
            margin: 0 !important;
            padding: 0 !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.3px !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            flex-shrink: 0 !important;
          }

          /* Company Name - MEDIUM */
          .company-name {
            font-weight: 600 !important;
            font-size: 7pt !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.2px !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .company-name::before {
            display: none !important;
          }

          /* Address - READABLE */
          .address-text {
            font-size: 5pt !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            font-weight: 400 !important;
            font-family: 'Arial', sans-serif !important;
            margin: 0 !important;
            padding: 0 !important;
            letter-spacing: 0.1px !important;
          }

          .address-text::before {
            display: none !important;
          }

          /* QR Code Section - BIG & READABLE */
          .label-right-section {
            position: absolute !important;
            right: 0.5mm !important;
            bottom: 0.5mm !important;
            width: 16mm !important;
            height: 16mm !important;
            max-width: 16mm !important;
            max-height: 16mm !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: #ffffff !important;
            border: 0.2mm solid #000000 !important;
            padding: 0.5mm !important;
            box-sizing: border-box !important;
          }

          /* QR Code - Clear and scannable */
          .qr-code {
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            display: block !important;
            object-fit: contain !important;
            border: none !important;
            padding: 0 !important;
            background: transparent !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }

          /* Items List - Very Compact */
          .items-list {
            font-size: 2.2pt !important;
            color: #000000 !important;
            line-height: 1.2 !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            font-weight: 400 !important;
          }

          .items-list div {
            margin-bottom: 0.05mm !important;
            line-height: 1.2 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}

// Transfer Modal
function TransferModal({ onClose }: { onClose: () => void }) {
  const [destination, setDestination] = useState('')
  const [packageId, setPackageId] = useState('')

  const handleTransfer = async () => {
    if (!destination || !packageId) {
      toast.error('Please enter both package ID and destination')
      return
    }

    try {
      // Update package location in Supabase
      const { error } = await supabase
        .from('packages')
        .update({ 
          current_location: destination,
          status: 'in_transit'
        })
        .eq('short_code', packageId)

      if (error) throw error

      toast.success(`Package ${packageId} transferred to ${destination} successfully!`)
      onClose()
    } catch (error) {
      console.error('Error transferring package:', error)
      toast.error('Error transferring package. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Transfer Package</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">×</button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-red-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900">Transfer Package</h3>
            <p className="text-sm text-gray-600">Enter package ID and destination</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Package ID</label>
            <input
              type="text"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="Enter package ID"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transfer To</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="Enter destination"
            />
          </div>

          <div className="flex space-x-2 mt-6">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-6 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleTransfer}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
            >
              Transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Scanner Modal - Uses actual BarcodeScanner component
function ScannerModal({ onClose }: { onClose: () => void }) {
  const handleScanSuccess = (packageData: any) => {
    // BarcodeScanner component handles the scan, package lookup, and status update
    // Just show success notification
    toast.success(`Package scanned: ${packageData.short_code}`)
  }

  // BarcodeScanner already has its own full-screen layout, so just render it directly
  return (
    <BarcodeScanner 
      onScanSuccess={handleScanSuccess} 
      onClose={onClose} 
    />
  )
}

// Admin Modal Component - Enhanced with Packages, Products, and Audit Log
function AdminModal({ onClose }: { onClose: () => void }) {
  const { user: currentUser } = useAuth()
  const { t } = useTranslation()
  
  // Prevent non-admin access
  if (currentUser?.role !== 'admin') {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 modal-enter">
        <div className="bg-white rounded-xl max-w-md w-full smooth-transition shadow-2xl">
          <div className="p-6">
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('admin.accessDenied')}</h2>
              <p className="text-gray-600 mb-4">{t('admin.onlyAdminAccess')}</p>
              <button
                onClick={onClose}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  const [activeTab, setActiveTab] = useState<'users' | 'packages' | 'products' | 'audit'>('users')
  const [users, setUsers] = useState<any[]>([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', pin: '', role: 'standard' })
  
  // Packages state
  const [packages, setPackages] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [editingPackage, setEditingPackage] = useState<any | null>(null)
  const [packageFormData, setPackageFormData] = useState({
    recipient_name: '',
    recipient_company: '',
    delivery_address: '',
    contents: '',
    destination_branch_id: '',
    current_location: '',
    status: 'created' as any
  })

  // Helper function to parse contents_note into separate fields
  const parseContentsNote = (contentsNote: string) => {
    const lines = contentsNote.split('\n').filter(l => l.trim())
    let recipientName = ''
    let recipientCompany = ''
    let deliveryAddress = ''
    let contents = ''

    for (const line of lines) {
      if (line.startsWith('To: ')) {
        const toLine = line.substring(4).trim()
        // Parse "Name Surname | Company" or "Name Surname (Company)"
        const pipeMatch = toLine.match(/^(.+?)\s*\|\s*(.+)$/)
        const parenMatch = toLine.match(/^(.+?)\s+\((.+)\)\s*$/)
        
        if (pipeMatch) {
          // Format: "Name | Company"
          const namePart = pipeMatch[1].trim()
          const nameParts = namePart.split(/\s+/)
          recipientName = nameParts[0] || ''
          if (nameParts.length > 1) {
            recipientName += ' ' + nameParts.slice(1).join(' ')
          }
          recipientCompany = pipeMatch[2].trim()
        } else if (parenMatch) {
          // Format: "Name (Company)"
          const namePart = parenMatch[1].trim()
          const nameParts = namePart.split(/\s+/)
          recipientName = nameParts[0] || ''
          if (nameParts.length > 1) {
            recipientName += ' ' + nameParts.slice(1).join(' ')
          }
          recipientCompany = parenMatch[2].trim()
        } else {
          // Just name, no company
          const nameParts = toLine.split(/\s+/)
          recipientName = nameParts[0] || ''
          if (nameParts.length > 1) {
            recipientName += ' ' + nameParts.slice(1).join(' ')
          }
        }
      } else if (line.startsWith('Items: ')) {
        contents = line.substring(7).trim()
      } else if (line.trim() && !line.startsWith('To: ') && !line.startsWith('Items: ')) {
        // This is likely the address line
        if (!deliveryAddress) {
          deliveryAddress = line.trim()
        } else {
          deliveryAddress += '\n' + line.trim()
        }
      }
    }

    return { recipientName, recipientCompany, deliveryAddress, contents }
  }

  // Helper function to format contents_note from separate fields
  const formatContentsNote = (recipientName: string, recipientCompany: string, deliveryAddress: string, contents: string) => {
    const parts: string[] = []
    
    if (recipientName || recipientCompany) {
      let toLine = 'To: '
      if (recipientName) {
        toLine += recipientName.trim()
      }
      if (recipientCompany) {
        toLine += ` | ${recipientCompany.trim()}`
      }
      parts.push(toLine)
    }
    
    if (deliveryAddress) {
      parts.push(deliveryAddress.trim())
    }
    
    if (contents) {
      parts.push(`Items: ${contents.trim()}`)
    }
    
    return parts.join('\n')
  }
  const [packageSearchTerm, setPackageSearchTerm] = useState('')
  
  // Products state
  const [products, setProducts] = useState<any[]>([])
  const [editingProduct, setEditingProduct] = useState<any | null>(null)
  const [productFormData, setProductFormData] = useState({
    name: '',
    stock_on_hand: 0,
    min_threshold: 0
  })
  
  // Audit Log state
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  
  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [packageToDelete, setPackageToDelete] = useState<any | null>(null)

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').order('name')
      if (error) throw error
      setUsers(data || [])
    } catch (error) {
      console.error('Error loading users:', error)
    }
  }

  const loadPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('packages')
        .select(`
          *,
          destination_branch:branches(name, code, address),
          created_by_user:users!packages_created_by_fkey(name)
        `)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      
      // Sort packages: non-printed first (by created_at desc), then printed (by created_at desc)
      const sortedPackages = (data || []).sort((a, b) => {
        const aIsPrinted = a.status === 'printed'
        const bIsPrinted = b.status === 'printed'
        
        // If one is printed and the other isn't, non-printed comes first
        if (aIsPrinted && !bIsPrinted) return 1
        if (!aIsPrinted && bIsPrinted) return -1
        
        // If both have the same printed status, sort by created_at descending
        const aDate = new Date(a.created_at).getTime()
        const bDate = new Date(b.created_at).getTime()
        return bDate - aDate
      })
      
      setPackages(sortedPackages)
    } catch (error) {
      console.error('Error loading packages:', error)
      toast.error('Failed to load packages')
    }
  }

  const loadBranches = async () => {
    try {
      const { data, error } = await supabase.from('branches').select('*').order('name')
      if (error) throw error
      setBranches(data || [])
    } catch (error) {
      console.error('Error loading branches:', error)
    }
  }

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .order('name')
      
      if (error) throw error
      setProducts(data || [])
    } catch (error) {
      console.error('Error loading products:', error)
      toast.error('Failed to load products')
    }
  }

  const loadAuditLogs = async () => {
    setAuditLoading(true)
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select(`
          *,
          user:users!audit_log_user_id_fkey(name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      
      if (error) throw error
      setAuditLogs(data || [])
    } catch (error) {
      console.error('Error loading audit logs:', error)
      toast.error('Failed to load audit logs')
    } finally {
      setAuditLoading(false)
    }
  }

  const handleEditPackage = (pkg: any) => {
    setEditingPackage(pkg)
    const parsed = parseContentsNote(pkg.contents_note || '')
    setPackageFormData({
      recipient_name: parsed.recipientName,
      recipient_company: parsed.recipientCompany,
      delivery_address: parsed.deliveryAddress,
      contents: parsed.contents,
      destination_branch_id: pkg.destination_branch_id || '',
      current_location: pkg.current_location || '',
      status: pkg.status || 'created'
    })
  }

  const handleQuickStatusChange = async (pkg: any, newStatus: string) => {
    if (!pkg || !pkg.id) {
      console.error('[Admin] Invalid package data:', pkg)
      toast.error('Invalid package data')
      return
    }

    if (!currentUser || !currentUser.id) {
      console.error('[Admin] User not authenticated:', currentUser)
      toast.error('User not authenticated')
      return
    }

    if (pkg.status === newStatus) {
      console.log('[Admin] Status unchanged, skipping update')
      return // No change needed
    }

    const oldStatus = pkg.status
    
    // Optimistically update UI immediately
    setPackages(prevPackages => 
      prevPackages.map(p => 
        p.id === pkg.id ? { ...p, status: newStatus } : p
      )
    )

    try {
      console.log(`[Admin] Changing status for package ${pkg.short_code} (${pkg.id}) from "${oldStatus}" to "${newStatus}"`)

      // Update package status in database
      const { data: updateData, error: updateError } = await supabase
        .from('packages')
        .update({ status: newStatus })
        .eq('id', pkg.id)
        .select()
        .single()

      if (updateError) {
        console.error('[Admin] Status update error:', updateError)
        // Revert optimistic update
        setPackages(prevPackages => 
          prevPackages.map(p => 
            p.id === pkg.id ? { ...p, status: oldStatus } : p
          )
        )
        throw updateError
      }

      console.log('[Admin] Status updated successfully:', updateData)

      // Record status history
      const { error: historyError } = await supabase
        .from('package_status_history')
        .insert({
          package_id: pkg.id,
          from_status: oldStatus,
          to_status: newStatus,
          location: pkg.current_location || 'Admin Update',
          scanned_by: currentUser.id,
          scanned_at: new Date().toISOString(),
          note: 'Status updated by administrator'
        })

      if (historyError) {
        console.warn('[Admin] Failed to record status history (non-critical):', historyError)
        // Don't fail the whole operation if history recording fails
      } else {
        console.log('[Admin] Status history recorded successfully')
      }

      toast.success(`Package ${pkg.short_code} status updated to ${newStatus.replace(/_/g, ' ')}`)
      
      // Reload packages to ensure consistency
      setTimeout(() => {
        loadPackages()
      }, 500)
    } catch (error: any) {
      console.error('[Admin] Error updating package status:', error)
      toast.error(`Failed to update package status: ${error?.message || error?.code || 'Unknown error'}`)
    }
  }

  const handleSavePackage = async () => {
    if (!editingPackage) return
    
    try {
      const oldStatus = editingPackage.status
      const newStatus = packageFormData.status

      // Format contents_note from separate fields
      const contentsNote = formatContentsNote(
        packageFormData.recipient_name,
        packageFormData.recipient_company,
        packageFormData.delivery_address,
        packageFormData.contents
      )

      const updateData: any = {
        contents_note: contentsNote,
        destination_branch_id: packageFormData.destination_branch_id || null,
        current_location: packageFormData.current_location.trim(),
        status: newStatus
      }

      const { error } = await supabase
        .from('packages')
        .update(updateData)
        .eq('id', editingPackage.id)

      if (error) throw error

      // Record status history if status changed
      if (oldStatus !== newStatus) {
        await supabase
          .from('package_status_history')
          .insert({
            package_id: editingPackage.id,
            from_status: oldStatus,
            to_status: newStatus,
            location: packageFormData.current_location.trim() || 'Admin Update',
            scanned_by: currentUser?.id || '',
            scanned_at: new Date().toISOString(),
            note: 'Updated by administrator'
          })
      }

      toast.success('Package updated successfully!')
      setEditingPackage(null)
      loadPackages()
    } catch (error) {
      console.error('Error updating package:', error)
      toast.error('Failed to update package')
    }
  }

  const handleDeletePackage = (pkg: any) => {
    setPackageToDelete(pkg)
    setShowDeleteConfirm(true)
  }

  const confirmDeletePackage = async () => {
    if (!packageToDelete) return
    
    try {
      const { error } = await supabase
        .from('packages')
        .delete()
        .eq('id', packageToDelete.id)

      if (error) throw error

      toast.success(`Package ${packageToDelete.short_code} deleted successfully!`)
      setShowDeleteConfirm(false)
      setPackageToDelete(null)
      loadPackages()
    } catch (error) {
      console.error('Error deleting package:', error)
      toast.error('Failed to delete package')
      setShowDeleteConfirm(false)
      setPackageToDelete(null)
    }
  }

  const handleEditProduct = (product: any) => {
    setEditingProduct(product)
    setProductFormData({
      name: product.name || '',
      stock_on_hand: product.stock_on_hand || 0,
      min_threshold: product.min_threshold || 0
    })
  }

  const handleSaveProduct = async () => {
    if (!editingProduct) return
    
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({
          name: productFormData.name.trim(),
          stock_on_hand: productFormData.stock_on_hand,
          min_threshold: productFormData.min_threshold
        })
        .eq('id', editingProduct.id)

      if (error) throw error

      toast.success('Product updated successfully!')
      setEditingProduct(null)
      loadProducts()
    } catch (error) {
      console.error('Error updating product:', error)
      toast.error('Failed to update product')
    }
  }

  const handleAddUser = async () => {
    try {
      const { error } = await supabase.from('users').insert({
        name: newUser.name,
        pin_hash: newUser.pin,
        role: newUser.role,
        active: true
      })
      if (error) throw error
      setShowAddUser(false)
      setNewUser({ name: '', pin: '', role: 'standard' })
      loadUsers()
      toast.success('User added successfully!')
    } catch (error) {
      console.error('Error adding user:', error)
      toast.error('Error adding user. Please check if user already exists.')
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  useEffect(() => {
    if (activeTab === 'packages') {
      loadPackages()
      loadBranches()
    } else if (activeTab === 'products') {
      loadProducts()
    } else if (activeTab === 'audit') {
      loadAuditLogs()
    }
  }, [activeTab])

  const [logo, setLogo] = useState<string | null>(null)

  useEffect(() => {
    // Always use Supabase Storage URL - no localStorage needed
    setLogo(getLogoUrl())
  }, [])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 modal-enter">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto smooth-transition shadow-2xl">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img 
                src={logo || getLogoUrl()} 
                alt="Logo" 
                width="32"
                height="32"
                className="w-8 h-8 object-contain" 
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement
                  console.error('[Logo] Failed to load from Supabase Storage in Admin modal')
                  target.style.display = 'none'
                }} 
              />
              <h2 className="text-lg font-semibold text-gray-900">{t('admin.title')}</h2>
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">×</button>
          </div>
          
          <div className="mt-4 flex space-x-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'users' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {t('admin.users')}
            </button>
            <button
              onClick={() => setActiveTab('packages')}
              className={`px-4 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'packages' ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t('admin.packages')}
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`px-4 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'products' ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t('admin.products')}
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'audit' ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t('admin.auditLog')}
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-medium text-gray-900">{t('admin.userManagement')}</h3>
                <button
                  onClick={() => setShowAddUser(true)}
                  className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  {t('admin.addUser')}
                </button>
              </div>

              {showAddUser && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('scanner.name')}</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder={t('admin.fullName')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.pinLabel')}</label>
                    <input
                      type="text"
                      value={newUser.pin}
                      onChange={(e) => setNewUser({...newUser, pin: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder={t('admin.pinPlaceholder')}
                      maxLength={6}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.role')}</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    >
                      <option value="standard">{t('admin.standard')}</option>
                      <option value="admin">{t('admin.adminRole')}</option>
                    </select>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleAddUser}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      {t('admin.addUserButton')}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddUser(false)
                        setNewUser({ name: '', pin: '', role: 'standard' })
                      }}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <div className="font-medium text-gray-900">{user.name}</div>
                      <div className="text-sm text-gray-600">PIN: {user.pin_hash} • Role: {user.role}</div>
                    </div>
                    <div className={`px-2 py-1 text-xs rounded-full ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {user.role}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'packages' && (
            <div className="space-y-4 fade-in-up">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{t('admin.packageManagement')}</h3>
                  <p className="text-sm text-gray-600">{t('admin.viewModifyPackage')}</p>
                  <div className="mt-2 flex items-center space-x-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-medium text-blue-800">💡 Quick Tip: Click the status dropdown on any package to change its status instantly!</span>
                  </div>
                </div>
              </div>

              {/* Search */}
              <div>
                <input
                  type="text"
                  value={packageSearchTerm}
                  onChange={(e) => setPackageSearchTerm(e.target.value)}
                  placeholder={t('admin.searchPackages')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {/* Edit Package Form */}
              {editingPackage && (
                <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-6 border border-red-100 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-900">{t('admin.editPackage')} {editingPackage.short_code}</h4>
                    <button
                      onClick={() => {
                        setEditingPackage(null)
                        setPackageFormData({ recipient_name: '', recipient_company: '', delivery_address: '', contents: '', destination_branch_id: '', current_location: '', status: 'created' })
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">{t('admin.statusLabel')}</label>
                      <select
                        value={packageFormData.status}
                        onChange={(e) => setPackageFormData({ ...packageFormData, status: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      >
                        <option value="just_created">{t('scanner.statuses.just_created')}</option>
                        <option value="created">{t('scanner.statuses.created')}</option>
                        <option value="queued_for_print">{t('scanner.statuses.queued_for_print')}</option>
                        <option value="printed">{t('scanner.statuses.printed')}</option>
                        <option value="handed_over">{t('scanner.statuses.handed_over')}</option>
                        <option value="in_transit">{t('scanner.statuses.in_transit')}</option>
                        <option value="at_branch">{t('scanner.statuses.at_branch')}</option>
                        <option value="delivered">{t('scanner.statuses.delivered')}</option>
                        <option value="returned">{t('scanner.statuses.returned')}</option>
                        <option value="canceled">{t('scanner.statuses.canceled')}</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Recipient Name</label>
                        <input
                          type="text"
                          value={packageFormData.recipient_name}
                          onChange={(e) => setPackageFormData({ ...packageFormData, recipient_name: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                          placeholder="Full name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Company</label>
                        <input
                          type="text"
                          value={packageFormData.recipient_company}
                          onChange={(e) => setPackageFormData({ ...packageFormData, recipient_company: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                          placeholder="Company name (optional)"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Delivery Address</label>
                      <textarea
                        value={packageFormData.delivery_address}
                        onChange={(e) => setPackageFormData({ ...packageFormData, delivery_address: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 resize-none"
                        rows={2}
                        placeholder="Street address, city, postal code"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Contents (Items Only)</label>
                      <textarea
                        value={packageFormData.contents}
                        onChange={(e) => setPackageFormData({ ...packageFormData, contents: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 resize-none"
                        rows={3}
                        placeholder="e.g., Limoncello x1, Electronics x2"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">{t('admin.currentLocation')}</label>
                      <input
                        type="text"
                        value={packageFormData.current_location}
                        onChange={(e) => setPackageFormData({ ...packageFormData, current_location: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                        placeholder={t('admin.currentLocationPlaceholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">{t('admin.destinationBranch')}</label>
                      <select
                        value={packageFormData.destination_branch_id}
                        onChange={(e) => setPackageFormData({ ...packageFormData, destination_branch_id: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      >
                        <option value="">{t('admin.selectBranch')}</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name} - {branch.code}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex space-x-3 pt-4">
                      <button
                        onClick={handleSavePackage}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-all shadow-md hover:shadow-lg"
                      >
                        {t('admin.saveChanges')}
                      </button>
                      <button
                        onClick={() => {
                          setEditingPackage(null)
                          setPackageFormData({ contents_note: '', destination_branch_id: '', current_location: '', status: 'created' })
                        }}
                        className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded-lg"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Packages List */}
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {packages
                  .filter(pkg => {
                    if (!packageSearchTerm) return true
                    const term = packageSearchTerm.toLowerCase()
                    return (
                      pkg.short_code.toLowerCase().includes(term) ||
                      pkg.contents_note?.toLowerCase().includes(term) ||
                      pkg.created_by_user?.name?.toLowerCase().includes(term) ||
                      pkg.destination_branch?.name?.toLowerCase().includes(term)
                    )
                  })
                  .map((pkg) => (
                    <div key={pkg.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 hover:shadow-md hover:border-red-200 transition-all">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-4">
                            <span className="font-mono font-bold text-lg text-gray-900">{pkg.short_code}</span>
                            <div className="flex items-center space-x-2">
                              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-xs text-gray-500 font-medium">Change Status</span>
                            </div>
                          </div>
                          
                          {/* Status Change - Very Prominent */}
                          <div className="mb-4">
                            <label className="flex items-center space-x-2 text-sm font-bold text-gray-700 mb-2">
                              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              <span>Package Status:</span>
                            </label>
                            <select
                              value={pkg.status || 'created'}
                              onChange={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                const newStatus = e.target.value
                                console.log('[Admin] Status change triggered:', { packageId: pkg.id, shortCode: pkg.short_code, oldStatus: pkg.status, newStatus })
                                handleQuickStatusChange(pkg, newStatus)
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              className={`w-full px-4 py-3 text-sm font-bold rounded-lg border-2 cursor-pointer focus:ring-2 focus:ring-red-500 focus:border-red-500 shadow-md hover:shadow-lg transition-all transform hover:scale-[1.02] ${
                                pkg.status === 'just_created' ? 'bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200' :
                                pkg.status === 'delivered' ? 'bg-green-100 text-green-900 border-green-400 hover:bg-green-200' :
                                pkg.status === 'canceled' ? 'bg-red-100 text-red-900 border-red-400 hover:bg-red-200' :
                                pkg.status === 'in_transit' ? 'bg-yellow-100 text-yellow-900 border-yellow-400 hover:bg-yellow-200' :
                                pkg.status === 'at_branch' ? 'bg-purple-100 text-purple-900 border-purple-400 hover:bg-purple-200' :
                                pkg.status === 'printed' ? 'bg-indigo-100 text-indigo-900 border-indigo-400 hover:bg-indigo-200' :
                                pkg.status === 'queued_for_print' ? 'bg-orange-100 text-orange-900 border-orange-400 hover:bg-orange-200' :
                                pkg.status === 'handed_over' ? 'bg-cyan-100 text-cyan-900 border-cyan-400 hover:bg-cyan-200' :
                                pkg.status === 'returned' ? 'bg-pink-100 text-pink-900 border-pink-400 hover:bg-pink-200' :
                                'bg-blue-100 text-blue-900 border-blue-400 hover:bg-blue-200'
                              }`}
                              title="Click to change package status - Select a new status from the dropdown"
                            >
                              <option value="just_created">{t('scanner.statuses.just_created')}</option>
                              <option value="created">{t('scanner.statuses.created')}</option>
                              <option value="queued_for_print">{t('scanner.statuses.queued_for_print')}</option>
                              <option value="printed">{t('scanner.statuses.printed')}</option>
                              <option value="handed_over">{t('scanner.statuses.handed_over')}</option>
                              <option value="in_transit">{t('scanner.statuses.in_transit')}</option>
                              <option value="at_branch">{t('scanner.statuses.at_branch')}</option>
                              <option value="delivered">{t('scanner.statuses.delivered')}</option>
                              <option value="returned">{t('scanner.statuses.returned')}</option>
                              <option value="canceled">{t('scanner.statuses.canceled')}</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-1.5 flex items-center space-x-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>Click the dropdown above to change status</span>
                            </p>
                          </div>
                          
                          {(() => {
                            const parsed = parseContentsNote(pkg.contents_note || '')
                            return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
                                {parsed.recipientName && (
                            <div>
                                    <span className="text-gray-500 font-medium">{t('packages.recipient')}:</span>
                                    <p className="text-gray-900 mt-0.5 font-semibold">
                                      {parsed.recipientName}
                                      {parsed.recipientCompany && ` | ${parsed.recipientCompany}`}
                                    </p>
                            </div>
                                )}
                                {parsed.deliveryAddress && (
                            <div>
                                    <span className="text-gray-500 font-medium">{t('packages.deliveryAddress')}:</span>
                                    <p className="text-gray-900 mt-0.5 whitespace-pre-line">{parsed.deliveryAddress}</p>
                            </div>
                                )}
                                {parsed.contents && (
                            <div>
                                    <span className="text-gray-500 font-medium">{t('packages.contents')}:</span>
                                    <p className="text-gray-900 mt-0.5">{parsed.contents}</p>
                                  </div>
                                )}
                                <div>
                                  <span className="text-gray-500 font-medium">{t('scanner.currentLocation')}:</span>
                              <p className="text-gray-900 mt-0.5">{pkg.current_location || <span className="italic text-gray-400">Not set</span>}</p>
                            </div>
                            <div>
                                  <span className="text-gray-500 font-medium">{t('scanner.createdBy')}:</span>
                              <p className="text-gray-900 mt-0.5 font-semibold">{pkg.created_by_user?.name || <span className="italic text-gray-400">Unknown</span>}</p>
                            </div>
                          </div>
                            )
                          })()}
                        </div>
                        
                        <div className="ml-6 flex flex-col space-y-2">
                          <button
                            onClick={() => handleEditPackage(pkg)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-all shadow-sm hover:shadow-md whitespace-nowrap"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeletePackage(pkg)}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-all shadow-sm hover:shadow-md whitespace-nowrap"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {activeTab === 'products' && (
            <div className="space-y-4 fade-in-up">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Product Management</h3>
                <p className="text-sm text-gray-600">Edit product details, stock quantities, and maximum limits. Adding new products is disabled.</p>
              </div>

              {/* Edit Product Form */}
              {editingProduct && (
                <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-6 border border-red-100 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-900">Edit Product: {editingProduct.sku}</h4>
                    <button
                      onClick={() => {
                        setEditingProduct(null)
                        setProductFormData({ name: '', stock_on_hand: 0, min_threshold: 0 })
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Product Name</label>
                      <input
                        type="text"
                        value={productFormData.name}
                        onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Stock Quantity</label>
                        <input
                          type="number"
                          value={productFormData.stock_on_hand}
                          onChange={(e) => setProductFormData({ ...productFormData, stock_on_hand: parseInt(e.target.value) || 0 })}
                          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                          min="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Min Threshold (Max Limit)</label>
                        <input
                          type="number"
                          value={productFormData.min_threshold}
                          onChange={(e) => setProductFormData({ ...productFormData, min_threshold: parseInt(e.target.value) || 0 })}
                          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                          min="0"
                        />
                      </div>
                    </div>

                    <div className="flex space-x-3 pt-4">
                      <button
                        onClick={handleSaveProduct}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-all shadow-md hover:shadow-lg"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => {
                          setEditingProduct(null)
                          setProductFormData({ name: '', stock_on_hand: 0, min_threshold: 0 })
                        }}
                        className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Products List */}
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {products.map((product) => (
                  <div key={product.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 hover:shadow-md hover:border-red-200 transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h4 className="text-lg font-semibold text-gray-900">{product.name}</h4>
                          <span className="px-2 py-1 text-xs font-mono bg-gray-100 text-gray-700 rounded">
                            {product.sku}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500">Unit:</span>
                            <p className="font-medium text-gray-900">{product.unit || 'N/A'}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">Stock:</span>
                            <p className={`font-bold ${
                              product.stock_on_hand <= product.min_threshold ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {product.stock_on_hand}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-500">Min Threshold:</span>
                            <p className="font-medium text-gray-900">{product.min_threshold}</p>
                          </div>
                        </div>
                      </div>
                      <div className="ml-6">
                        <button
                          onClick={() => handleEditProduct(product)}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-all shadow-sm hover:shadow-md"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-4 fade-in-up">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Audit Log</h3>
                <p className="text-sm text-gray-600">Track all user actions and system changes</p>
              </div>

              {auditLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading audit logs...</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {auditLogs.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-xl">
                      <p className="text-gray-500">{t('admin.noAuditLogs')}</p>
                    </div>
                  ) : (
                    auditLogs.map((log) => (
                      <div key={log.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                                {log.action.toUpperCase()}
                              </span>
                              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
                                {log.entity}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-gray-500 font-medium">{t('admin.user')}</span>
                                <p className="text-gray-900 mt-0.5 font-semibold">{log.user?.name || t('admin.unknownUser')}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 font-medium">{t('admin.entityId')}</span>
                                <p className="text-gray-900 mt-0.5 font-mono text-xs">{log.entity_id}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 font-medium">{t('admin.timestamp')}</span>
                                <p className="text-gray-900 mt-0.5">
                                  {new Date(log.created_at).toLocaleString()}
                                </p>
                              </div>
                              {log.ip && (
                                <div>
                                  <span className="text-gray-500 font-medium">{t('admin.ipAddress')}</span>
                                  <p className="text-gray-900 mt-0.5 font-mono text-xs">{log.ip}</p>
                                </div>
                              )}
                            </div>
                            {(log.before_json || log.after_json) && (
                              <details className="mt-3">
                                <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                                  {t('admin.viewChanges')}
                                </summary>
                                <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs font-mono">
                                  {log.before_json && (
                                    <div className="mb-2">
                                      <span className="font-semibold text-red-600">{t('admin.before')}</span>
                                      <pre className="mt-1 text-gray-700 whitespace-pre-wrap">
                                        {JSON.stringify(log.before_json, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.after_json && (
                                    <div>
                                      <span className="font-semibold text-green-600">{t('admin.after')}</span>
                                      <pre className="mt-1 text-gray-700 whitespace-pre-wrap">
                                        {JSON.stringify(log.after_json, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        title={t('admin.deletePackage')}
        message={t('admin.deleteConfirmMessage', { code: packageToDelete?.short_code })}
        confirmText={t('admin.deleteButton')}
        cancelText={t('common.cancel')}
        type="danger"
        onConfirm={confirmDeletePackage}
        onCancel={() => {
          setShowDeleteConfirm(false)
          setPackageToDelete(null)
        }}
      />
    </div>
  )
}

// Inventory Modal Component
function InventoryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [products, setProducts] = useState<any[]>([])
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [newProduct, setNewProduct] = useState({ name: '', sku: '', stock: 0, min_threshold: 10 })
  const [logo, setLogo] = useState<string | null>(null)

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase.from('inventory_items').select('*').order('name')
      if (error) throw error
      setProducts(data || [])
    } catch (error) {
      console.error('Error loading products:', error)
    }
  }

  const handleAddProduct = async () => {
    try {
      const { error } = await supabase.from('inventory_items').insert({
        name: newProduct.name,
        sku: newProduct.sku,
        stock_on_hand: newProduct.stock,
        min_threshold: newProduct.min_threshold,
        active: true
      })
      if (error) throw error
      setShowAddProduct(false)
      setNewProduct({ name: '', sku: '', stock: 0, min_threshold: 10 })
      loadProducts()
      toast.success('Product added successfully!')
    } catch (error) {
      console.error('Error adding product:', error)
      toast.error('Error adding product. Please check if SKU already exists.')
    }
  }

  const handleAdjustStock = async (itemId: string, newStock: number) => {
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({ stock_on_hand: newStock })
        .eq('id', itemId)
      if (error) throw error
      loadProducts()
      toast.success('Stock updated successfully!')
    } catch (error) {
      console.error('Error updating stock:', error)
      toast.error('Error updating stock.')
    }
  }

  useEffect(() => {
    loadProducts()
    // Always use Supabase Storage URL - no localStorage needed
    setLogo(getLogoUrl())
  }, [])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 modal-enter">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto smooth-transition shadow-2xl">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img 
                src={logo || getLogoUrl()} 
                alt="Logo" 
                width="32"
                height="32"
                className="w-8 h-8 object-contain" 
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement
                  console.error('[Logo] Failed to load from Supabase Storage in Inventory modal')
                  target.style.display = 'none'
                }} 
              />
              <h2 className="text-lg font-semibold text-gray-900">{t('inventory.inventoryManagement')}</h2>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">×</button>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-3">
            {products.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <p className="text-gray-500">{t('inventory.noProductsFound')}</p>
              </div>
            ) : (
              products.map((product) => (
                <div key={product.id} className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{product.name}</div>
                    <div className="text-sm text-gray-600 mt-1">{t('inventory.sku')}: {product.sku}</div>
                    <div className="text-xs text-gray-500 mt-1">{t('inventory.unit')}: {product.unit} • {t('inventory.minThreshold')}: {product.min_threshold}</div>
                  </div>
                  <div className="text-right ml-6">
                    <div className={`text-2xl font-bold ${
                      product.stock_on_hand <= product.min_threshold ? 'text-red-600' : 
                      product.stock_on_hand === 0 ? 'text-gray-400' : 'text-green-600'
                    }`}>
                      {product.stock_on_hand}
                    </div>
                    <div className="text-xs text-gray-500">{product.unit}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Packages Modal Component
function PackagesModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const [packages, setPackages] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showPrintAllDialog, setShowPrintAllDialog] = useState(false)
  const [selectedPackagesForPrint, setSelectedPackagesForPrint] = useState<Set<string>>(new Set())
  const [selectedColumn, setSelectedColumn] = useState<number>(0) // Default to all columns (0 = all, 1-3 = specific column)
  const [printSearchTerm, setPrintSearchTerm] = useState('')
  const [isPrintingAll, setIsPrintingAll] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<any>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const [printingPackageId, setPrintingPackageId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Always use Supabase Storage URL - no localStorage needed
    setLogo(getLogoUrl())
  }, [])

  const loadPackages = async (search: string = '', status: string = 'all') => {
    setIsLoading(true)
    try {
      let query = supabase
        .from('packages')
        .select('*')
        .order('created_at', { ascending: false })

      // Filter by status if not 'all'
      if (status !== 'all') {
        query = query.eq('status', status)
      }

      // If there's a search term, search across multiple fields
      if (search.trim()) {
        const searchValue = search.trim()
        // Use OR conditions to search across multiple fields
        // Supabase PostgREST uses % for wildcards in ilike
        query = query.or(`short_code.ilike.%${searchValue}%,contents_note.ilike.%${searchValue}%,notes.ilike.%${searchValue}%,status.ilike.%${searchValue}%,current_location.ilike.%${searchValue}%,origin.ilike.%${searchValue}%`)
      }

      // Load more packages - no limit or high limit for search results
      const limit = search.trim() ? 1000 : 500 // Load more when searching
      query = query.limit(limit)
      
      const { data, error } = await query
      
      if (error) throw error
      
      // Sort packages: non-printed first (by created_at desc), then printed (by created_at desc)
      const sortedPackages = (data || []).sort((a, b) => {
        const aIsPrinted = a.status === 'printed'
        const bIsPrinted = b.status === 'printed'
        
        // If one is printed and the other isn't, non-printed comes first
        if (aIsPrinted && !bIsPrinted) return 1
        if (!aIsPrinted && bIsPrinted) return -1
        
        // If both have the same printed status, sort by created_at descending
        const aDate = new Date(a.created_at).getTime()
        const bDate = new Date(b.created_at).getTime()
        return bDate - aDate
      })
      
      setPackages(sortedPackages)
    } catch (error) {
      console.error('Error loading packages:', error)
      toast.error('Failed to load packages')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPackages('', statusFilter)
  }, [statusFilter])

  // Debounced search - search as user types
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set new timeout for search
    searchTimeoutRef.current = setTimeout(() => {
      loadPackages(searchTerm, statusFilter)
    }, 300) // Wait 300ms after user stops typing

    // Cleanup
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchTerm, statusFilter])

  // Packages are already filtered server-side, so no client-side filtering needed
  const filteredPackages = packages

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'just_created': 'bg-emerald-100 text-emerald-800',
      'created': 'bg-blue-100 text-blue-800',
      'queued_for_print': 'bg-yellow-100 text-yellow-800',
      'printed': 'bg-purple-100 text-purple-800',
      'handed_over': 'bg-indigo-100 text-indigo-800',
      'in_transit': 'bg-orange-100 text-orange-800',
      'at_branch': 'bg-cyan-100 text-cyan-800',
      'delivered': 'bg-green-100 text-green-800',
      'returned': 'bg-red-100 text-red-800',
      'canceled': 'bg-gray-100 text-gray-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }


  const parsePackageContents = (contentsNote: string) => {
    const lines = contentsNote.split('\n')
    let name = ''
    let surname = ''
    let company = ''
    let address = ''
    const items: Array<{ product: string; quantity: number }> = []

    for (const line of lines) {
      if (line.startsWith('To: ')) {
        const toLine = line.substring(4).trim()
        // Handle both "Name | Company" and "Name (Company)" formats
        const pipeMatch = toLine.match(/^(.+?)\s*\|\s*(.+)$/)
        const parenMatch = toLine.match(/^(.+?)\s+\((.+)\)\s*$/)
        
        if (pipeMatch) {
          // Format: "Name | Company"
          const namePart = pipeMatch[1].trim()
          const nameParts = namePart.split(/\s+/)
          if (nameParts.length >= 2) {
            name = nameParts[0]
            surname = nameParts.slice(1).join(' ')
          } else {
            name = namePart
          }
          company = pipeMatch[2].trim()
        } else if (parenMatch) {
          // Format: "Name (Company)"
          const fullName = parenMatch[1].trim()
          const nameParts = fullName.split(/\s+/)
          if (nameParts.length >= 2) {
            name = nameParts[0]
            surname = nameParts.slice(1).join(' ')
          } else {
            name = fullName
          }
          company = parenMatch[2].trim()
        } else {
          // Just name, no company
          const nameParts = toLine.split(/\s+/)
          if (nameParts.length >= 2) {
            name = nameParts[0]
            surname = nameParts.slice(1).join(' ')
          } else {
            name = toLine
          }
        }
      } else if (line.startsWith('Items: ')) {
        const itemsLine = line.substring(7).trim()
        const itemStrings = itemsLine.split(',').map(i => i.trim())
        for (const itemStr of itemStrings) {
          const match = itemStr.match(/^(.+?)\s+x\s*(\d+)$/i)
          if (match) {
            items.push({
              product: match[1].trim(),
              quantity: parseInt(match[2], 10)
            })
          } else if (itemStr) {
            items.push({
              product: itemStr,
              quantity: 1
            })
          }
        }
      } else if (line.trim() && !line.includes('×') && !line.includes('x')) {
        address = line.trim()
      }
    }

    return { name, surname, company, address, items }
  }

  // generateQRCode is now imported from utils/qrCode.ts - no local function needed

  const printPackage = async (pkg: any, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
    }
    
    setIsPrinting(true)
    setPrintingPackageId(pkg.id)

    try {
      const parsed = parsePackageContents(pkg.contents_note || '')
      const qrCodeUrl = await generateQRCode(pkg.short_code)
      
      if (!qrCodeUrl) {
        toast.error('Failed to generate QR code')
        setIsPrinting(false)
        setPrintingPackageId(null)
        return
      }

      const logoBase64 = await loadLogoAsBase64()
      const logoSrc = logoBase64 || getLogoUrl()
      console.log('[PackagesModal Print] Logo src:', logoSrc ? 'SET' : 'MISSING', logoBase64 ? '(base64)' : '(URL)')
      
      const printLabelHTML = `
        <div class="shipping-label">
          <div class="label-left-section">
            <div class="logo-section">
              <img src="${logoSrc}" alt="Sigma Logo" class="logo" style="display: block !important; visibility: visible !important; opacity: 1 !important; max-height: 5mm !important; max-width: 90% !important;" onerror="console.error('Logo failed to load'); this.style.display='block'; this.style.visibility='visible';" />
              <div class="logo-separator"></div>
            </div>
            
            <div class="tracking-code-section">
              <div class="tracking-label">NDJETIMI</div>
              <div class="tracking-code">${pkg.short_code}</div>
            </div>

            <div class="recipient-section">
              ${parsed.name || parsed.surname ? `<div class="recipient-name">${parsed.name} ${parsed.surname}</div>` : ''}
              ${parsed.company ? `<div class="company-name">${parsed.company}</div>` : ''}
              ${parsed.address ? `<div class="address-text">${parsed.address}</div>` : ''}
            </div>
          </div>

          <div class="label-right-section">
            <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
          </div>
        </div>
      `

      let printContainer = document.getElementById('print-label-packages-modal')
      if (!printContainer) {
        printContainer = document.createElement('div')
        printContainer.id = 'print-label-packages-modal'
        printContainer.className = 'print-label-container'
        document.body.appendChild(printContainer)
      }
      printContainer.innerHTML = printLabelHTML

      // CRITICAL: Ensure logo is visible and loaded
      const logoImg = printContainer.querySelector('.logo') as HTMLImageElement
      if (logoImg) {
        logoImg.style.display = 'block'
        logoImg.style.visibility = 'visible'
        logoImg.style.opacity = '1'
        if (logoBase64 && logoImg.src !== logoBase64) {
          logoImg.src = logoBase64
        }
        console.log('[PackagesModal Print] Logo element found, src:', logoImg.src.substring(0, 50))
      } else {
        console.error('[PackagesModal Print] Logo element NOT found!')
      }

      const images = printContainer.querySelectorAll('img')
      let loadedCount = 0
      const totalImages = images.length
      let hasTriggered = false

      const checkAllLoaded = () => {
        loadedCount++
        if (loadedCount === totalImages && !hasTriggered) {
          hasTriggered = true
          // Double-check logo is visible before printing
          if (logoImg) {
            logoImg.style.display = 'block'
            logoImg.style.visibility = 'visible'
            logoImg.style.opacity = '1'
          }
          triggerPrint()
        }
      }

      if (images.length > 0) {
        images.forEach((img) => {
          if (img.complete && (img as HTMLImageElement).naturalHeight !== 0) {
            checkAllLoaded()
          } else {
            img.addEventListener('load', checkAllLoaded, { once: true })
            img.addEventListener('error', () => {
              // Don't hide logo on error, try base64 if available
              if (img === logoImg && logoBase64) {
                const imgElement = img as HTMLImageElement
                imgElement.src = logoBase64
                imgElement.style.display = 'block'
                imgElement.style.visibility = 'visible'
              }
              checkAllLoaded()
            }, { once: true })
          }
        })

        setTimeout(() => {
          if (!hasTriggered) {
            hasTriggered = true
            triggerPrint()
          }
        }, 2000)
      } else {
        setTimeout(() => triggerPrint(), 300)
      }
    } catch (error) {
      console.error('Print error:', error)
      toast.error('Failed to prepare label for printing')
      setIsPrinting(false)
      setPrintingPackageId(null)
    }
  }

  const triggerPrint = () => {
    const printContainer = document.getElementById('print-label-packages-modal')
    if (!printContainer) {
      console.error('Print container not found')
      setIsPrinting(false)
      setPrintingPackageId(null)
      toast.error('Print label not ready')
      return
    }

    // Inject print settings to force 58mm x 40mm for thermal printers
    const injectPrintSettings = () => {
      // Remove any existing print settings
      const existing = document.getElementById('auto-print-settings-packages')
      if (existing) existing.remove()
      
      // Create style element with forced print dimensions - multiple formats for thermal printer compatibility
      const printStyle = document.createElement('style')
      printStyle.id = 'auto-print-settings-packages'
      printStyle.textContent = `
        @page {
          size: 58mm 40mm !important;
          size: 2.283in 1.575in !important;
          margin: 0mm !important;
          margin: 0in !important;
          padding: 0mm !important;
          width: 58mm !important;
          height: 40mm !important;
        }
        @media print {
          @page {
            size: 58mm 40mm !important;
            size: 2.283in 1.575in !important;
            margin: 0mm !important;
            margin: 0in !important;
            padding: 0mm !important;
          }
          @page :first {
            size: 58mm 40mm !important;
            size: 2.283in 1.575in !important;
            margin: 0mm !important;
          }
          html, body {
            width: 58mm !important;
            width: 2.283in !important;
            height: 40mm !important;
            height: 1.575in !important;
            margin: 0mm !important;
            margin: 0in !important;
            padding: 0mm !important;
            padding: 0in !important;
            overflow: hidden !important;
          }
          * {
            box-sizing: border-box !important;
          }
        }
      `
      document.head.appendChild(printStyle)
    }

    injectPrintSettings()

    setTimeout(() => {
      try {
        console.log('Calling window.print() with 58mm x 40mm settings')
        window.print()
        
        setTimeout(() => {
          // Clean up print settings
          const styleEl = document.getElementById('auto-print-settings-packages')
          if (styleEl) styleEl.remove()
          setIsPrinting(false)
          setPrintingPackageId(null)
          toast.success('Label sent to printer')
          // Reload packages to update ordering (printed packages move to bottom)
          loadPackages(searchTerm, statusFilter)
        }, 1000)
      } catch (error) {
        console.error('Print error:', error)
        setIsPrinting(false)
        setPrintingPackageId(null)
        toast.error('Failed to open print dialog')
      }
    }, 300)
  }

  const printAllThermal = async () => {
    const packagesToPrint = packages.filter(pkg => selectedPackagesForPrint.has(pkg.id))
    
    if (packagesToPrint.length === 0) {
      toast.error('Ju lutemi zgjidhni të paktën një paketë')
      return
    }

    setShowPrintAllDialog(false)
    setIsPrintingAll(true)

    try {
      // Print each package one by one
      for (let i = 0; i < packagesToPrint.length; i++) {
        const pkg = packagesToPrint[i]
        await printPackage(pkg)
        
        // Wait a bit between prints to avoid overwhelming the printer
        if (i < packagesToPrint.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
      }
      
      toast.success(`U printuan me sukses ${packagesToPrint.length} etiketa`)
    } catch (error) {
      console.error('Print all error:', error)
      toast.error('Dështoi printimi i etiketave')
    } finally {
      setIsPrintingAll(false)
    }
  }

  const printAllA4 = async () => {
    const packagesToPrint = packages.filter(pkg => selectedPackagesForPrint.has(pkg.id))
    
    if (packagesToPrint.length === 0) {
      toast.error('Ju lutemi zgjidhni të paktën një paketë')
      return
    }

    setShowPrintAllDialog(false)
    setIsPrintingAll(true)

    try {
      const logoBase64 = await loadLogoAsBase64()
      const logoSrc = logoBase64 || getLogoUrl()

      // Generate QR codes for selected packages only
      const packagesWithQR: Array<{ pkg: any; qrCode: string | null }> = []
      for (const pkg of packagesToPrint) {
        const qrCode = await generateQRCode(pkg.short_code)
        packagesWithQR.push({ pkg, qrCode })
      }

      // A4 dimensions: 210mm x 297mm
      // Label dimensions: 70mm x 30mm
      // Layout: 3 columns (horizontal) x 8 rows (vertical) = 24 labels per page
      // Place selected packages: if selectedColumn is 0, distribute across all 3 columns, otherwise in selected column

      const labelsPerRow = 3  // 3 columns = 3 labels horizontally
      const labelsPerColumn = 8  // 8 rows = 8 labels vertically
      const labelsPerPage = labelsPerRow * labelsPerColumn
      
      let html = ''
      html += '<div class="a4-page" style="width: 210mm; height: 297mm; margin: 0; padding: 10mm; box-sizing: border-box; page-break-after: always; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(8, 1fr); gap: 1.5mm;">'
      
      if (selectedColumn === 0) {
        // Distribute packages across all 3 columns
        // Fill columns 1, 2, 3 in order: col1-row1, col2-row1, col3-row1, col1-row2, col2-row2, col3-row2, etc.
        for (let i = 0; i < packagesWithQR.length; i++) {
          const { pkg, qrCode } = packagesWithQR[i]
          const parsed = parsePackageContents(pkg.contents_note || '')
          
          // Calculate position: distribute across columns
          // Package 0: row 0, col 0 (position 0)
          // Package 1: row 0, col 1 (position 1)
          // Package 2: row 0, col 2 (position 2)
          // Package 3: row 1, col 0 (position 3)
          // Package 4: row 1, col 1 (position 4)
          // etc.
          const row = Math.floor(i / labelsPerRow)
          const col = i % labelsPerRow
          const position = row * labelsPerRow + col
          
          // Fill empty cells before this package
          const previousPosition = i > 0 ? (Math.floor((i - 1) / labelsPerRow) * labelsPerRow + ((i - 1) % labelsPerRow)) : -1
          const cellsToFill = position - previousPosition - 1
          for (let j = 0; j < cellsToFill; j++) {
            html += '<div></div>'
          }
          
          // Generate tracking URL for QR code
          const trackingUrl = `${window.location.origin}/track/${pkg.short_code}`
          
          html += `
            <div class="a4-label" style="width: 100%; max-width: 70mm; min-height: 30mm; border: none; padding: 2mm; box-sizing: border-box; display: flex; flex-direction: column; font-size: 6pt; background: white; position: relative; overflow: visible;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 1mm; margin-bottom: 1mm; min-height: auto;">
                <div style="font-weight: bold; font-size: 7pt; line-height: 1.1;">${pkg.short_code || ''}</div>
                ${qrCode ? `<img src="${qrCode}" class="a4-qr-code" style="width: 16mm; height: 16mm; object-fit: contain; display: block; flex-shrink: 0;" alt="${trackingUrl}" />` : '<div style="width: 16mm; height: 16mm; flex-shrink: 0;"></div>'}
              </div>
              <div style="font-weight: bold; font-size: 9pt; margin-bottom: 0.8mm; margin-top: 0.3mm; text-transform: uppercase; line-height: 1.3; word-wrap: break-word; overflow-wrap: break-word; flex: 0 0 auto;">${((parsed.name || '') + ' ' + (parsed.surname || '')).trim() || 'N/A'}</div>
              ${parsed.company ? `<div style="font-size: 7pt; margin-bottom: 0.4mm; text-transform: uppercase; line-height: 1.2; flex: 0 0 auto;">${parsed.company}</div>` : ''}
              ${parsed.address ? `<div style="font-size: 6pt; line-height: 1.2; flex: 0 0 auto; margin-top: auto;">${parsed.address.replace(/\n/g, '<br>')}</div>` : ''}
            </div>
          `
        }
        
        // Fill remaining empty cells
        const lastPackagePosition = Math.floor((packagesWithQR.length - 1) / labelsPerRow) * labelsPerRow + ((packagesWithQR.length - 1) % labelsPerRow)
        const remainingCells = labelsPerPage - lastPackagePosition - 1
        for (let i = 0; i < remainingCells; i++) {
          html += '<div></div>'
        }
      } else {
        // Place packages in the selected column only
        const startPosition = selectedColumn - 1  // Position in first row (0, 1, or 2)
        
        for (let i = 0; i < packagesWithQR.length; i++) {
          const { pkg, qrCode } = packagesWithQR[i]
          const parsed = parsePackageContents(pkg.contents_note || '')
          
          const currentRow = i
          const positionInRow = selectedColumn - 1
          const currentPosition = currentRow * labelsPerRow + positionInRow
          
          // Fill empty cells before this package (only for first package)
          if (i === 0) {
            for (let j = 0; j < startPosition; j++) {
              html += '<div></div>'
            }
          } else {
            const previousPosition = (i - 1) * labelsPerRow + positionInRow
            const cellsToFill = currentPosition - previousPosition - 1
            for (let j = 0; j < cellsToFill; j++) {
              html += '<div></div>'
            }
          }
          
          // Generate tracking URL for QR code
          const trackingUrl = `${window.location.origin}/track/${pkg.short_code}`
          
          html += `
            <div class="a4-label" style="width: 100%; max-width: 70mm; min-height: 30mm; border: none; padding: 2mm; box-sizing: border-box; display: flex; flex-direction: column; font-size: 6pt; background: white; position: relative; overflow: visible;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 1mm; margin-bottom: 1mm; min-height: auto;">
                <div style="font-weight: bold; font-size: 7pt; line-height: 1.1;">${pkg.short_code || ''}</div>
                ${qrCode ? `<img src="${qrCode}" class="a4-qr-code" style="width: 16mm; height: 16mm; object-fit: contain; display: block; flex-shrink: 0;" alt="${trackingUrl}" />` : '<div style="width: 16mm; height: 16mm; flex-shrink: 0;"></div>'}
              </div>
              <div style="font-weight: bold; font-size: 9pt; margin-bottom: 0.8mm; margin-top: 0.3mm; text-transform: uppercase; line-height: 1.3; word-wrap: break-word; overflow-wrap: break-word; flex: 0 0 auto;">${((parsed.name || '') + ' ' + (parsed.surname || '')).trim() || 'N/A'}</div>
              ${parsed.company ? `<div style="font-size: 7pt; margin-bottom: 0.4mm; text-transform: uppercase; line-height: 1.2; flex: 0 0 auto;">${parsed.company}</div>` : ''}
              ${parsed.address ? `<div style="font-size: 6pt; line-height: 1.2; flex: 0 0 auto; margin-top: auto;">${parsed.address.replace(/\n/g, '<br>')}</div>` : ''}
            </div>
          `
        }
        
        // Fill remaining empty cells
        const lastPackagePosition = (packagesWithQR.length - 1) * labelsPerRow + (selectedColumn - 1)
        const remainingCells = labelsPerPage - lastPackagePosition - 1
        for (let i = 0; i < remainingCells; i++) {
          html += '<div></div>'
        }
      }
      
      html += '</div>'

      const printContainer = document.createElement('div')
      printContainer.id = 'print-all-a4'
      printContainer.innerHTML = html
      printContainer.style.position = 'absolute'
      printContainer.style.left = '-9999px'
      printContainer.style.top = '-9999px'
      document.body.appendChild(printContainer)

      // Add A4 print styles
      const printStyle = document.createElement('style')
      printStyle.id = 'a4-print-styles'
      printStyle.textContent = `
        @media print {
          @page {
            size: A4 !important;
            margin: 10mm !important;
          }
          body * {
            visibility: hidden !important;
          }
          #print-all-a4,
          #print-all-a4 * {
            visibility: visible !important;
          }
          #print-all-a4 {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
          }
          .a4-page {
            width: 210mm !important;
            height: 297mm !important;
            margin: 0 !important;
            padding: 10mm !important;
            box-sizing: border-box !important;
            page-break-after: always !important;
            display: grid !important;
            grid-template-columns: repeat(3, 1fr) !important;
            grid-template-rows: repeat(8, minmax(auto, 1fr)) !important;
            gap: 1.5mm !important;
            align-items: start !important;
          }
          .a4-label {
            width: 100% !important;
            max-width: 70mm !important;
            min-height: 30mm !important;
            border: none !important;
            padding: 2mm !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            background: white !important;
            position: relative !important;
            overflow: visible !important;
          }
          .a4-qr-code {
            width: 16mm !important;
            height: 16mm !important;
            min-width: 16mm !important;
            min-height: 16mm !important;
            max-width: 16mm !important;
            max-height: 16mm !important;
            object-fit: contain !important;
            display: block !important;
            flex-shrink: 0 !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }
        }
      `
      document.head.appendChild(printStyle)

      // Wait for all images to load before printing
      const images = printContainer.querySelectorAll('img')
      let loadedCount = 0
      const totalImages = images.length
      
      const checkAllImagesLoaded = () => {
        loadedCount++
        if (loadedCount === totalImages || totalImages === 0) {
          // All images loaded, trigger print
          setTimeout(() => {
            window.print()
            
            setTimeout(() => {
              printContainer.remove()
              printStyle.remove()
              setIsPrintingAll(false)
              toast.success(`Successfully printed ${packages.length} labels on A4`)
            }, 1000)
          }, 200)
        }
      }
      
      if (images.length > 0) {
        images.forEach((img) => {
          if (img.complete && (img as HTMLImageElement).naturalHeight !== 0) {
            checkAllImagesLoaded()
          } else {
            img.addEventListener('load', checkAllImagesLoaded, { once: true })
            img.addEventListener('error', checkAllImagesLoaded, { once: true })
          }
        })
        
        // Fallback timeout in case images don't load
        setTimeout(() => {
          if (loadedCount < totalImages) {
            console.warn('Some images did not load, printing anyway')
            checkAllImagesLoaded()
          }
        }, 3000)
      } else {
        // No images, print immediately
        setTimeout(() => {
          window.print()
          
          setTimeout(() => {
            printContainer.remove()
            printStyle.remove()
            setIsPrintingAll(false)
            toast.success(`Successfully printed ${packages.length} labels on A4`)
          }, 1000)
        }, 200)
      }
    } catch (error) {
      console.error('Print all A4 error:', error)
      toast.error('Failed to print all labels')
      setIsPrintingAll(false)
    }
  }

  const downloadAllA4 = async () => {
    const packagesToPrint = packages.filter(pkg => selectedPackagesForPrint.has(pkg.id))
    
    if (packagesToPrint.length === 0) {
      toast.error('Ju lutemi zgjidhni të paktën një paketë')
      return
    }

    setShowPrintAllDialog(false)
    setIsPrintingAll(true)

    try {
      // Generate QR codes for selected packages
      const packagesWithQR: Array<{ pkg: any; qrCode: string | null }> = []
      for (const pkg of packagesToPrint) {
        const qrCode = await generateQRCode(pkg.short_code)
        packagesWithQR.push({ pkg, qrCode })
      }

      // A4 dimensions: 210mm x 297mm
      // Label dimensions: 70mm x 30mm
      // Layout: 3 columns (horizontal) x 8 rows (vertical) = 24 labels per page
      // Place selected packages: if selectedColumn is 0, distribute across all 3 columns, otherwise in selected column

      const labelsPerRow = 3  // 3 columns = 3 labels horizontally
      const labelsPerColumn = 8  // 8 rows = 8 labels vertically
      const labelsPerPage = labelsPerRow * labelsPerColumn
      
      let html = ''
      html += '<div class="a4-page" style="width: 210mm; height: 297mm; margin: 0; padding: 10mm; box-sizing: border-box; page-break-after: always; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(8, 1fr); gap: 1.5mm; background: white;">'
      
      if (selectedColumn === 0) {
        // Distribute packages across all 3 columns
        // Fill columns 1, 2, 3 in order: col1-row1, col2-row1, col3-row1, col1-row2, col2-row2, col3-row2, etc.
        for (let i = 0; i < packagesWithQR.length; i++) {
          const { pkg, qrCode } = packagesWithQR[i]
          const parsed = parsePackageContents(pkg.contents_note || '')
          
          // Calculate position: distribute across columns
          // Package 0: row 0, col 0 (position 0)
          // Package 1: row 0, col 1 (position 1)
          // Package 2: row 0, col 2 (position 2)
          // Package 3: row 1, col 0 (position 3)
          // Package 4: row 1, col 1 (position 4)
          // etc.
          const row = Math.floor(i / labelsPerRow)
          const col = i % labelsPerRow
          const position = row * labelsPerRow + col
          
          // Fill empty cells before this package
          const previousPosition = i > 0 ? (Math.floor((i - 1) / labelsPerRow) * labelsPerRow + ((i - 1) % labelsPerRow)) : -1
          const cellsToFill = position - previousPosition - 1
          for (let j = 0; j < cellsToFill; j++) {
            html += '<div></div>'
          }
          
          // Generate tracking URL for QR code
          const trackingUrl = `${window.location.origin}/track/${pkg.short_code}`
          
          html += `
            <div class="a4-label" style="width: 100%; max-width: 70mm; min-height: 30mm; border: none; padding: 2mm; box-sizing: border-box; display: flex; flex-direction: column; font-size: 6pt; background: white; position: relative; overflow: visible;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 1mm; margin-bottom: 1mm; min-height: auto;">
                <div style="font-weight: bold; font-size: 7pt; line-height: 1.1;">${pkg.short_code || ''}</div>
                ${qrCode ? `<img src="${qrCode}" class="a4-qr-code" style="width: 16mm; height: 16mm; object-fit: contain; display: block; flex-shrink: 0;" alt="${trackingUrl}" />` : '<div style="width: 16mm; height: 16mm; flex-shrink: 0;"></div>'}
              </div>
              <div style="font-weight: bold; font-size: 9pt; margin-bottom: 0.8mm; margin-top: 0.3mm; text-transform: uppercase; line-height: 1.3; word-wrap: break-word; overflow-wrap: break-word; flex: 0 0 auto;">${((parsed.name || '') + ' ' + (parsed.surname || '')).trim() || 'N/A'}</div>
              ${parsed.company ? `<div style="font-size: 7pt; margin-bottom: 0.4mm; text-transform: uppercase; line-height: 1.2; flex: 0 0 auto;">${parsed.company}</div>` : ''}
              ${parsed.address ? `<div style="font-size: 6pt; line-height: 1.2; flex: 0 0 auto; margin-top: auto;">${parsed.address.replace(/\n/g, '<br>')}</div>` : ''}
            </div>
          `
        }
        
        // Fill remaining empty cells
        const lastPackagePosition = Math.floor((packagesWithQR.length - 1) / labelsPerRow) * labelsPerRow + ((packagesWithQR.length - 1) % labelsPerRow)
        const remainingCells = labelsPerPage - lastPackagePosition - 1
        for (let i = 0; i < remainingCells; i++) {
          html += '<div></div>'
        }
      } else {
        // Place packages in the selected column only
        const startPosition = selectedColumn - 1  // Position in first row (0, 1, or 2)
        
        for (let i = 0; i < packagesWithQR.length; i++) {
          const { pkg, qrCode } = packagesWithQR[i]
          const parsed = parsePackageContents(pkg.contents_note || '')
          
          const currentRow = i
          const positionInRow = selectedColumn - 1
          const currentPosition = currentRow * labelsPerRow + positionInRow
          
          // Fill empty cells before this package (only for first package)
          if (i === 0) {
            for (let j = 0; j < startPosition; j++) {
              html += '<div></div>'
            }
          } else {
            const previousPosition = (i - 1) * labelsPerRow + positionInRow
            const cellsToFill = currentPosition - previousPosition - 1
            for (let j = 0; j < cellsToFill; j++) {
              html += '<div></div>'
            }
          }
          
          // Generate tracking URL for QR code
          const trackingUrl = `${window.location.origin}/track/${pkg.short_code}`
          
          html += `
            <div class="a4-label" style="width: 100%; max-width: 70mm; min-height: 30mm; border: none; padding: 2mm; box-sizing: border-box; display: flex; flex-direction: column; font-size: 6pt; background: white; position: relative; overflow: visible;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 1mm; margin-bottom: 1mm; min-height: auto;">
                <div style="font-weight: bold; font-size: 7pt; line-height: 1.1;">${pkg.short_code || ''}</div>
                ${qrCode ? `<img src="${qrCode}" class="a4-qr-code" style="width: 16mm; height: 16mm; object-fit: contain; display: block; flex-shrink: 0;" alt="${trackingUrl}" />` : '<div style="width: 16mm; height: 16mm; flex-shrink: 0;"></div>'}
              </div>
              <div style="font-weight: bold; font-size: 9pt; margin-bottom: 0.8mm; margin-top: 0.3mm; text-transform: uppercase; line-height: 1.3; word-wrap: break-word; overflow-wrap: break-word; flex: 0 0 auto;">${((parsed.name || '') + ' ' + (parsed.surname || '')).trim() || 'N/A'}</div>
              ${parsed.company ? `<div style="font-size: 7pt; margin-bottom: 0.4mm; text-transform: uppercase; line-height: 1.2; flex: 0 0 auto;">${parsed.company}</div>` : ''}
              ${parsed.address ? `<div style="font-size: 6pt; line-height: 1.2; flex: 0 0 auto; margin-top: auto;">${parsed.address.replace(/\n/g, '<br>')}</div>` : ''}
            </div>
          `
        }
        
        // Fill remaining empty cells
        const lastPackagePosition = (packagesWithQR.length - 1) * labelsPerRow + (selectedColumn - 1)
        const remainingCells = labelsPerPage - lastPackagePosition - 1
        for (let i = 0; i < remainingCells; i++) {
          html += '<div></div>'
        }
      }
      
      html += '</div>'

      const downloadContainer = document.createElement('div')
      downloadContainer.id = 'download-all-a4'
      downloadContainer.innerHTML = html
      downloadContainer.style.position = 'absolute'
      downloadContainer.style.left = '-9999px'
      downloadContainer.style.top = '-9999px'
      downloadContainer.style.width = '210mm'
      downloadContainer.style.background = 'white'
      
      // Add styles for download
      const downloadStyle = document.createElement('style')
      downloadStyle.id = 'a4-download-styles'
      downloadStyle.textContent = `
        #download-all-a4 {
          background: white !important;
        }
        .a4-page {
          width: 210mm !important;
          height: 297mm !important;
          margin: 0 !important;
          padding: 5mm 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          box-sizing: border-box !important;
          display: grid !important;
          grid-template-columns: repeat(3, 1fr) !important;
          grid-template-rows: repeat(8, minmax(auto, 1fr)) !important;
          gap: 1.5mm !important;
          background: white !important;
          page-break-after: always !important;
          align-items: start !important;
        }
        .a4-label {
          width: 70mm !important;
          min-height: 30mm !important;
          border: none !important;
          padding: 2mm !important;
          box-sizing: border-box !important;
          display: flex !important;
          flex-direction: column !important;
          background: white !important;
          position: relative !important;
          overflow: visible !important;
        }
        .a4-qr-code {
          width: 12mm !important;
          height: 12mm !important;
          min-width: 12mm !important;
          min-height: 12mm !important;
          max-width: 12mm !important;
          max-height: 12mm !important;
          object-fit: contain !important;
          display: block !important;
          flex-shrink: 0 !important;
        }
      `
      document.head.appendChild(downloadStyle)
      document.body.appendChild(downloadContainer)

      // Wait for all images to load
      const images = downloadContainer.querySelectorAll('img')
      let loadedCount = 0
      const totalImages = images.length
      
      const waitForImages = (): Promise<void> => {
        return new Promise((resolve) => {
          if (totalImages === 0) {
            resolve()
            return
          }
          
          const checkLoaded = () => {
            loadedCount++
            if (loadedCount === totalImages) {
              resolve()
            }
          }
          
          images.forEach((img) => {
            if (img.complete && (img as HTMLImageElement).naturalHeight !== 0) {
              checkLoaded()
            } else {
              img.addEventListener('load', checkLoaded, { once: true })
              img.addEventListener('error', checkLoaded, { once: true })
            }
          })
          
          // Fallback timeout
          setTimeout(() => {
            if (loadedCount < totalImages) {
              console.warn('Some images did not load, proceeding anyway')
              resolve()
            }
          }, 5000)
        })
      }

      await waitForImages()

      // Give a moment for layout to settle
      await new Promise(resolve => setTimeout(resolve, 500))

      // Convert to canvas then PDF
      const canvas = await html2canvas(downloadContainer, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 794, // A4 width in pixels at 96 DPI (210mm)
        height: 1123, // A4 height (single page)
      })

      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      })

      const imgWidth = 210 // A4 width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const pageHeight = 297 // A4 height in mm
      
      let heightLeft = imgHeight
      let position = 0

      // Add first page
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      // Add additional pages if needed
      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }

      // Download PDF
      const fileName = `labels_${new Date().toISOString().split('T')[0]}.pdf`
      pdf.save(fileName)

      // Cleanup
      downloadContainer.remove()
      downloadStyle.remove()
      setIsPrintingAll(false)
      toast.success(`U shkarkuan me sukses ${packagesToPrint.length} etiketa si PDF`)
    } catch (error) {
      console.error('Download A4 error:', error)
      toast.error('Dështoi shkarkimi i etiketave')
      setIsPrintingAll(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 modal-enter">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto smooth-transition shadow-2xl">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img 
                src={logo || getLogoUrl()} 
                alt="Logo" 
                width="32"
                height="32"
                className="w-8 h-8 object-contain" 
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement
                  console.error('[Logo] Failed to load from Supabase Storage in Packages modal')
                  target.style.display = 'none'
                }} 
              />
              <h2 className="text-lg font-semibold text-gray-900">{t('packages.title')}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowPrintAllDialog(true)}
                disabled={packages.length === 0 || isPrintingAll}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
              >
                {isPrintingAll ? 'Printing...' : 'PRINT ALL'}
              </button>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">×</button>
            </div>
          </div>
          
          <div className="mt-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent pr-10"
                placeholder={t('packages.searchPlaceholder')}
              />
              {isLoading && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                </div>
              )}
            </div>
              <div className="flex flex-col">
                <label className="text-xs text-gray-600 mb-1 font-semibold">{t('packages.status')}:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white min-w-[180px]"
                  title={t('packages.allStatuses')}
                >
                  <option value="all">{t('packages.allStatuses')}</option>
                  <option value="just_created">{t('scanner.statuses.just_created')}</option>
                  <option value="created">{t('scanner.statuses.created')}</option>
                  <option value="queued_for_print">{t('scanner.statuses.queued_for_print')}</option>
                  <option value="printed">{t('scanner.statuses.printed')}</option>
                  <option value="handed_over">{t('scanner.statuses.handed_over')}</option>
                  <option value="in_transit">{t('scanner.statuses.in_transit')}</option>
                  <option value="at_branch">{t('scanner.statuses.at_branch')}</option>
                  <option value="delivered">{t('scanner.statuses.delivered')}</option>
                  <option value="returned">{t('scanner.statuses.returned')}</option>
                  <option value="canceled">{t('scanner.statuses.canceled')}</option>
                </select>
              </div>
            </div>
            {(searchTerm || statusFilter !== 'all') && (
              <p className="text-xs text-gray-500">
                Found {filteredPackages.length} package{filteredPackages.length !== 1 ? 's' : ''}
                {statusFilter !== 'all' && ` with status "${t(`scanner.statuses.${statusFilter}`)}"`}
              </p>
            )}
          </div>
        </div>

        <div className="p-6">
          {selectedPackage ? (
            <div className="space-y-4">
              <button
                onClick={() => setSelectedPackage(null)}
                className="text-red-600 hover:text-red-700 font-medium mb-4"
              >
                ← {t('common.back')} {t('common.to')} {t('common.list')}
              </button>
              
              <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('packages.packageDetails')}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-gray-600">{t('createLabel.packageCode')}:</span>
                      <p className="font-mono font-medium">{selectedPackage.short_code}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600 mb-2 block">{t('packages.status')}:</span>
                      <div
                        className={`px-3 py-2 text-sm font-semibold rounded-lg border-2 inline-block ${
                          selectedPackage.status === 'just_created' ? 'bg-emerald-100 text-emerald-900 border-emerald-400' :
                          selectedPackage.status === 'delivered' ? 'bg-green-100 text-green-900 border-green-400' :
                          selectedPackage.status === 'canceled' ? 'bg-red-100 text-red-900 border-red-400' :
                          selectedPackage.status === 'in_transit' ? 'bg-yellow-100 text-yellow-900 border-yellow-400' :
                          selectedPackage.status === 'at_branch' ? 'bg-purple-100 text-purple-900 border-purple-400' :
                          selectedPackage.status === 'printed' ? 'bg-indigo-100 text-indigo-900 border-indigo-400' :
                          selectedPackage.status === 'queued_for_print' ? 'bg-orange-100 text-orange-900 border-orange-400' :
                          selectedPackage.status === 'handed_over' ? 'bg-cyan-100 text-cyan-900 border-cyan-400' :
                          selectedPackage.status === 'returned' ? 'bg-pink-100 text-pink-900 border-pink-400' :
                          'bg-blue-100 text-blue-900 border-blue-400'
                        }`}
                        title="Package status (change via Admin tab)"
                      >
                        {t(`scanner.statuses.${selectedPackage.status || 'created'}`)}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Status can only be changed via Admin tab</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">{t('scanner.currentLocation')}:</span>
                      <p className="font-medium">{selectedPackage.current_location}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">{t('scanner.createdAt')}:</span>
                      <p className="font-medium">{new Date(selectedPackage.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {(() => {
                    const parsed = parsePackageContents(selectedPackage.contents_note || '')
                    return (
                      <>
                        {(parsed.name || parsed.surname || parsed.company) && (
                <div>
                            <span className="text-sm text-gray-600 font-semibold">{t('packages.recipient')}:</span>
                            <p className="font-medium">
                              {parsed.name} {parsed.surname}
                              {parsed.company && ` | ${parsed.company}`}
                            </p>
                          </div>
                        )}
                        {parsed.address && (
                          <div>
                            <span className="text-sm text-gray-600 font-semibold">{t('packages.deliveryAddress')}:</span>
                            <p className="font-medium whitespace-pre-line">{parsed.address}</p>
                          </div>
                        )}
                        {parsed.items && parsed.items.length > 0 && (
                          <div>
                            <span className="text-sm text-gray-600 font-semibold">{t('packages.contents')}:</span>
                            <p className="font-medium">
                              {parsed.items.map((item, idx) => (
                                <span key={idx}>
                                  {item.product} x{item.quantity}
                                  {idx < parsed.items.length - 1 ? ', ' : ''}
                                </span>
                              ))}
                            </p>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
                
                {selectedPackage.notes && (
                  <div>
                    <span className="text-sm text-gray-600">{t('packages.notes')}:</span>
                    <p className="font-medium whitespace-pre-line text-gray-900 bg-yellow-50 p-3 rounded-lg border border-yellow-200 mt-1">
                      {selectedPackage.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPackages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-lg">{t('packages.noPackages')}</p>
                  <p className="text-sm mt-2">{t('home.createLabelDesc')}</p>
                </div>
              ) : (
                filteredPackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    onClick={() => setSelectedPackage(pkg)}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{pkg.short_code}</div>
                      {(() => {
                        const parsed = parsePackageContents(pkg.contents_note || '')
                        return (
                          <div className="text-sm text-gray-600 space-y-1">
                            {parsed.name || parsed.surname ? (
                              <div>
                                <span className="font-semibold">{parsed.name} {parsed.surname}</span>
                                {parsed.company && <span className="text-gray-500"> | {parsed.company}</span>}
                              </div>
                            ) : null}
                            {parsed.address && (
                              <div className="text-xs">{parsed.address}</div>
                            )}
                            {parsed.items && parsed.items.length > 0 && (
                              <div className="text-xs">
                                {t('packages.contents')}: {parsed.items.map((item, idx) => `${item.product} x${item.quantity}`).join(', ')}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      {pkg.notes && (
                        <div className="text-xs text-yellow-700 bg-yellow-50 px-2 py-1 rounded mt-1 inline-block">
                          📝 {pkg.notes.substring(0, 50)}{pkg.notes.length > 50 ? '...' : ''}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(pkg.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className={`px-3 py-1 rounded-full text-sm ${getStatusColor(pkg.status)}`}>
                        {t(`scanner.statuses.${pkg.status}`)}
                      </div>
                      <button
                        onClick={(e) => printPackage(pkg, e)}
                        disabled={isPrinting && printingPackageId === pkg.id}
                        className={`flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-sm ${
                          isPrinting && printingPackageId === pkg.id ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        title={t('packages.printLabel')}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        <span>{t('packages.printLabel')}</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Printable Label - Hidden on screen, visible in print */}
      <div id="print-label-packages-modal" className="print-label-container" style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
        {/* Content will be injected dynamically */}
      </div>

      {/* Print All Dialog */}
      {showPrintAllDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-6 my-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Zgjidh Paketat për Printim</h3>
            
            {/* Search */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Kërko Paketa:
              </label>
              <input
                type="text"
                value={printSearchTerm}
                onChange={(e) => setPrintSearchTerm(e.target.value)}
                placeholder="Kërko sipas ID të paketës, emrit, mbiemrit, kompanisë ose adresës..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                disabled={isPrintingAll}
              />
              <p className="text-xs text-gray-500 mt-1">Mund të kërkoni me ID të paketës (short_code), emër, mbiemër, kompani ose adresë</p>
            </div>

            {/* Column Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Zgjidh Kolonën:
              </label>
              <select
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(Number(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                disabled={isPrintingAll}
              >
                <option value={0}>Të gjitha kolonat (1, 2, 3)</option>
                <option value={1}>Vetëm Kolona 1</option>
                <option value={2}>Vetëm Kolona 2</option>
                <option value={3}>Vetëm Kolona 3</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {selectedColumn === 0 
                  ? 'Paketat do të shpërndahen në të gjitha 3 kolonat, duke filluar nga rreshti 1'
                  : `Paketat do të printohen vertikalisht në kolonën ${selectedColumn}, duke filluar nga rreshti 1`
                }
              </p>
            </div>

            {/* Package Selection */}
            <div className="mb-4 max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700">
                  Zgjidh Paketat:
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const filtered = packages.filter(pkg => {
                        if (!printSearchTerm) return true
                        const parsed = parsePackageContents(pkg.contents_note || '')
                        const searchLower = printSearchTerm.toLowerCase().trim()
                        
                        // Search by package ID (short_code)
                        if (pkg.short_code?.toLowerCase().includes(searchLower)) return true
                        
                        // Search by name
                        const fullName = ((parsed.name || '') + ' ' + (parsed.surname || '')).trim().toLowerCase()
                        if (fullName.includes(searchLower)) return true
                        
                        // Search by individual name parts
                        if (parsed.name?.toLowerCase().includes(searchLower)) return true
                        if (parsed.surname?.toLowerCase().includes(searchLower)) return true
                        
                        // Search by company
                        if (parsed.company?.toLowerCase().includes(searchLower)) return true
                        
                        // Search by address
                        if (parsed.address?.toLowerCase().includes(searchLower)) return true
                        
                        return false
                      })
                      const allIds = new Set(filtered.map(p => p.id))
                      setSelectedPackagesForPrint(allIds)
                    }}
                    className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    disabled={isPrintingAll}
                  >
                    Zgjidh të Gjitha {printSearchTerm ? '(të filtruara)' : ''}
                  </button>
                  <button
                    onClick={() => setSelectedPackagesForPrint(new Set())}
                    className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    disabled={isPrintingAll}
                  >
                    Pastro
                  </button>
                </div>
              </div>
              
              {(() => {
                const filteredPackages = packages.filter(pkg => {
                  if (!printSearchTerm) return true
                  const parsed = parsePackageContents(pkg.contents_note || '')
                  const searchLower = printSearchTerm.toLowerCase().trim()
                  
                  // Search by package ID (short_code)
                  if (pkg.short_code?.toLowerCase().includes(searchLower)) return true
                  
                  // Search by name
                  const fullName = ((parsed.name || '') + ' ' + (parsed.surname || '')).trim().toLowerCase()
                  if (fullName.includes(searchLower)) return true
                  
                  // Search by individual name parts
                  if (parsed.name?.toLowerCase().includes(searchLower)) return true
                  if (parsed.surname?.toLowerCase().includes(searchLower)) return true
                  
                  // Search by company
                  if (parsed.company?.toLowerCase().includes(searchLower)) return true
                  
                  // Search by address
                  if (parsed.address?.toLowerCase().includes(searchLower)) return true
                  
                  return false
                })
                
                return filteredPackages.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">
                    {printSearchTerm ? 'Nuk u gjetën paketa që përputhen me kërkimin' : 'Nuk ka paketa'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredPackages.map((pkg) => {
                      const parsed = parsePackageContents(pkg.contents_note || '')
                      const isSelected = selectedPackagesForPrint.has(pkg.id)
                      return (
                        <label
                          key={pkg.id}
                          className={`flex items-start p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const newSet = new Set(selectedPackagesForPrint)
                              if (e.target.checked) {
                                newSet.add(pkg.id)
                              } else {
                                newSet.delete(pkg.id)
                              }
                              setSelectedPackagesForPrint(newSet)
                            }}
                            className="mt-1 mr-3 w-4 h-4 text-red-600 focus:ring-red-500"
                            disabled={isPrintingAll}
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900">{pkg.short_code}</div>
                            <div className="text-sm text-gray-600">
                              {((parsed.name || '') + ' ' + (parsed.surname || '')).trim() || 'N/A'}
                              {parsed.company && ` | ${parsed.company}`}
                            </div>
                            {parsed.address && (
                              <div className="text-xs text-gray-500 mt-1">{parsed.address.substring(0, 50)}...</div>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pt-4 border-t">
              <div className="text-sm text-gray-600 mb-3">
                {selectedPackagesForPrint.size > 0 ? (
                  <span className="font-semibold text-red-600">
                    {selectedPackagesForPrint.size} paketë{selectedPackagesForPrint.size !== 1 ? 'a' : ''} e zgjedhur {
                      selectedColumn === 0 
                        ? 'për të gjitha kolonat (1, 2, 3)'
                        : `për kolonën ${selectedColumn}`
                    }
                  </span>
                ) : (
                  <span className="text-gray-500">Ju lutemi zgjidhni të paktën një paketë</span>
                )}
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={printAllThermal}
                  disabled={isPrintingAll || selectedPackagesForPrint.size === 0}
                  className="px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
                >
                  Printer Termik (58mm x 40mm)
                </button>
                
                <button
                  onClick={printAllA4}
                  disabled={isPrintingAll || selectedPackagesForPrint.size === 0}
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
                >
                  Printer A4 (7cm x 30mm)
                </button>
                
                <button
                  onClick={downloadAllA4}
                  disabled={isPrintingAll || selectedPackagesForPrint.size === 0}
                  className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
                >
                  Shkarko PDF A4
                </button>
              </div>
              
              <button
                onClick={() => {
                  setShowPrintAllDialog(false)
                  setSelectedPackagesForPrint(new Set())
                  setSelectedColumn(0) // Reset to all columns
                  setPrintSearchTerm('')
                }}
                disabled={isPrintingAll}
                className="w-full px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold rounded-lg transition-colors"
              >
                Anulo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Styles - Same as CreateLabelModal */}
      <style>{`
        .print-label-container {
          position: absolute;
          left: -9999px;
          top: -9999px;
          width: 58mm;
          height: 40mm;
        }

        @media print {
          /* Force hide everything */
          * {
            margin: 0 !important;
            padding: 0 !important;
          }

          body * {
            visibility: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          #print-label-packages-modal,
          #print-label-packages-modal * {
            visibility: visible !important;
          }

          #print-label-packages-modal {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 58mm !important;
            height: 40mm !important;
            max-width: 58mm !important;
            max-height: 40mm !important;
            background: white !important;
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 9999 !important;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
            page-break-before: avoid !important;
          }

          @page {
            size: 58mm 40mm;
            margin: 0 !important;
            padding: 0 !important;
          }

          html, body {
            width: 58mm !important;
            height: 40mm !important;
            max-width: 58mm !important;
            max-height: 40mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: white !important;
            page-break-after: avoid !important;
            page-break-before: avoid !important;
          }

          /* Main Label Container - SIMPLE FUNCTIONAL DESIGN */
          .shipping-label {
            width: 58mm !important;
            height: 40mm !important;
            max-width: 58mm !important;
            max-height: 40mm !important;
            padding: 0.5mm !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            margin: 0 !important;
            background: #ffffff !important;
            color: #000 !important;
            position: relative !important;
            border: 0.2mm solid #000000 !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            page-break-after: avoid !important;
          }

          /* Left Section - Logo & Content */
          .label-left-section {
            display: flex !important;
            flex-direction: column !important;
            padding: 0 !important;
            margin: 0 !important;
            flex: 1 !important;
            min-width: 0 !important;
            height: 100% !important;
          }

          /* Logo Section - Simple Top Bar - ALWAYS VISIBLE */
          .logo-section {
            background: #000000 !important;
            padding: 0.8mm !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
            height: 6mm !important;
            max-height: 6mm !important;
            min-height: 6mm !important;
            visibility: visible !important;
            opacity: 1 !important;
          }

          .logo {
            max-height: 5mm !important;
            max-width: 90% !important;
            width: auto !important;
            height: auto !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            object-fit: contain !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
            filter: brightness(0) invert(1) !important;
          }
          
          .logo[src=""],
          .logo:not([src]) {
            display: none !important;
          }

          .logo-separator {
            display: none !important;
          }

          /* Tracking Code Section - Simple */
          .tracking-code-section {
            padding: 0.5mm !important;
            background: #ffffff !important;
            border-bottom: 0.2mm solid #000000 !important;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            flex-shrink: 0 !important;
            gap: 0.5mm !important;
            min-height: 3mm !important;
          }

          .tracking-label {
            font-size: 1.5pt !important;
            font-weight: 700 !important;
            color: #000000 !important;
            text-transform: uppercase !important;
            font-family: 'Arial', sans-serif !important;
            margin: 0 !important;
            white-space: nowrap !important;
            line-height: 1.2 !important;
          }

          .tracking-code {
            font-size: 5pt !important;
            font-weight: 800 !important;
            letter-spacing: 0.8px !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            text-transform: uppercase !important;
            font-family: 'Courier New', 'Monaco', monospace !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
            display: inline-block !important;
            flex: 1 !important;
            text-align: right !important;
          }

          /* Main Content Section - Recipient Info */
          .recipient-section {
            display: flex !important;
            flex-direction: column !important;
            padding: 1mm !important;
            gap: 0.5mm !important;
            flex: 1 !important;
            justify-content: flex-start !important;
            background: #ffffff !important;
            position: relative !important;
            min-height: 0 !important;
            overflow: hidden !important;
          }

          /* Beneficiary Name - BIGGEST & BOLDEST */
          .recipient-name {
            font-weight: 800 !important;
            font-size: 10pt !important;
            margin: 0 !important;
            padding: 0 !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.3px !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            flex-shrink: 0 !important;
          }

          /* Company Name - MEDIUM */
          .company-name {
            font-weight: 600 !important;
            font-size: 7pt !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.2px !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .company-name::before {
            display: none !important;
          }

          /* Address - READABLE */
          .address-text {
            font-size: 5pt !important;
            color: #000000 !important;
            line-height: 1.3 !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            font-weight: 400 !important;
            font-family: 'Arial', sans-serif !important;
            margin: 0 !important;
            padding: 0 !important;
            letter-spacing: 0.1px !important;
          }

          .address-text::before {
            display: none !important;
          }

          /* QR Code Section - BIG & READABLE */
          .label-right-section {
            position: absolute !important;
            right: 0.5mm !important;
            bottom: 0.5mm !important;
            width: 16mm !important;
            height: 16mm !important;
            max-width: 16mm !important;
            max-height: 16mm !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: #ffffff !important;
            border: 0.2mm solid #000000 !important;
            padding: 0.5mm !important;
            box-sizing: border-box !important;
          }

          /* QR Code - Clear and scannable */
          .qr-code {
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            display: block !important;
            object-fit: contain !important;
            border: none !important;
            padding: 0 !important;
            background: transparent !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }

          /* Items List - Very Compact */
          .items-list {
            font-size: 2.2pt !important;
            color: #000000 !important;
            line-height: 1.2 !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            font-weight: 400 !important;
          }

          .items-list div {
            margin-bottom: 0.05mm !important;
            line-height: 1.2 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}

// Home View Component
function HomeView({ onViewChange }: { onViewChange: (view: string) => void }) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const cards = [
    {
      id: 'create',
      title: t('home.createLabel'),
      description: t('home.createLabelDesc'),
      color: 'bg-red-500',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      id: 'transfer',
      title: t('home.transfer'),
      description: t('home.transferDesc'),
      color: 'bg-red-500',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      )
    },
    {
      id: 'scan',
      title: t('home.scanUpdate'),
      description: t('home.scanUpdateDesc'),
      color: 'bg-red-500',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
      )
    },
    {
      id: 'packages',
      title: t('home.packages'),
      description: t('home.packagesDesc'),
      color: 'bg-red-500',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      )
    },
    {
      id: 'inventory',
      title: t('home.inventory'),
      description: t('home.inventoryDesc'),
      color: 'bg-red-500',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
    {
      id: 'admin',
      title: t('home.admin'),
      description: t('home.adminDesc'),
      color: 'bg-red-500',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    }
  ]

  return (
    <div className="p-6">
      <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {t('home.welcome', { name: user?.name || 'User' })}
        </h1>
        <p className="text-gray-600">
          {t('home.choose')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div
            key={card.id}
            onClick={() => onViewChange(card.id)}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 hover:shadow-lg transition-all duration-200 cursor-pointer hover:border-red-200"
          >
            <div className="flex items-center mb-4">
              <div className={`${card.color} p-3 rounded-xl text-white mr-4`}>
                {card.icon}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {card.title}
                </h3>
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              {card.description}
            </p>
          </div>
        ))}
      </div>

    </div>
  )
}

// Navigation Component
function Navigation({ currentView, onViewChange, onLogout }: { 
  currentView: string, 
  onViewChange: (view: string) => void,
  onLogout: () => void 
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const navItems = [
    { id: 'home', label: t('nav.home'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: 'create', label: t('nav.create'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )},
    { id: 'transfer', label: t('nav.transfer'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    )},
    { id: 'scan', label: t('nav.scan'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
      </svg>
    )},
    { id: 'packages', label: t('nav.packages'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    )},
    { id: 'inventory', label: t('nav.inventory'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
    ...(user?.role === 'admin' ? [{ id: 'admin', label: t('nav.admin'), icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )}] : [])
  ]

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex md:flex-col md:w-64 md:bg-white md:border-r md:border-gray-200 md:h-screen">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center mb-4">
              <img 
                src={getLogoUrl()} 
                alt="Sigma Logo" 
                width="32"
                height="32"
                className="w-8 h-8 mr-3 object-contain"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement
                  console.error('[Logo] Navigation logo failed from Supabase Storage:', target.src)
                  // Hide on error - no fallback to avoid 404s on Vercel
                  target.style.display = 'none'
                }}
                onLoad={() => console.log('[Logo] Navigation logo loaded')}
              />
            <h1 className="text-xl font-bold text-gray-900">Sigma Shpërndarje</h1>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <span>{user?.name || 'User'}</span>
            <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
              user?.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
            }`}>
              {user?.role || 'user'}
            </span>
          </div>
        </div>

        <div className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                    currentView === item.id
                      ? 'bg-red-50 text-red-700 border-r-2 border-red-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {item.icon}
                  <span className="ml-3">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 border-t border-gray-200">
          <button 
            onClick={onLogout}
            className="w-full flex items-center px-4 py-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="ml-3">{t('nav.logout')}</span>
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="flex justify-around">
          {navItems.slice(0, 4).map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`flex flex-col items-center py-2 px-1 text-xs ${
                currentView === item.id ? 'text-red-600' : 'text-gray-500'
              }`}
            >
              <div className="w-6 h-6 mb-1">{item.icon}</div>
              <span>{item.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <img 
              src={getLogoUrl()} 
              alt="Sigma Logo" 
              width="24"
              height="24"
              className="w-6 h-6 mr-2 object-contain"
              onError={(e) => {
                const target = e.currentTarget as HTMLImageElement
                console.error('[Logo] Mobile header logo failed from Supabase Storage:', target.src)
                // Hide on error - no fallback to avoid 404s on Vercel
                target.style.display = 'none'
              }}
              onLoad={() => console.log('[Logo] Mobile header logo loaded')}
            />
          </div>
          <button onClick={onLogout} className="p-2 text-gray-600 hover:text-gray-900">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>
    </>
  )
}

function App() {
  const location = useLocation()
  const [currentView, setCurrentView] = useState('home')
  const [showCreateLabel, setShowCreateLabel] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  const [showPackages, setShowPackages] = useState(false)

  // If we're on the tracking page, render it directly
  if (location.pathname.startsWith('/track/')) {
    return (
      <>
        <Routes>
          <Route path="/track/:code" element={<PackageTracking />} />
        </Routes>
        <Toaster position="top-center" />
      </>
    )
  }

  const handleViewChange = (view: string) => {
    // Check admin access before setting view
    if (view === 'admin' && user?.role !== 'admin') {
      toast.error('Access denied. Only administrators can access the Admin section.')
      return
    }
    
    setCurrentView(view)
    
    switch (view) {
      case 'create':
        setShowCreateLabel(true)
        break
      case 'transfer':
        setShowTransfer(true)
        break
      case 'scan':
        setShowScanner(true)
        break
      case 'packages':
        setShowPackages(true)
        break
      case 'inventory':
        setShowInventory(true)
        break
      case 'admin':
        if (user?.role === 'admin') {
          setShowSettings(true)
        } else {
          toast.error('Access denied. Only administrators can access the Admin section.')
        }
        break
      default:
        break
    }
  }

  const { user, isLoading: authLoading, logout } = useAuth()

  const handleLogout = () => {
    logout()
    setCurrentView('home')
    setShowCreateLabel(false)
    setShowTransfer(false)
    setShowScanner(false)
    setShowSettings(false)
    setShowInventory(false)
    setShowPackages(false)
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Check if Supabase is configured
  const isSupabaseConfigured = supabaseUrl && 
                                supabaseUrl !== 'https://placeholder.supabase.co' && 
                                supabaseUrl !== 'undefined' &&
                                supabaseKey && 
                                supabaseKey !== 'placeholder-anon-key' &&
                                supabaseKey !== 'undefined'
  
  if (!isSupabaseConfigured) {
    // Log diagnostic info
    console.error('[DIAGNOSTIC] Supabase Configuration Check Failed')
    console.error('[DIAGNOSTIC] supabaseUrl:', supabaseUrl, 'Type:', typeof supabaseUrl)
    console.error('[DIAGNOSTIC] supabaseKey:', supabaseKey ? `${supabaseKey.substring(0, 20)}...` : 'undefined', 'Type:', typeof supabaseKey)
    console.error('[DIAGNOSTIC] import.meta.env keys:', Object.keys(import.meta.env).filter(k => k.includes('SUPABASE')))
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-2xl p-8 bg-white rounded-lg shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-red-600 mb-4">Configuration Error</h1>
          <p className="text-gray-700 mb-4">
            Supabase environment variables are not configured or not accessible.
          </p>
          
          <div className="text-left text-sm bg-gray-50 p-4 rounded mb-4 border border-gray-200">
            <p className="font-semibold mb-2">Diagnostic Information:</p>
            <ul className="space-y-1 text-gray-700">
              <li>• URL Value: <code className="bg-gray-200 px-1 rounded">{supabaseUrl || 'undefined'}</code></li>
              <li>• Key Value: <code className="bg-gray-200 px-1 rounded">{supabaseKey ? `${supabaseKey.substring(0, 20)}...` : 'undefined'}</code></li>
              <li>• Check browser console (F12) for detailed diagnostic logs</li>
            </ul>
          </div>
          
          <div className="text-left text-sm text-gray-600 bg-blue-50 p-4 rounded mb-4 border border-blue-200">
            <p className="font-semibold mb-2 text-blue-900">Fix Steps:</p>
            <ol className="list-decimal list-inside space-y-2">
              <li>Go to <strong>Vercel Dashboard</strong> → Your Project → <strong>Settings</strong> → <strong>Environment Variables</strong></li>
              <li>Add these variables with <strong>EXACT</strong> names (case-sensitive):
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li><code className="bg-blue-100 px-1 rounded">VITE_SUPABASE_URL</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code></li>
                </ul>
              </li>
              <li>For each variable, enable <strong>all three</strong> environments:
                <ul className="list-disc list-inside ml-4 mt-1">
                  <li>✅ Production</li>
                  <li>✅ Preview</li>
                  <li>✅ Development</li>
                </ul>
              </li>
              <li><strong>Clear Build Cache:</strong> Settings → General → Scroll down → "Clear Build Cache"</li>
              <li><strong>Redeploy:</strong> Deployments → Latest → ⋯ → Redeploy (uncheck "Use existing Build Cache")</li>
            </ol>
          </div>
          
          <p className="text-xs text-gray-500 mt-4">
            Note: Environment variables must start with <code className="bg-gray-200 px-1 rounded">VITE_</code> for Vite to expose them.
            After setting variables in Vercel, you <strong>must redeploy</strong> for changes to take effect.
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <>
        <PinLogin onSuccess={() => {
          // User will be set by AuthProvider after successful login
        }} />
        <Toaster position="top-center" />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Language Switcher - Fixed Top Right */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>
      
      {/* Desktop Layout */}
      <div className="hidden md:flex">
        <Navigation currentView={currentView} onViewChange={handleViewChange} onLogout={handleLogout} />
        <main className="flex-1 overflow-y-auto">
          <HomeView onViewChange={handleViewChange} />
        </main>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden">
        <Navigation currentView={currentView} onViewChange={handleViewChange} onLogout={handleLogout} />
        <main className="pb-20">
          <HomeView onViewChange={handleViewChange} />
        </main>
      </div>

      {/* Modals */}
      {showCreateLabel && (
        <CreateLabelModal onClose={() => setShowCreateLabel(false)} />
      )}

      {showTransfer && (
        <TransferModal onClose={() => setShowTransfer(false)} />
      )}

      {showScanner && (
        <ScannerModal onClose={() => setShowScanner(false)} />
      )}

      {showSettings && (
        <AdminModal onClose={() => setShowSettings(false)} />
      )}

      {showInventory && (
        <InventoryModal onClose={() => setShowInventory(false)} />
      )}

      {showPackages && (
        <PackagesModal onClose={() => setShowPackages(false)} />
      )}

      <Toaster 
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#363636',
            color: '#fff',
          },
        }}
      />
    </div>
  )
}



export default App