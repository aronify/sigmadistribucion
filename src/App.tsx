import React, { useState, useEffect, useRef } from 'react'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { useAuth } from './lib/auth'
import { supabase, getLogoUrl } from './lib/supabase'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { BarcodeScanner } from './components/BarcodeScanner'
import LanguageSwitcher from './components/LanguageSwitcher'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'

// Logo utility function - converts image to base64 for reliable printing
// Uses Supabase Storage URL first, then falls back to local
const loadLogoAsBase64 = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    // Only try Supabase Storage URL - no local fallbacks to avoid 404s on Vercel
    const logoPaths = [
      getLogoUrl() // Supabase Storage URL
    ]
    
    let currentPathIndex = 0
    
    const tryNextPath = () => {
      if (currentPathIndex >= logoPaths.length) {
        console.warn('[Logo] No logo paths worked, returning null')
        resolve(null)
        return
      }
      
      const path = logoPaths[currentPathIndex]
      console.log(`[Logo] Trying path: ${path}`)
      img.src = path
      
      img.onload = () => {
        console.log(`[Logo] Successfully loaded from: ${path}`)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0)
            const base64 = canvas.toDataURL('image/png')
            console.log('[Logo] Converted to base64 successfully')
            resolve(base64)
          } else {
            console.warn('[Logo] Could not get canvas context')
            tryNextPath()
          }
        } catch (error) {
          console.warn('[Logo] Failed to convert logo to base64:', error)
          tryNextPath()
        }
      }
      
      img.onerror = (e) => {
        console.warn(`[Logo] Failed to load from: ${path}`)
        currentPathIndex++
        tryNextPath()
      }
    }
    
    tryNextPath()
  })
}

// Preload logo and cache it
// Uses Supabase Storage URL first, then falls back to local
let logoCache: string | null = null
const preloadLogo = async (): Promise<string> => {
  if (logoCache) {
    return logoCache
  }
  
  // Try Supabase Storage URL first
  const supabaseLogoUrl = getLogoUrl()
  
  try {
    console.log(`[Logo] Attempting to load from Supabase Storage: ${supabaseLogoUrl}`)
    const response = await fetch(supabaseLogoUrl, { 
      cache: 'no-cache',
      mode: 'cors'
    })
    
    if (response.ok) {
      const blob = await response.blob()
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      logoCache = base64
      console.log(`[Logo] ✓ Successfully preloaded from Supabase Storage`)
      return base64
    } else {
      console.warn(`[Logo] HTTP ${response.status} for Supabase Storage, trying local fallback`)
    }
  } catch (error) {
    console.warn(`[Logo] Failed to preload from Supabase Storage:`, error)
  }
  
  // No local fallback - only use Supabase Storage to avoid 404s on Vercel
  // Return the Supabase Storage URL directly
  console.log('[Logo] Using Supabase Storage URL')
  return supabaseLogoUrl
}

// Get Supabase URL and key for environment check
// @ts-ignore - Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
// @ts-ignore - Vite environment variables
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// Simple PIN Login Component with barcode/keyboard support
function PinLogin({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAuth()
  const [pin, setPin] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [logo, setLogo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus input on mount for keyboard support
    if (inputRef.current) {
      inputRef.current.focus()
    }
    
    // Use Supabase Storage URL for logo
    const logoUrl = getLogoUrl()
    setLogo(logoUrl)
    
    // Logo is now always from Supabase Storage, no need to listen for updates
  }, [])

  const handleSubmit = async () => {
    if (pin.length !== 6) return
    
    setIsLoading(true)
    
    try {
      // Use auth context login which validates active users
      const success = await login(pin)
      
      if (success) {
        setPin('')
        onSuccess()
      } else {
        setPin('')
      }
    } catch (error) {
      console.error('Login error:', error)
      setIsLoading(false)
      setPin('')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    e.preventDefault() // Prevent default behavior to avoid double entry
    if (e.key === 'Enter') {
      handleSubmit()
    } else if (e.key === 'Backspace') {
      setPin(prev => prev.slice(0, -1))
    } else if (e.key >= '0' && e.key <= '9' && pin.length < 6) {
      setPin(prev => prev + e.key)
    }
  }

  const handleBarcodeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    // If it looks like a barcode (longer than 6 digits), extract PIN
    if (value.length > 6) {
      // Extract last 6 digits as PIN
      const extractedPin = value.slice(-6)
      setPin(extractedPin)
      handleSubmit()
    } else if (value.length <= 6) {
      setPin(value)
    }
  }

  const numbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mb-4">
            <img 
              src={logo || getLogoUrl()} 
              alt="Company Logo" 
              width="80"
              height="80"
              className="w-20 h-20 mx-auto object-contain"
              onError={(e) => {
                const target = e.currentTarget as HTMLImageElement
                console.error('[Logo] Failed to load logo from Supabase Storage:', target.src)
                // Hide on error - no fallback to avoid 404s on Vercel
                target.style.display = 'none'
              }}
              onLoad={() => {
                console.log('[Logo] Logo loaded successfully from:', logo || getLogoUrl())
              }}
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Sigma Shpërndarje</h1>
          <p className="text-gray-600">Enter your PIN to continue</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          {/* Hidden input for barcode scanning */}
          <input
            ref={inputRef}
            type="text"
            value={pin}
            onChange={handleBarcodeInput}
            onKeyDown={handleKeyPress}
            className="sr-only"
            placeholder="Scan barcode or type PIN"
          />
          
          <div className="text-center mb-6">
            <div className="flex justify-center space-x-2 mb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 ${
                    i < pin.length 
                      ? 'bg-red-600 border-red-600' 
                      : 'border-gray-300'
                  }`}
                />
              ))}
            </div>
            <p className="text-sm text-gray-500">
              Enter your 6-digit PIN or scan barcode
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
            {numbers.map((num) => (
              <button
                key={num}
                onClick={() => setPin(prev => prev + num)}
                disabled={pin.length >= 6 || isLoading}
                className="aspect-square bg-white border-2 border-gray-300 rounded-xl text-2xl font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {num}
              </button>
            ))}
            <button
              onClick={() => setPin('')}
              disabled={pin.length === 0 || isLoading}
              className="aspect-square bg-white border-2 border-gray-300 rounded-xl text-2xl font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
            >
              Clear
            </button>
            <button
              onClick={() => setPin(prev => prev.slice(0, -1))}
              disabled={pin.length === 0 || isLoading}
              className="aspect-square bg-white border-2 border-gray-300 rounded-xl text-2xl font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
            >
              ⌫
            </button>
          </div>

          <div className="mt-6">
            <button
              onClick={handleSubmit}
              disabled={pin.length !== 6 || isLoading}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// Create Label Modal with proper fields
function CreateLabelModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
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
              address ? `Address: ${address}` : '',
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

            // Create inventory movements linked to actual package IDs
            const movementsToInsert: any[] = []
            for (let pkgIdx = 0; pkgIdx < createdPackages.length; pkgIdx++) {
              const pkg = createdPackages[pkgIdx]
              const originalPkg = packageInserts[pkgIdx]
              const shortCode = pkg.short_code
              
              // Create movements for each item in this package
              for (const product of originalPkg._items || []) {
                const item = inventoryItems.find(i => i.id === product.productId)
                if (item) {
                  movementsToInsert.push({
                    item_id: item.id,
                    delta: -product.quantity,
                    reason: `Package ${shortCode} created`,
                    ref_package_id: pkg.id,
                    user_id: userId
                  })
                }
              }
            }

            // Batch insert inventory movements
            if (movementsToInsert.length > 0) {
              await supabase
                .from('inventory_movements')
                .insert(movementsToInsert)
            }

            // Update inventory stock (batch update each unique item)
            const uniqueItems = new Map<string, { item: any; totalDelta: number }>()
            for (const update of inventoryUpdates) {
              const existing = uniqueItems.get(update.itemId)
              if (existing) {
                existing.totalDelta += update.delta
              } else {
                uniqueItems.set(update.itemId, { item: update.item, totalDelta: update.delta })
              }
            }

            // Apply inventory updates
            for (const [itemId, { item, totalDelta }] of uniqueItems) {
              await supabase
                .from('inventory_items')
                .update({ stock_on_hand: item.stock_on_hand + totalDelta })
                .eq('id', itemId)
            }
          }
        }

        // Update progress
        setBulkImportProgress({ current: Math.min(i + BATCH_SIZE, dataRows.length), total: dataRows.length })
      }

      // Refresh inventory data
      await loadInventoryItems()
      window.dispatchEvent(new Event('inventory-updated'))

      setIsBulkImporting(false)
      
      // Show results
      if (successCount > 0) {
        toast.success(`Successfully created ${successCount} package(s)!`, { duration: 5000 })
      }
      if (errorCount > 0) {
        toast.error(`Failed to create ${errorCount} package(s). Check console for details.`, { duration: 5000 })
        console.error('Import errors:', errors)
      }
      if (errors.length > 0 && errors.length <= 10) {
        errors.forEach(err => console.error(err))
      }

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
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not get canvas context')

      // Generate QR code with package short_code
      const qrCodeData = pkg.short_code || pkg.id
      
      await QRCode.toCanvas(canvas, qrCodeData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })

      const dataUrl = canvas.toDataURL('image/png')
      setBarcodeDataUrl(dataUrl)
      console.log('QR code generated for:', qrCodeData)
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

    // Preload logo as base64 for reliable printing
    const logoBase64 = await loadLogoAsBase64()
    if (logoBase64 && printRef.current) {
      const logoImg = printRef.current.querySelector('.logo') as HTMLImageElement
      if (logoImg) {
        logoImg.src = logoBase64
      }
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

        console.log('Calling window.print()')
        window.print()
        
        setTimeout(() => {
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
          contents_note: `To: ${formData.name} ${formData.surname}${formData.company ? ` (${formData.company})` : ''}\nItems: ${formData.items.map(i => `${i.product} x${i.quantity}`).join(', ')}`,
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
            <h2 className="text-lg font-semibold text-gray-900">Create Label</h2>
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
                  Manual Entry
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
                  Import from Excel
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
                <h3 className="text-lg font-medium text-gray-900">Import from Excel</h3>
                <p className="text-sm text-gray-600">Upload an Excel file to populate the form</p>
              </div>

              <div>
                <label className="block w-full">
                  <div className="flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-red-500 hover:bg-red-50 cursor-pointer transition-colors">
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">Choose Excel File</span>
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelImport}
                    className="hidden"
                  />
                </label>
                <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs font-semibold text-gray-700 mb-1">Excel Format Required:</p>
                  <p className="text-xs text-gray-600">
                    Columns: <span className="font-mono">Beneficiary</span> | <span className="font-mono">Company</span> | <span className="font-mono">Address</span> | <span className="font-mono">Products</span> | <span className="font-mono">Notes</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Products column: SKUs separated by semicolons (e.g., <span className="font-mono">6; 5; 9</span>)
                  </p>
                </div>
              </div>

              {/* Bulk import progress */}
              {isBulkImporting && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-semibold text-blue-800 mb-2">Processing bulk import...</p>
                  <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${(bulkImportProgress.current / bulkImportProgress.total) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-blue-700 text-center">
                    {bulkImportProgress.current} of {bulkImportProgress.total} rows processed
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
                <h3 className="text-lg font-medium text-gray-900">Recipient Information</h3>
                <p className="text-sm text-gray-600">Enter recipient details</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Surname *</label>
                  <input
                    type="text"
                    value={formData.surname}
                    onChange={(e) => setFormData({...formData, surname: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="Last name"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({...formData, company: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Company name"
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
                <h3 className="text-lg font-medium text-gray-900">Delivery Address</h3>
                <p className="text-sm text-gray-600">Enter delivery address</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  rows={3}
                  placeholder="Street address, city, postal code"
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
                <h3 className="text-lg font-medium text-gray-900">Products</h3>
                <p className="text-sm text-gray-600">Select products and quantities</p>
              </div>

              
              {/* Selected Products Summary */}
              {formData.items.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Selected Products:</h4>
                  <div className="space-y-2">
                    {formData.items.map((item) => {
                      const inventoryItem = inventoryItems.find(i => i.id === item.productId)
                      return (
                        <div key={item.productId} className="flex items-center justify-between bg-white rounded-lg p-3">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{item.product}</div>
                            {inventoryItem && (
                              <div className="text-xs text-gray-500">SKU: {inventoryItem.sku} • Available: {inventoryItem.stock_on_hand} {inventoryItem.unit}</div>
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
                              title="Remove"
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
                        <div className="text-sm text-gray-600">SKU: {item.sku} • Stock: {item.stock_on_hand} {item.unit}</div>
                        {isSelected && (
                          <div className="mt-2 text-xs text-red-600 font-semibold">Selected: {selectedQty}</div>
                        )}
                        {item.stock_on_hand <= item.min_threshold && (
                          <div className="mt-2 text-xs text-orange-600 font-medium">⚠️ Low Stock</div>
                        )}
                      </button>
                    )
                  })}
              </div>

              {inventoryItems.filter(item => item.stock_on_hand > 0).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>No products available in inventory</p>
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
                <h3 className="text-lg font-medium text-gray-900">Label Created!</h3>
                <p className="text-sm text-gray-600">Review details and print label</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                {createdPackage && (
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-gray-600">Package ID:</span>
                    <span className="text-sm font-mono font-bold">{createdPackage.short_code}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Recipient:</span>
                  <span className="text-sm font-medium">{formData.name} {formData.surname}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Company:</span>
                  <span className="text-sm font-medium">{formData.company || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Address:</span>
                  <span className="text-sm font-medium">{formData.address}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">Products:</span>
                  {formData.items.length > 0 ? (
                    formData.items.map((item, idx) => (
                      <span key={idx} className="text-sm font-medium">{item.product} x {item.quantity}</span>
                    ))
                  ) : (
                    <span className="text-sm font-medium">No products</span>
                  )}
                </div>
              </div>
              <button
                onClick={handlePrintLabel}
                disabled={isPrinting || !createdPackage}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50"
              >
                {isPrinting ? 'Preparing Print...' : 'Print Label'}
              </button>
            </div>
          )}

          <div className="flex justify-between mt-6">
            {step > 1 && step < 4 && (
              <button
                onClick={() => setStep(step - 1)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-6 rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            
            {step < 3 && (
              <button
                onClick={handleNext}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors ml-auto"
              >
                Next
              </button>
            )}

            {step === 3 && formData.items.length > 0 && (
              <button
                onClick={handleCreate}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors ml-auto"
              >
                Review & Create
              </button>
            )}

            {step === 4 && (
              <button
                onClick={onClose}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-6 rounded-lg transition-colors"
              >
                Close
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
                  src={getLogoUrl()} 
                  alt="Sigma Logo" 
                  className="logo" 
                  onError={(e) => {
                    const target = e.currentTarget as HTMLImageElement
                    console.error('[Logo] Failed to load from Supabase Storage in print label')
                    target.style.display = 'none'
                  }}
                />
              </div>
              
              <div className="tracking-code-section">
                <div className="tracking-label">TRACKING</div>
                <div className="tracking-code">{createdPackage.short_code}</div>
              </div>

              <div className="recipient-section">
                <div className="recipient-name">{formData.name} {formData.surname}</div>
                {formData.company && <div className="company-name">{formData.company}</div>}
                <div className="address-text">{formData.address}</div>
              </div>
            </div>

            <div className="label-right-section">
              <img src={barcodeDataUrl} alt="QR Code" className="qr-code" />
              <div className="qr-label">Scan to Track</div>
            </div>
          </div>
        ) : (
          <div className="shipping-label">
            <div className="tracking-code">Loading...</div>
          </div>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        /* Hide printable label on screen */
        #print-label {
          position: absolute;
          left: -9999px;
          top: -9999px;
          width: 50mm;
          height: 30mm;
        }

        /* Print styles - 50mm x 30mm thermal label (landscape/horizontal) */
        @media print {
          /* Force hide everything */
          body * {
            visibility: hidden !important;
          }

          /* Show only the label and its children */
          #print-label,
          #print-label * {
            visibility: visible !important;
          }

          #print-label {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 50mm !important;
            height: 30mm !important;
            background: white !important;
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 9999 !important;
          }

          /* 50mm x 30mm horizontal thermal label */
          @page {
            size: 50mm 30mm landscape;
            margin: 0;
          }

          html, body {
            width: 50mm !important;
            height: 30mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: white !important;
          }

          /* Main Label Container - Modern Sleek Design */
          .shipping-label {
            width: 50mm !important;
            height: 30mm !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: row !important;
            margin: 0 !important;
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%) !important;
            color: #000 !important;
            position: relative !important;
            border: 0.5mm solid #e5e7eb !important;
            overflow: hidden !important;
          }

          /* Left Section - Logo, Tracking, Recipient */
          .label-left-section {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            padding: 1.2mm !important;
            justify-content: space-between !important;
            min-width: 0 !important;
          }

          /* Logo Section */
          .logo-section {
            margin-bottom: 1mm !important;
          }

          .logo {
            max-height: 6mm !important;
            max-width: 100% !important;
            width: auto !important;
            height: auto !important;
            display: block !important;
            object-fit: contain !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }

          /* Tracking Code Section - Smallest */
          .tracking-code-section {
            margin-bottom: 1mm !important;
          }

          .tracking-label {
            font-size: 3.5pt !important;
            font-weight: 500 !important;
            color: #9ca3af !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            margin-bottom: 0.2mm !important;
            font-family: 'Arial', sans-serif !important;
          }

          .tracking-code {
            font-size: 5.5pt !important;
            font-weight: 600 !important;
            letter-spacing: 1px !important;
            color: #6b7280 !important;
            line-height: 1.2 !important;
            text-transform: uppercase !important;
            font-family: 'Courier New', 'Monaco', monospace !important;
            padding: 0.4mm 0.6mm !important;
            border-radius: 1mm !important;
            border: 0.3mm solid #e5e7eb !important;
            background: #f9fafb !important;
            display: inline-block !important;
          }

          /* Recipient Section */
          .recipient-section {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: flex-start !important;
          }

          /* Recipient Name - BIGGEST */
          .recipient-name {
            font-weight: 900 !important;
            font-size: 11pt !important;
            margin-bottom: 0.5mm !important;
            color: #111827 !important;
            line-height: 1.1 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
          }

          /* Company Name - Medium/Smaller */
          .company-name {
            font-weight: 600 !important;
            font-size: 7pt !important;
            margin-bottom: 0.4mm !important;
            color: #4b5563 !important;
            line-height: 1.2 !important;
            font-style: normal !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
          }

          .address-text {
            font-size: 5pt !important;
            color: #374151 !important;
            line-height: 1.3 !important;
            word-wrap: break-word !important;
            font-weight: 400 !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
          }

          /* Right Section - Large QR Code */
          .label-right-section {
            width: 20mm !important;
            height: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%) !important;
            border-left: 0.5mm dashed #d1d5db !important;
            padding: 1mm !important;
            box-sizing: border-box !important;
          }

          /* QR Code - Large and Prominent */
          .qr-code {
            width: 18mm !important;
            height: 18mm !important;
            display: block !important;
            flex-shrink: 0 !important;
            border: 0.5mm solid #111827 !important;
            padding: 1mm !important;
            background: white !important;
            border-radius: 1mm !important;
            box-shadow: 0 0.5mm 1mm rgba(0, 0, 0, 0.1) !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }

          .qr-label {
            font-size: 4.5pt !important;
            font-weight: 600 !important;
            color: #6b7280 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.8px !important;
            margin-top: 0.8mm !important;
            font-family: 'Arial', sans-serif !important;
          }

          /* Items List - Compact and readable */
          .items-list {
            font-size: 5.5pt !important;
            color: #111827 !important;
            line-height: 1.3 !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            font-weight: 500 !important;
          }

          .items-list div {
            margin-bottom: 0.2mm !important;
            line-height: 1.3 !important;
            padding: 0.2mm 0 !important;
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
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
              <p className="text-gray-600 mb-4">Only administrators can access this section.</p>
              <button
                onClick={onClose}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
              >
                Close
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
    contents_note: '',
    destination_branch_id: '',
    current_location: '',
    status: 'created' as any
  })
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
        .limit(100)
      
      if (error) throw error
      setPackages(data || [])
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
    setPackageFormData({
      contents_note: pkg.contents_note || '',
      destination_branch_id: pkg.destination_branch_id || '',
      current_location: pkg.current_location || '',
      status: pkg.status || 'created'
    })
  }

  const handleSavePackage = async () => {
    if (!editingPackage) return
    
    try {
      const oldStatus = editingPackage.status
      const newStatus = packageFormData.status

      const updateData: any = {
        contents_note: packageFormData.contents_note.trim(),
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
              <h2 className="text-lg font-semibold text-gray-900">Admin</h2>
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
              Users
            </button>
            <button
              onClick={() => setActiveTab('packages')}
              className={`px-4 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'packages' ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Packages
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`px-4 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'products' ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Products
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'audit' ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Audit Log
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-medium text-gray-900">User Management</h3>
                <button
                  onClick={() => setShowAddUser(true)}
                  className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  + Add User
                </button>
              </div>

              {showAddUser && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
                    <input
                      type="text"
                      value={newUser.pin}
                      onChange={(e) => setNewUser({...newUser, pin: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="6-digit PIN"
                      maxLength={6}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    >
                      <option value="standard">Standard</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleAddUser}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Add User
                    </button>
                    <button
                      onClick={() => {
                        setShowAddUser(false)
                        setNewUser({ name: '', pin: '', role: 'standard' })
                      }}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Cancel
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
                  <h3 className="text-lg font-semibold text-gray-900">Package Management</h3>
                  <p className="text-sm text-gray-600">View and modify package details, status, and information</p>
                </div>
              </div>

              {/* Search */}
              <div>
                <input
                  type="text"
                  value={packageSearchTerm}
                  onChange={(e) => setPackageSearchTerm(e.target.value)}
                  placeholder="Search packages by ID, contents, or creator..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {/* Edit Package Form */}
              {editingPackage && (
                <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-6 border border-red-100 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-900">Edit Package: {editingPackage.short_code}</h4>
                    <button
                      onClick={() => {
                        setEditingPackage(null)
                        setPackageFormData({ contents_note: '', destination_branch_id: '', current_location: '', status: 'created' })
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                      <select
                        value={packageFormData.status}
                        onChange={(e) => setPackageFormData({ ...packageFormData, status: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      >
                        <option value="created">Created</option>
                        <option value="queued_for_print">Queued for Print</option>
                        <option value="printed">Printed</option>
                        <option value="handed_over">Handed Over</option>
                        <option value="in_transit">In Transit</option>
                        <option value="at_branch">At Branch</option>
                        <option value="delivered">Delivered</option>
                        <option value="returned">Returned</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Current Location</label>
                      <input
                        type="text"
                        value={packageFormData.current_location}
                        onChange={(e) => setPackageFormData({ ...packageFormData, current_location: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                        placeholder="e.g., Main Office, Warehouse"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Destination Branch</label>
                      <select
                        value={packageFormData.destination_branch_id}
                        onChange={(e) => setPackageFormData({ ...packageFormData, destination_branch_id: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                      >
                        <option value="">Select branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name} - {branch.code}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Contents / Products</label>
                      <textarea
                        value={packageFormData.contents_note}
                        onChange={(e) => setPackageFormData({ ...packageFormData, contents_note: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 resize-none"
                        rows={4}
                        placeholder="List products and quantities (e.g., Electronics x2, Documents x1)"
                      />
                    </div>

                    <div className="flex space-x-3 pt-4">
                      <button
                        onClick={handleSavePackage}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-all shadow-md hover:shadow-lg"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => {
                          setEditingPackage(null)
                          setPackageFormData({ contents_note: '', destination_branch_id: '', current_location: '', status: 'created' })
                        }}
                        className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded-lg"
                      >
                        Cancel
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
                          <div className="flex items-center space-x-3 mb-2">
                            <span className="font-mono font-bold text-lg text-gray-900">{pkg.short_code}</span>
                            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                              pkg.status === 'delivered' ? 'bg-green-100 text-green-800' :
                              pkg.status === 'canceled' ? 'bg-red-100 text-red-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {pkg.status.replace('_', ' ')}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
                            <div>
                              <span className="text-gray-500 font-medium">Contents:</span>
                              <p className="text-gray-900 mt-0.5">{pkg.contents_note || <span className="italic text-gray-400">Not specified</span>}</p>
                            </div>
                            <div>
                              <span className="text-gray-500 font-medium">Destination:</span>
                              <p className="text-gray-900 mt-0.5">{pkg.destination_branch?.name || <span className="italic text-gray-400">Not set</span>}</p>
                            </div>
                            <div>
                              <span className="text-gray-500 font-medium">Location:</span>
                              <p className="text-gray-900 mt-0.5">{pkg.current_location || <span className="italic text-gray-400">Not set</span>}</p>
                            </div>
                            <div>
                              <span className="text-gray-500 font-medium">Created By:</span>
                              <p className="text-gray-900 mt-0.5 font-semibold">{pkg.created_by_user?.name || <span className="italic text-gray-400">Unknown</span>}</p>
                            </div>
                          </div>
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
                      <p className="text-gray-500">No audit logs found</p>
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
                                <span className="text-gray-500 font-medium">User:</span>
                                <p className="text-gray-900 mt-0.5 font-semibold">{log.user?.name || 'Unknown User'}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 font-medium">Entity ID:</span>
                                <p className="text-gray-900 mt-0.5 font-mono text-xs">{log.entity_id}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 font-medium">Timestamp:</span>
                                <p className="text-gray-900 mt-0.5">
                                  {new Date(log.created_at).toLocaleString()}
                                </p>
                              </div>
                              {log.ip && (
                                <div>
                                  <span className="text-gray-500 font-medium">IP Address:</span>
                                  <p className="text-gray-900 mt-0.5 font-mono text-xs">{log.ip}</p>
                                </div>
                              )}
                            </div>
                            {(log.before_json || log.after_json) && (
                              <details className="mt-3">
                                <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                                  View Changes
                                </summary>
                                <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs font-mono">
                                  {log.before_json && (
                                    <div className="mb-2">
                                      <span className="font-semibold text-red-600">Before:</span>
                                      <pre className="mt-1 text-gray-700 whitespace-pre-wrap">
                                        {JSON.stringify(log.before_json, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.after_json && (
                                    <div>
                                      <span className="font-semibold text-green-600">After:</span>
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
        title="Delete Package"
        message={`Are you sure you want to delete package ${packageToDelete?.short_code}? This action cannot be undone and will also delete all related history and scans.`}
        confirmText="Delete"
        cancelText="Cancel"
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
              <h2 className="text-lg font-semibold text-gray-900">Inventory Management</h2>
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
                <p className="text-gray-500">No products found</p>
              </div>
            ) : (
              products.map((product) => (
                <div key={product.id} className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{product.name}</div>
                    <div className="text-sm text-gray-600 mt-1">SKU: {product.sku}</div>
                    <div className="text-xs text-gray-500 mt-1">Unit: {product.unit} • Min Threshold: {product.min_threshold}</div>
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
  const [packages, setPackages] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
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

  const loadPackages = async (search: string = '') => {
    setIsLoading(true)
    try {
      let query = supabase
        .from('packages')
        .select('*')
        .order('created_at', { ascending: false })

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
      setPackages(data || [])
    } catch (error) {
      console.error('Error loading packages:', error)
      toast.error('Failed to load packages')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPackages()
  }, [])

  // Debounced search - search as user types
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set new timeout for search
    searchTimeoutRef.current = setTimeout(() => {
      loadPackages(searchTerm)
    }, 300) // Wait 300ms after user stops typing

    // Cleanup
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchTerm])

  // Packages are already filtered server-side, so no client-side filtering needed
  const filteredPackages = packages

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
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
        const nameMatch = toLine.match(/^(.+?)(?:\s+\((.+)\))?$/)
        if (nameMatch) {
          const fullName = nameMatch[1].trim()
          const nameParts = fullName.split(' ')
          if (nameParts.length >= 2) {
            name = nameParts[0]
            surname = nameParts.slice(1).join(' ')
          } else {
            name = fullName
          }
          company = nameMatch[2] || ''
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

  const generateQRCode = async (shortCode: string): Promise<string | null> => {
    try {
      const canvas = document.createElement('canvas')
      await QRCode.toCanvas(canvas, shortCode, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
      return canvas.toDataURL('image/png')
    } catch (error) {
      console.error('QR code generation error:', error)
      return null
    }
  }

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
      
      const printLabelHTML = `
        <div class="shipping-label">
          <div class="label-left-section">
            <div class="logo-section">
              <img src="${logoSrc}" alt="Sigma Logo" class="logo" onerror="this.style.display='none'" />
            </div>
            
            <div class="tracking-code-section">
              <div class="tracking-label">TRACKING</div>
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
            <div class="qr-label">Scan to Track</div>
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

      const images = printContainer.querySelectorAll('img')
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

      if (images.length > 0) {
        images.forEach((img) => {
          if (img.complete && (img as HTMLImageElement).naturalHeight !== 0) {
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

    setTimeout(() => {
      try {
        console.log('Calling window.print()')
        window.print()
        
        setTimeout(() => {
          setIsPrinting(false)
          setPrintingPackageId(null)
          toast.success('Label sent to printer')
        }, 1000)
      } catch (error) {
        console.error('Print error:', error)
        setIsPrinting(false)
        setPrintingPackageId(null)
        toast.error('Failed to open print dialog')
      }
    }, 300)
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
              <h2 className="text-lg font-semibold text-gray-900">Packages</h2>
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">×</button>
          </div>
          
          <div className="mt-4">
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent pr-10"
                placeholder="Search packages by ID, contents, notes, status, location..."
              />
              {isLoading && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                </div>
              )}
            </div>
            {searchTerm && (
              <p className="text-xs text-gray-500 mt-2">
                Found {filteredPackages.length} package{filteredPackages.length !== 1 ? 's' : ''}
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
                ← Back to List
              </button>
              
              <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Package Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-gray-600">Package ID:</span>
                      <p className="font-mono font-medium">{selectedPackage.short_code}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Status:</span>
                      <p className={`inline-block px-3 py-1 rounded-full text-sm ${getStatusColor(selectedPackage.status)}`}>
                        {selectedPackage.status.replace('_', ' ')}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Current Location:</span>
                      <p className="font-medium">{selectedPackage.current_location}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Created:</span>
                      <p className="font-medium">{new Date(selectedPackage.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
                
                <div>
                  <span className="text-sm text-gray-600">Contents:</span>
                  <p className="font-medium whitespace-pre-line">{selectedPackage.contents_note}</p>
                </div>
                
                {selectedPackage.notes && (
                  <div>
                    <span className="text-sm text-gray-600">Notes:</span>
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
                  <p className="text-lg">No packages found</p>
                  <p className="text-sm mt-2">Create a label to get started</p>
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
                      <div className="text-sm text-gray-600">{pkg.contents_note?.split('\n')[0] || 'No contents'}</div>
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
                        {pkg.status.replace('_', ' ')}
                      </div>
                      <button
                        onClick={(e) => printPackage(pkg, e)}
                        disabled={isPrinting && printingPackageId === pkg.id}
                        className={`flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-sm ${
                          isPrinting && printingPackageId === pkg.id ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        title="Print Label"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        <span>Print Label</span>
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

      {/* Print Styles - Same as CreateLabelModal */}
      <style>{`
        .print-label-container {
          position: absolute;
          left: -9999px;
          top: -9999px;
          width: 50mm;
          height: 30mm;
        }

        @media print {
          body * {
            visibility: hidden !important;
          }

          #print-label-packages-modal,
          #print-label-packages-modal * {
            visibility: visible !important;
          }

          #print-label-packages-modal {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 50mm !important;
            height: 30mm !important;
            background: white !important;
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 9999 !important;
          }

          @page {
            size: 50mm 30mm landscape;
            margin: 0;
          }

          html, body {
            width: 50mm !important;
            height: 30mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: white !important;
          }

          /* Main Label Container - Modern Sleek Design */
          .shipping-label {
            width: 50mm !important;
            height: 30mm !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: row !important;
            margin: 0 !important;
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%) !important;
            color: #000 !important;
            position: relative !important;
            border: 0.5mm solid #e5e7eb !important;
            overflow: hidden !important;
          }

          /* Left Section - Logo, Tracking, Recipient */
          .label-left-section {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            padding: 1.2mm !important;
            justify-content: space-between !important;
            min-width: 0 !important;
          }

          /* Logo Section */
          .logo-section {
            margin-bottom: 1mm !important;
          }

          .logo {
            max-height: 6mm !important;
            max-width: 100% !important;
            width: auto !important;
            height: auto !important;
            display: block !important;
            object-fit: contain !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }

          /* Tracking Code Section */
          .tracking-code-section {
            margin-bottom: 1mm !important;
          }

          .tracking-label {
            font-size: 3.5pt !important;
            font-weight: 500 !important;
            color: #9ca3af !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            margin-bottom: 0.2mm !important;
            font-family: 'Arial', sans-serif !important;
          }

          .tracking-code {
            font-size: 5.5pt !important;
            font-weight: 600 !important;
            letter-spacing: 1px !important;
            color: #6b7280 !important;
            line-height: 1.2 !important;
            text-transform: uppercase !important;
            font-family: 'Courier New', 'Monaco', monospace !important;
            padding: 0.4mm 0.6mm !important;
            border-radius: 1mm !important;
            border: 0.3mm solid #e5e7eb !important;
            background: #f9fafb !important;
            display: inline-block !important;
          }

          /* Recipient Section */
          .recipient-section {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: flex-start !important;
          }

          .recipient-name {
            font-weight: 900 !important;
            font-size: 11pt !important;
            margin-bottom: 0.5mm !important;
            color: #111827 !important;
            line-height: 1.1 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
          }

          .company-name {
            font-weight: 600 !important;
            font-size: 7pt !important;
            margin-bottom: 0.4mm !important;
            color: #4b5563 !important;
            line-height: 1.2 !important;
            font-style: normal !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
          }

          .address-text {
            font-size: 5pt !important;
            color: #374151 !important;
            line-height: 1.3 !important;
            word-wrap: break-word !important;
            font-weight: 400 !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
          }

          /* Right Section - Large QR Code */
          .label-right-section {
            width: 20mm !important;
            height: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%) !important;
            border-left: 0.5mm dashed #d1d5db !important;
            padding: 1mm !important;
            box-sizing: border-box !important;
          }

          /* QR Code - Large and Prominent */
          .qr-code {
            width: 18mm !important;
            height: 18mm !important;
            display: block !important;
            flex-shrink: 0 !important;
            border: 0.5mm solid #111827 !important;
            padding: 1mm !important;
            background: white !important;
            border-radius: 1mm !important;
            box-shadow: 0 0.5mm 1mm rgba(0, 0, 0, 0.1) !important;
            image-rendering: -webkit-optimize-contrast !important;
            image-rendering: crisp-edges !important;
          }

          .qr-label {
            font-size: 4.5pt !important;
            font-weight: 600 !important;
            color: #6b7280 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.8px !important;
            margin-top: 0.8mm !important;
            font-family: 'Arial', sans-serif !important;
          }

          /* Items List - Compact and readable */
          .items-list {
            font-size: 5.5pt !important;
            color: #111827 !important;
            line-height: 1.3 !important;
            font-family: 'Arial', 'Helvetica', sans-serif !important;
            font-weight: 500 !important;
          }

          .items-list div {
            margin-bottom: 0.2mm !important;
            line-height: 1.3 !important;
            padding: 0.2mm 0 !important;
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
      title: 'Transfer',
      description: 'Transfer package to new location',
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
      title: 'Admin',
      description: 'Manage users, packages, products, and audit logs',
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
  const [currentView, setCurrentView] = useState('home')
  const [showCreateLabel, setShowCreateLabel] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  const [showPackages, setShowPackages] = useState(false)

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