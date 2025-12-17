import React, { useState, useRef, useEffect } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase, Package, PackageStatus } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { 
  Camera, 
  CameraOff, 
  Flashlight, 
  FlashlightOff, 
  RotateCcw,
  CheckCircle,
  XCircle
} from 'lucide-react'

interface BarcodeScannerProps {
  onScanSuccess?: (packageData: Package) => void  // Optional - scanner handles its own modal now
  onClose: () => void
}

export function BarcodeScanner({ onScanSuccess, onClose }: BarcodeScannerProps) {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [isScanning, setIsScanning] = useState(true)
  const [hasFlash, setHasFlash] = useState(false)
  const [flashOn, setFlashOn] = useState(false)
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isProcessingScan, setIsProcessingScan] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [scannedPackage, setScannedPackage] = useState<any>(null)
  const [selectedStatus, setSelectedStatus] = useState<PackageStatus | null>(null)
  const [statusHistory, setStatusHistory] = useState<any[]>([])
  const [showUpdateStatus, setShowUpdateStatus] = useState(false)
  const [updateNote, setUpdateNote] = useState('')
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null)
  const [isLoadingPackage, setIsLoadingPackage] = useState(false)
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null)
  const [scanMode, setScanMode] = useState<'single' | 'bulk'>('single')
  const [bulkSelectedStatus, setBulkSelectedStatus] = useState<PackageStatus | null>(null)
  const [bulkUpdatedPackages, setBulkUpdatedPackages] = useState<Array<{ code: string; success: boolean; error?: string }>>([])

  // Function to play beep sound on successful scan
  const playBeepSound = async () => {
    try {
      // Create or get audio context for beep sound
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      let audioContext: AudioContext
      
      // Try to use existing context or create new one
      if (!(window as any).beepAudioContext) {
        audioContext = new AudioContextClass()
        // Resume context if suspended (required for mobile browsers)
        if (audioContext.state === 'suspended') {
          await audioContext.resume()
        }
        (window as any).beepAudioContext = audioContext
      } else {
        audioContext = (window as any).beepAudioContext
        if (audioContext.state === 'suspended') {
          await audioContext.resume()
        }
      }

      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      // Configure beep sound (800Hz, short beep)
      oscillator.frequency.value = 800
      oscillator.type = 'sine'

      // Set volume (gain) - start loud, fade out quickly
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1)

      // Play beep
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.1)
    } catch (error) {
      console.warn('Could not play beep sound with Web Audio API:', error)
      // Fallback: try using HTML5 Audio if Web Audio API fails
      try {
        // Create a simple beep tone using Web Audio API with fallback
        const audio = new Audio()
        // Generate a beep using data URI (base64 encoded short beep WAV)
        audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoZbTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OSfTQ8MUKjj8LZjHAY4kdfyzHksBSR3x/DdkEAKGm06+uoVRQKRp/g8r5sIQUrgc7y2Yk2CBtpvfDkn00PDFCo4/C2YxwGOJHX8sx5LAUkd8fw3ZBACBppOvrqFUUCkaf4PK+bCEFK4HO8tmJNggbab3w5J9NDwxQqOPwtmMcBjiR1/LMeSwFJHfH8N2QQA=='
        audio.volume = 0.3
        await audio.play()
      } catch (e) {
        // Ignore if both methods fail - beep is optional
        console.debug('Beep sound not available:', e)
      }
    }
  }

  // Ensure modal shows when package is loaded
  useEffect(() => {
    if (scannedPackage) {
      console.log('[Scanner] Modal should be visible, scannedPackage:', scannedPackage.short_code)
      setShowStatusModal(true)
      // Stop scanner if still running
      if (scannerRef.current && isScanning) {
        scannerRef.current.stop().catch(() => {})
        setIsScanning(false)
      }
    }
  }, [scannedPackage, isScanning])

  useEffect(() => {
    // Check HTTPS requirement for mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const isHTTPS = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
    
    if (isMobile && !isHTTPS) {
      const httpsWarning = '⚠️ Mobile cameras require HTTPS. Please access this site via HTTPS for camera to work.'
      console.warn(httpsWarning)
      toast.error(httpsWarning, { duration: 5000 })
    }

    // Add CSS to ensure camera video is visible
    const style = document.createElement('style')
    style.id = 'barcode-scanner-styles'
    style.textContent = `
      #barcode-scanner {
        width: 100% !important;
        height: 100% !important;
        position: relative !important;
        background: #000 !important;
        min-height: 400px !important;
      }
      #barcode-scanner video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        display: block !important;
        background: #000 !important;
        -webkit-transform: translateZ(0);
        transform: translateZ(0);
      }
      #barcode-scanner canvas {
        display: none !important;
      }
      #barcode-scanner > div {
        width: 100% !important;
        height: 100% !important;
        position: relative !important;
      }
      #barcode-scanner > div > video {
        width: 100% !important;
        height: 100% !important;
        -webkit-transform: translateZ(0);
        transform: translateZ(0);
      }
      /* Mobile-specific fixes */
      @media (max-width: 768px) {
        #barcode-scanner {
          min-height: 100vh !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
        }
      }
    `
    // Remove old style if exists
    const oldStyle = document.getElementById('barcode-scanner-styles')
    if (oldStyle) oldStyle.remove()
    document.head.appendChild(style)

    // Set scanning to true first so the div gets rendered
    setIsScanning(true)

    // Start scanner after component is fully mounted
    // Reduced delay since div is always in DOM now
    const timer = setTimeout(() => {
      startScanner()
    }, 300)

    return () => {
      clearTimeout(timer)
      stopScanner()
      const styleEl = document.getElementById('barcode-scanner-styles')
      if (styleEl) {
        document.head.removeChild(styleEl)
      }
    }
  }, [])

  useEffect(() => {
    // Only start scanner if scanning is true but scanner isn't initialized yet
    // This prevents conflicts with the initial mount useEffect
    if (isScanning && !scannerRef.current && !isInitializing) {
      console.log('isScanning changed to true, starting scanner...')
      startScanner()
    } else if (!isScanning && scannerRef.current) {
      console.log('isScanning changed to false, stopping scanner...')
      stopScanner()
    }
  }, [isScanning])

  const startScanner = async () => {
    try {
      setError(null)
      setIsInitializing(true)
      setIsScanning(true) // Ensure scanning is true so the div is visible
      
      // Stop any existing scanner
      await stopScanner()

      // Ensure the scanner div exists - wait for it with retries
      // Give React time to render the div (now that it's always in the DOM)
      await new Promise(resolve => setTimeout(resolve, 100))
      
      let scannerDiv = document.getElementById('barcode-scanner')
      let retries = 0
      const maxRetries = 20 // Increased retries
      while (!scannerDiv && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 50))
        scannerDiv = document.getElementById('barcode-scanner')
        retries++
        if (scannerDiv) {
          console.log(`Scanner div found after ${retries} retries`)
          break
        }
      }

      if (!scannerDiv) {
        console.error('Scanner div not found after all retries')
        throw new Error(t('scanner.scannerNotFound'))
      }
      
      // Ensure div is visible for Html5Qrcode (already handled by CSS, but double-check)
      scannerDiv.style.visibility = 'visible'
      scannerDiv.style.display = 'block'

      console.log('Scanner div found, initializing...')
      const html5QrCode = new Html5Qrcode('barcode-scanner')
      scannerRef.current = html5QrCode

      // Detect mobile device
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      
      console.log('Device type:', { isMobile, isIOS })

      // For mobile devices (especially iOS), use facingMode instead of deviceId
      // This is more reliable across different mobile browsers
      if (isMobile) {
        try {
          console.log('Starting camera with facingMode: environment (mobile)')
          
          const mobileConfig: any = {
            fps: 60, // High FPS for faster scanning
            qrbox: function(viewfinderWidth: number, viewfinderHeight: number) {
              // Use 100% of viewfinder for maximum scanning area - easier to scan from far away
              return {
                width: Math.floor(viewfinderWidth),
                height: Math.floor(viewfinderHeight)
              }
            },
            aspectRatio: 1.0,
            disableFlip: false, // Allow auto-flip for better scanning
            supportedScanTypes: [Html5Qrcode.SCAN_TYPE_CAMERA],
            videoConstraints: {
              facingMode: 'environment',
              focusMode: 'continuous', // Auto-focus for better scanning
              exposureMode: 'continuous',
              width: { ideal: 1920 }, // Higher resolution for better detection from distance
              height: { ideal: 1080 }
            },
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true // Use native barcode detector if available (faster)
            }
          }

          await html5QrCode.start(
            { facingMode: 'environment' }, // Use facingMode for mobile
            mobileConfig,
            (decodedText, decodedResult) => {
              if (!decodedText || typeof decodedText !== 'string' || decodedText.trim().length < 3) {
                return
              }
              
              let format = 'UNKNOWN'
              if (decodedResult) {
                format = (decodedResult as any)?.result?.format?.formatName || 
                        (decodedResult as any)?.format || 
                        (decodedResult as any)?.format?.format || 
                        'UNKNOWN'
              }
              
              console.log('[Scanner] Code detected:', decodedText.substring(0, 20), 'Format:', format)
              handleScanSuccess(decodedText, format)
            },
            (errorMessage) => {
              if (errorMessage && 
                  !errorMessage.includes('No QR') && 
                  !errorMessage.includes('NotFoundException') &&
                  !errorMessage.includes('scanning')) {
                console.debug('Scan attempt:', errorMessage)
              }
            }
          )

          console.log('Camera started successfully on mobile!')
          setIsInitializing(false)
          setIsScanning(true)
          
          // Set a placeholder cameraId for mobile
          setCameraId('mobile-environment')
          
          // Check for torch/flash support on mobile
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' }
            })
            const track = stream.getVideoTracks()[0]
            if (track && 'getCapabilities' in track) {
              const caps = track.getCapabilities()
              if ((caps as any).torch || (caps as any).advanced?.some((opt: any) => opt.torch)) {
                setHasFlash(true)
                // Store track reference for torch control
                ;(window as any).cameraTrack = track
              }
            }
            // Don't stop the stream - keep it for torch control
          } catch (err) {
            console.debug('Torch check failed:', err)
          }
          
          return // Success, exit early
        } catch (mobileError: any) {
          console.warn('Failed to start with facingMode, falling back to deviceId:', mobileError)
          // Fall through to deviceId method
        }
      }

      // Fallback: Get available cameras using deviceId (for desktop or if facingMode fails)
      console.log('Requesting camera access via deviceId...')
      const cameraPromise = Html5Qrcode.getCameras()
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Camera access timeout - please allow camera permission')), 15000)
      )
      
      const devices = await Promise.race([cameraPromise, timeoutPromise]) as any[]
      console.log('Available cameras:', devices.length)
      
      if (!devices || devices.length === 0) {
        throw new Error('No cameras found. Please ensure your device has a camera and grant permission.')
      }
      
      // Find the best camera:
      // 1. Try rear camera on mobile (environment)
      // 2. Try any camera with "back" or "rear" in name
      // 3. Use any available camera (good for PC webcams)
      const rearCamera = devices.find(d => 
        d.label.toLowerCase().includes('back') || 
        d.label.toLowerCase().includes('rear') || 
        d.label.toLowerCase().includes('environment')
      )
      const frontCamera = devices.find(d => 
        d.label.toLowerCase().includes('front') || 
        d.label.toLowerCase().includes('user')
      )
      // Prefer rear > any > front
      const selectedCamera = rearCamera || devices[0] || frontCamera
      
      if (!selectedCamera) {
        throw new Error('No camera available')
      }
      
      setCameraId(selectedCamera.id)

      const config = {
        fps: 60, // High FPS for faster scanning
        qrbox: function(viewfinderWidth: number, viewfinderHeight: number) {
          // Use 100% of viewfinder for maximum scanning area - easier to scan from far away
          return {
            width: Math.floor(viewfinderWidth),
            height: Math.floor(viewfinderHeight)
          }
        },
        aspectRatio: 1.0,
        verbose: false,
        disableFlip: false, // Allow auto-flip for better scanning
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true // Use native barcode detector if available (faster)
        },
        supportedScanTypes: [Html5Qrcode.SCAN_TYPE_CAMERA]
      }

      // Use optimized configuration for faster scanning
      console.log('Starting camera with device:', selectedCamera.id)
      await html5QrCode.start(
        selectedCamera.id,
        {
          fps: config.fps,
          qrbox: config.qrbox, // Use dynamic sizing (100% of viewfinder)
          aspectRatio: config.aspectRatio,
          disableFlip: config.disableFlip,
          supportedScanTypes: config.supportedScanTypes,
          experimentalFeatures: config.experimentalFeatures,
          videoConstraints: {
            width: { ideal: 1920 }, // Higher resolution for better detection from distance
            height: { ideal: 1080 }
          }
        },
          (decodedText, decodedResult) => {
            // Only process if we have valid text
            if (!decodedText || typeof decodedText !== 'string' || decodedText.trim().length < 3) {
              return
            }
            
            // Validate format - be more flexible with format detection
            let format = 'UNKNOWN'
            if (decodedResult) {
              format = (decodedResult as any)?.result?.format?.formatName || 
                      (decodedResult as any)?.format || 
                      (decodedResult as any)?.format?.format || 
                      'UNKNOWN'
            }
            
            // Accept common barcode formats (be more permissive)
            const validFormats = ['CODE_128', 'QR_CODE', 'QR', 'CODE128', 'CODE_39', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E']
            const isFormatValid = validFormats.some(f => format.toUpperCase().includes(f.replace('_', '')))
            
            if (!isFormatValid && format !== 'UNKNOWN') {
              console.debug('Format not recognized, trying anyway:', format, decodedText)
              // Still try to process it - some scanners don't report format correctly
            }
            
            console.log('[Scanner] Code detected (desktop):', decodedText.substring(0, 20), 'Format:', format)
            handleScanSuccess(decodedText, format)
          },
          (errorMessage) => {
            // Only log actual errors, not scanning attempts
            if (errorMessage && 
                !errorMessage.includes('No QR') && 
                !errorMessage.includes('NotFoundException') &&
                !errorMessage.includes('scanning')) {
              console.debug('Scan attempt:', errorMessage)
            }
          }
        )

        console.log('Camera started successfully!')
        setIsInitializing(false)
        setIsScanning(true)

        // Check for torch/flash support (mainly for mobile devices)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
              deviceId: selectedCamera.id,
              facingMode: isMobile ? 'environment' : undefined
            }
          })
          const track = stream.getVideoTracks()[0]
          if (track && 'getCapabilities' in track) {
            const caps = track.getCapabilities()
            // Check for torch support
            if ((caps as any).torch || (caps as any).advanced?.some((opt: any) => opt.torch)) {
              setHasFlash(true)
              // Store track reference for torch control
              ;(window as any).cameraTrack = track
            } else {
              setHasFlash(false)
            }
          } else {
            setHasFlash(false)
          }
          // Don't stop the stream - keep it for torch control
          // stream.getTracks().forEach(t => t.stop())
        } catch {
          setHasFlash(false)
        }
    } catch (err: any) {
      console.error('Camera error:', err)
      let errorMsg = err.message || 'Failed to access camera'
      
      // Detect mobile for better error messages
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      const isHTTPS = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
      
      // Provide helpful error messages with translations
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = isMobile ? t('scanner.cameraPermissionDeniedMobile') : t('scanner.cameraPermissionDenied')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = t('scanner.noCameraFound')
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg = t('scanner.cameraInUse')
      } else if (err.message?.includes('HTTPS') || (!isHTTPS && isMobile)) {
        errorMsg = isMobile ? t('scanner.cameraRequiresHTTPSMobile') : t('scanner.cameraRequiresHTTPS')
      } else if (err.message?.includes('timeout')) {
        errorMsg = t('scanner.cameraTimeout')
      } else if (isIOS && err.message?.includes('facingMode')) {
        errorMsg = t('scanner.cameraIOSFailed')
      }
      
      setError(errorMsg)
      setIsInitializing(false)
      setIsScanning(false)
      toast.error(errorMsg)
      
      // Also log to console for debugging
      console.error('Full error details:', {
        name: err.name,
        message: err.message,
        stack: err.stack
      })
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
        await scannerRef.current.clear()
      } catch (err) {
        // Ignore stop errors
      }
      scannerRef.current = null
    }
  }

  const handleScanSuccess = async (decodedText: string, format: string) => {
    // Prevent processing if already processing a scan
    if (isProcessingScan) {
      console.log('[Scanner] ⏸️  Already processing a scan, ignoring...')
      return
    }
    
    // In bulk mode, check if status is selected
    if (scanMode === 'bulk' && !bulkSelectedStatus) {
      toast.error(t('scanner.selectStatusFirst'), { duration: 2000 })
      return
    }
    
    // Prevent processing if modal is already showing (only in single mode)
    if (scannedPackage && scanMode === 'single') {
      console.log('[Scanner] ⏸️  Modal already open, ignoring scan...')
      return
    }

    const now = new Date()
    const normalizedCode = decodedText.trim()

    // Strict validation - must have meaningful content
    if (!normalizedCode || normalizedCode.length < 3) {
      return
    }

    // Ignore common false positives
    const invalidPatterns = ['undefined', 'null', '[object Object]', 'true', 'false']
    if (invalidPatterns.includes(normalizedCode)) {
      return
    }

    // Throttle: prevent same code from re-triggering within 500ms
    // Reduced to 50ms for faster response and better performance
    if (lastScanTime && now.getTime() - lastScanTime.getTime() < 50) {
      return
    }
    
    // If same code was just scanned, ignore for 500ms (reduced for faster re-scanning)
    if (lastScannedCode === normalizedCode && lastScanTime && now.getTime() - lastScanTime.getTime() < 500) {
      return
    }

    console.log('[Scanner] Processing scan:', normalizedCode.substring(0, 20))
    
    // Play beep sound on successful scan detection (non-blocking)
    playBeepSound().catch(() => {
      // Ignore beep errors - it's optional feedback
    })
    
    // IMMEDIATELY stop scanner and show loading
    setIsProcessingScan(true)
    setIsLoadingPackage(true)
    setLastScanTime(now)
    setScanCount(prev => prev + 1)
    
    // Stop scanner IMMEDIATELY to prevent interference
    setIsScanning(false)
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
        console.log('[Scanner] Scanner stopped successfully')
      } catch (e) {
        console.warn('[Scanner] Error stopping scanner:', e)
      }
    }

    try {
      // Parse the decoded text - extract short_code from URL if it's a tracking URL
      let packageId: string
      try {
        const payload = JSON.parse(decodedText)
        packageId = payload.pkg || payload.id || decodedText
      } catch {
        // Check if it's a tracking URL (e.g., https://example.com/track/ABC123 or /track/ABC123)
        const urlMatch = decodedText.match(/\/track\/([^\/\?]+)/i)
        if (urlMatch && urlMatch[1]) {
          // Extract short_code from URL
          packageId = urlMatch[1].trim()
          console.log('[Scanner] Extracted short_code from URL:', packageId)
        } else {
          // Use decoded text directly (might be short_code or ID)
          packageId = decodedText.trim()
        }
      }

      // Look up the package by ID or short_code
      let packageData: any = null
      
      // Try by short_code first (most common case)
      const { data: dataByCode, error: errorByCode } = await supabase
        .from('packages')
        .select(`
          *,
          destination_branch:branches(name, code),
          created_by_user:users!packages_created_by_fkey(name)
        `)
        .eq('short_code', packageId)
        .maybeSingle()

      if (dataByCode && !errorByCode) {
        packageData = dataByCode
      } else {
        // Try by ID as fallback
        const { data: dataById, error: errorById } = await supabase
          .from('packages')
          .select(`
            *,
            destination_branch:branches(name, code),
            created_by_user:users!packages_created_by_fkey(name)
          `)
          .eq('id', packageId)
          .maybeSingle()
        
        if (dataById && !errorById) {
          packageData = dataById
        }
      }

      // Handle unknown/not found codes - show full-screen message and option to rescan
      if (!packageData) {
        toast.error(t('scanner.packageNotFound'), { duration: 2000 })
        setIsProcessingScan(false)
        setIsLoadingPackage(false)
        setNotFoundCode(normalizedCode)
        
        // In bulk mode, add to failed list
        if (scanMode === 'bulk') {
          setBulkUpdatedPackages(prev => [...prev, { code: normalizedCode, success: false, error: 'Package not found' }])
          // Restart scanning immediately in bulk mode
          setTimeout(() => setIsScanning(true), 500)
        }
        return
      }

      // BULK MODE: Automatically update status if status is selected
      if (scanMode === 'bulk' && bulkSelectedStatus) {
        const currentStatus = packageData.status
        const currentLocation = packageData.current_location || 'Main Office'
        
        // Update package status
        const { error: updateError } = await supabase
          .from('packages')
          .update({
            status: bulkSelectedStatus,
            current_location: currentLocation
          })
          .eq('id', packageData.id)

        if (updateError) {
          console.error('Bulk update error:', updateError)
          toast.error(`${packageData.short_code}: ${updateError.message}`, { duration: 2000 })
          setBulkUpdatedPackages(prev => [...prev, { 
            code: packageData.short_code, 
            success: false, 
            error: updateError.message 
          }])
        } else {
          // Record status history
          await supabase
            .from('package_status_history')
            .insert({
              package_id: packageData.id,
              from_status: currentStatus,
              to_status: bulkSelectedStatus,
              location: currentLocation,
              scanned_by: user?.id || '',
              scanned_at: new Date().toISOString(),
              note: 'Bulk update via QR scanner'
            })
          
          // Record the scan
          await recordScan(packageData.id, normalizedCode, format, currentLocation)
          
          toast.success(`${packageData.short_code} → ${t(`scanner.statuses.${bulkSelectedStatus}`)}`, { duration: 1500 })
          setBulkUpdatedPackages(prev => [...prev, { 
            code: packageData.short_code, 
            success: true 
          }])
        }
        
        // Restart scanning immediately in bulk mode
        setIsProcessingScan(false)
        setIsLoadingPackage(false)
        setTimeout(() => setIsScanning(true), 300)
        return
      }

      // SINGLE MODE: Show package details modal
      // Fetch status history for timeline
      const { data: historyData } = await supabase
        .from('package_status_history')
        .select(`
          *,
          scanned_by_user:users!package_status_history_scanned_by_fkey(name)
        `)
        .eq('package_id', packageData.id)
        .order('scanned_at', { ascending: false })
        .limit(10)

      // Show package details modal - NO AUTO-UPDATES
      console.log('[Scanner] ✅ Package found:', packageData.short_code)
      console.log('[Scanner] 📊 History records:', historyData?.length || 0)
      
      // Prepare package data
      const packageWithCode = {
        ...packageData,
        lastScannedCode: normalizedCode // Preserve scanned code in memory
      }
      
      // Haptic feedback on mobile
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      if (isMobile && navigator.vibrate) {
        navigator.vibrate([100, 50, 100])
      }
      
      // Show toast so user knows package was found
      toast.success(t('scanner.packageFound', { code: packageData.short_code }), { 
        duration: 2000
      })
      
      // CRITICAL: Set all state to trigger modal rendering
      // Order matters: set package data first, then modal state
      setStatusHistory(historyData || [])
      setSelectedStatus(null)
      setShowUpdateStatus(false)
      setUpdateNote('')
      setLastScannedCode(normalizedCode)
      
      // This is the key - setting scannedPackage triggers the modal to render
      setScannedPackage(packageWithCode)
      setShowStatusModal(true)
      setIsLoadingPackage(false)
      
      console.log('[Scanner] 🎯 State updated - modal should appear now')
      
      // Call optional callback if provided
      if (onScanSuccess) {
        onScanSuccess(packageData)
      }
      
      setIsProcessingScan(false)
      
    } catch (error) {
      console.error('[Scanner] ❌ Scan processing error:', error)
      toast.error(t('scanner.errorProcessing'), { duration: 2000 })
      setIsProcessingScan(false)
      setIsLoadingPackage(false)
      // Restart scanner on error
      setIsScanning(true)
    }
  }

  const recordScan = async (packageId: string, rawData: string, symbology: string, location: string) => {
    try {
      await supabase.from('scans').insert({
        package_id: packageId,
        raw_data: rawData,
        symbology: symbology.toLowerCase() === 'code_128' ? 'code128' : symbology.toLowerCase(),
        location: location,
        scanned_by: user?.id,
        device_label: navigator.userAgent.substring(0, 50)
      })
    } catch (error) {
      console.error('Failed to record scan:', error)
    }
  }

  const toggleFlash = async () => {
    if (!hasFlash) return

    try {
      // Get the camera track (stored from camera initialization)
      const track = (window as any).cameraTrack
      
      if (!track) {
        // If no track stored, try to get it from the current stream
        const streams = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        })
        const videoTrack = streams.getVideoTracks()[0]
        if (videoTrack && 'applyConstraints' in videoTrack) {
          try {
            await (videoTrack as any).applyConstraints({
              advanced: [{ torch: !flashOn }]
            })
            setFlashOn(!flashOn)
            // Store track for future toggles
            ;(window as any).cameraTrack = videoTrack
          } catch (err) {
            console.debug('Torch toggle failed:', err)
          }
        }
        return
      }

      // Try multiple methods to toggle torch
      if ('applyConstraints' in track) {
        try {
          // Method 1: Using applyConstraints with advanced options
          await (track as any).applyConstraints({
            advanced: [{ torch: !flashOn }]
          })
          setFlashOn(!flashOn)
          return
        } catch (err) {
          console.debug('Method 1 failed, trying method 2:', err)
        }

        try {
          // Method 2: Direct torch property (some browsers)
          if ('torch' in track) {
            const torchObj = (track as any).torch
            if (torchObj && typeof torchObj === 'object' && 'enabled' in torchObj) {
              torchObj.enabled = !flashOn
              setFlashOn(!flashOn)
              return
            }
          }
        } catch (err) {
          console.debug('Method 2 failed:', err)
        }

        try {
          // Method 3: Using getSettings and applyConstraints
          const settings = track.getSettings()
          await track.applyConstraints({
            ...settings,
            advanced: [{ torch: !flashOn }]
          })
          setFlashOn(!flashOn)
        } catch (err) {
          console.debug('Method 3 failed:', err)
        }
      }
    } catch (error) {
      console.error('Flash toggle error:', error)
    }
  }

  const resetScanner = async () => {
    await stopScanner()
    setTimeout(() => {
      setIsScanning(true)
    }, 100)
  }

  // Not found overlay
  if (notFoundCode) {
    return (
      <div 
        className="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-[99999]"
        style={{ position: 'fixed' as const }}
      >
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-2xl w-full max-w-md mx-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
            <XCircle className="w-7 h-7" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">{t('scanner.packageNotFound')}</h3>
          <p className="text-xs sm:text-sm text-gray-600 mb-3">{t('scanner.scannedCode')}:</p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 sm:p-3 mb-4 break-all font-mono text-xs text-gray-800">
            {notFoundCode}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={() => {
                setNotFoundCode(null)
                setIsScanning(true)
              }}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold py-3 sm:py-3 px-4 rounded-lg transition-colors text-sm sm:text-base"
            >
              {t('scanner.backToScanner')}
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(notFoundCode)
                toast.success(t('common.success'))
              }}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 sm:py-3 px-4 rounded-lg transition-colors text-sm sm:text-base"
            >
              {t('scanner.copyCode')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Show loading state while fetching package data
  if (isLoadingPackage) {
    return (
      <div 
        className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[99999]"
        style={{ 
          position: 'fixed' as const, 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0,
          zIndex: 99999,
          width: '100vw',
          height: '100vh'
        }}
      >
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-2xl text-center max-w-sm mx-4">
          <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">{t('scanner.loadingPackage')}</h3>
          <p className="text-sm sm:text-base text-gray-600">{t('scanner.fetchingDetails')}</p>
        </div>
      </div>
    )
  }

  // If scannedPackage exists, SHOW MODAL - this replaces scanner completely
  if (scannedPackage) {
    console.log('[Scanner] 🎨 Rendering modal for package:', scannedPackage.short_code)
    
    // Ensure scanner is stopped
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {})
      scannerRef.current = null
    }
    
    // FORCE MODAL TO RENDER - this replaces scanner completely
    return (
      <div 
        id="package-details-modal"
        key={`package-modal-${scannedPackage.id}-${Date.now()}`}
        className="fixed inset-0 bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col" 
        style={{ 
          position: 'fixed' as const, 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0,
          zIndex: 99999,
          width: '100vw',
          height: '100vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Modern Header */}
        <div className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setShowStatusModal(false)
                    setScannedPackage(null)
                    setSelectedStatus(null)
                    setIsScanning(true)
                  }}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  title={t('scanner.backToScanner')}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
                <div>
                  <h2 className="text-lg sm:text-xl md:text-2xl font-bold">{t('scanner.packageDetails')}</h2>
                  <p className="text-xs sm:text-sm text-red-100 hidden sm:block">{t('scanner.viewUpdateInfo')}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                title={t('common.close')}
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>

        {/* Package Details Content - Scrollable */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6">
          <div className="max-w-4xl mx-auto">
            <div className="space-y-4 sm:space-y-6">

              {/* Package Code Card - Modern Design */}
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 sm:mb-2">{t('scanner.packageCode')}</p>
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 font-mono">{scannedPackage.short_code}</h1>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 hidden sm:block">{t('scanner.currentStatus')}</p>
                      <span className={`inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold capitalize ${
                        scannedPackage.status === 'delivered' ? 'bg-green-100 text-green-800' :
                        scannedPackage.status === 'canceled' ? 'bg-gray-100 text-gray-800' :
                        scannedPackage.status === 'returned' ? 'bg-orange-100 text-orange-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {t(`scanner.statuses.${scannedPackage.status}`)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Parse contents_note to get full package details */}
              {(() => {
                let packageDetails: any = {}
                try {
                  packageDetails = JSON.parse(scannedPackage.contents_note || '{}')
                } catch {
                  packageDetails = { raw: scannedPackage.contents_note }
                }

                return (
                  <>
                    {/* Recipient Information - Modern Card - Mobile Optimized */}
                    {(packageDetails.name || packageDetails.surname || packageDetails.company) && (
                      <div className="bg-white rounded-xl shadow-md p-4 sm:p-5 border border-gray-200">
                        <div className="flex items-center mb-3 sm:mb-4">
                          <div className="bg-blue-100 p-1.5 sm:p-2 rounded-lg mr-2 sm:mr-3">
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                          <h4 className="text-sm sm:text-base font-bold text-gray-900">{t('scanner.recipientInformation')}</h4>
                        </div>
                        <div className="space-y-2 sm:space-y-3">
                          {(packageDetails.name || packageDetails.surname) && (
                            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0">
                              <span className="text-xs sm:text-sm text-gray-500 font-medium sm:w-20 sm:flex-shrink-0">{t('scanner.name')}</span>
                              <span className="text-sm text-gray-900 font-semibold flex-1">{packageDetails.name} {packageDetails.surname}</span>
                            </div>
                          )}
                          {packageDetails.company && (
                            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0">
                              <span className="text-xs sm:text-sm text-gray-500 font-medium sm:w-20 sm:flex-shrink-0">{t('scanner.company')}</span>
                              <span className="text-sm text-gray-900 flex-1">{packageDetails.company}</span>
                            </div>
                          )}
                          {packageDetails.address && (
                            <div className="flex flex-col sm:flex-row sm:items-start pt-2 border-t border-gray-100 gap-1 sm:gap-0">
                              <span className="text-xs sm:text-sm text-gray-500 font-medium sm:w-20 sm:flex-shrink-0">{t('scanner.address')}</span>
                              <span className="text-sm text-gray-900 flex-1 leading-relaxed">{packageDetails.address}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Items List - Modern Card - Mobile Optimized */}
                    {packageDetails.items && Array.isArray(packageDetails.items) && packageDetails.items.length > 0 && (
                      <div className="bg-white rounded-xl shadow-md p-4 sm:p-5 border border-gray-200">
                        <div className="flex items-center mb-3 sm:mb-4">
                          <div className="bg-green-100 p-1.5 sm:p-2 rounded-lg mr-2 sm:mr-3">
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                          </div>
                          <h4 className="text-sm sm:text-base font-bold text-gray-900">{t('scanner.packageContents')}</h4>
                          <span className="ml-auto bg-gray-100 text-gray-700 text-xs font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full">
                            {packageDetails.items.length} {packageDetails.items.length === 1 ? t('scanner.item') : t('scanner.items')}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {packageDetails.items.map((item: any, idx: number) => (
                            <div key={idx} className="bg-gray-50 rounded-lg p-3 flex justify-between items-center hover:bg-gray-100 transition-colors">
                              <span className="text-sm font-medium text-gray-900">{item.product || item.productId}</span>
                              <span className="bg-green-100 text-green-700 text-sm font-bold px-3 py-1 rounded-full">× {item.quantity || 1}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Last Status & Update Time */}
                    {statusHistory.length > 0 && (
                      <div className="bg-purple-50 rounded-lg p-3 sm:p-4 mb-4 border border-purple-200">
                        <h4 className="text-xs sm:text-sm font-semibold text-purple-900 mb-2 sm:mb-3 flex items-center">
                          <svg className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {t('scanner.lastEvent')}
                        </h4>
                        <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <span className="text-purple-700 font-medium">
                              {t(`scanner.statuses.${statusHistory[0].to_status}`)}
                            </span>
                            <span className="text-gray-600 text-xs">
                              {statusHistory[0].scanned_at ? new Date(statusHistory[0].scanned_at).toLocaleString() : 'N/A'}
                            </span>
                          </div>
                          {statusHistory[0].scanned_by_user?.name && (
                            <div className="text-xs text-gray-600">
                              {t('scanner.updatedBy')}: {statusHistory[0].scanned_by_user.name}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Package Information - Modern Card */}
                    <div className="bg-white rounded-xl shadow-md p-4 sm:p-5 border border-gray-200">
                      <div className="flex items-center mb-3 sm:mb-4">
                        <div className="bg-purple-100 p-1.5 sm:p-2 rounded-lg mr-2 sm:mr-3">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <h4 className="text-sm sm:text-base font-bold text-gray-900">{t('scanner.packageInformation')}</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                        <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('scanner.itemCount')}</p>
                          <p className="text-sm sm:text-base font-bold text-gray-900">
                            {(() => {
                              try {
                                const details = JSON.parse(scannedPackage.contents_note || '{}')
                                return details.items ? details.items.length : 'N/A'
                              } catch {
                                return 'N/A'
                              }
                            })()}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('scanner.destination')}</p>
                          <p className="text-sm sm:text-base font-bold text-gray-900">
                            {scannedPackage.destination_branch?.name || scannedPackage.destination_branch?.code || 'N/A'}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('scanner.origin')}</p>
                          <p className="text-sm sm:text-base font-bold text-gray-900">{scannedPackage.origin || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('scanner.currentLocation')}</p>
                          <p className="text-sm sm:text-base font-bold text-gray-900">{scannedPackage.current_location || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('scanner.createdBy')}</p>
                          <p className="text-sm sm:text-base font-bold text-gray-900">{scannedPackage.created_by_user?.name || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('scanner.createdAt')}</p>
                          <p className="text-sm sm:text-base font-bold text-gray-900">
                            {scannedPackage.created_at ? new Date(scannedPackage.created_at).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric' 
                            }) : 'N/A'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Timeline Preview - Modern Design */}
                    {statusHistory.length > 0 && (
                      <div className="bg-white rounded-xl shadow-md p-4 sm:p-5 border border-gray-200">
                        <div className="flex items-center mb-3 sm:mb-4">
                          <div className="bg-indigo-100 p-1.5 sm:p-2 rounded-lg mr-2 sm:mr-3">
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <h4 className="text-sm sm:text-base font-bold text-gray-900">{t('scanner.statusHistory')}</h4>
                        </div>
                        <div className="space-y-2 sm:space-y-3">
                          {statusHistory.slice(0, 5).map((event: any, idx: number) => (
                            <div key={event.id} className="flex items-start gap-2 sm:gap-3 pb-2 sm:pb-3 border-b border-gray-100 last:border-0">
                              <div className={`flex-shrink-0 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full mt-1.5 ${
                                idx === 0 ? 'bg-indigo-600 ring-2 ring-indigo-200' : 'bg-indigo-300'
                              }`}></div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 mb-1">
                                  <div className="flex-1">
                                    <span className="text-xs sm:text-sm font-semibold text-gray-900">
                                      {event.from_status ? `${t(`scanner.statuses.${event.from_status}`)} → ` : ''}
                                      <span className="text-indigo-600">{t(`scanner.statuses.${event.to_status}`)}</span>
                                    </span>
                                  </div>
                                  <span className="text-xs text-gray-500 whitespace-nowrap">
                                    {event.scanned_at ? new Date(event.scanned_at).toLocaleDateString('en-US', { 
                                      month: 'short', 
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    }) : ''}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600 flex flex-wrap items-center gap-1.5 sm:gap-2">
                                  {event.location && <span>📍 {event.location}</span>}
                                  {event.scanned_by_user?.name && <span>• 👤 {event.scanned_by_user.name}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Raw Contents Note (if not JSON) */}
                    {!packageDetails.name && !packageDetails.items && scannedPackage.contents_note && (
                      <div className="bg-yellow-50 rounded-lg p-3 sm:p-4 mb-4 border border-yellow-200">
                        <h4 className="text-xs sm:text-sm font-semibold text-yellow-900 mb-2">{t('scanner.contentsNote')}</h4>
                        <p className="text-xs sm:text-sm text-gray-900 whitespace-pre-wrap">{scannedPackage.contents_note}</p>
                      </div>
                    )}
                  </>
                )
              })()}

              {/* Two-Step Status Update Flow */}
              {!showUpdateStatus ? (
                /* Step 1: View package, show Update Status button - Mobile Simplified */
                <div className="sticky bottom-0 bg-white border-t border-gray-200 p-3 sm:p-4 md:p-6 shadow-2xl -mx-4 sm:-mx-6 -mb-4 sm:-mb-6">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 max-w-4xl mx-auto">
                    <button
                      onClick={() => setShowUpdateStatus(true)}
                      className="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-3 sm:py-4 px-4 sm:px-6 rounded-lg sm:rounded-xl transition-all shadow-lg hover:shadow-xl text-sm sm:text-base"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {t('scanner.updateStatus')}
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setShowStatusModal(false)
                        setScannedPackage(null)
                        setSelectedStatus(null)
                        setShowUpdateStatus(false)
                        setIsScanning(true)
                      }}
                      className="flex-1 bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-900 font-semibold py-3 sm:py-4 px-4 sm:px-6 rounded-lg sm:rounded-xl transition-all hover:bg-gray-50 text-sm sm:text-base"
                    >
                      {t('common.close')}
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 2: Status picker with confirmation - Mobile Simplified */
                <>
                  <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md p-4 sm:p-5 border border-gray-200">
                    <label className="block text-sm sm:text-base font-bold text-gray-900 mb-3 sm:mb-4">
                      {t('scanner.selectNewStatus')}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      {(['just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'] as PackageStatus[]).map((status) => (
                        <button
                          key={status}
                          onClick={() => setSelectedStatus(status)}
                          className={`w-full text-left px-3 sm:px-4 py-2.5 sm:py-4 rounded-lg sm:rounded-xl border-2 transition-all ${
                            selectedStatus === status
                              ? 'border-red-500 bg-red-50 text-red-700 shadow-md'
                              : scannedPackage.status === status
                              ? 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm'
                          }`}
                          disabled={scannedPackage.status === status}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs sm:text-sm">{t(`scanner.statuses.${status}`)}</span>
                            {selectedStatus === status && (
                              <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
                            )}
                            {scannedPackage.status === status && (
                              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full">{t('scanner.currentStatus')}</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Optional Note */}
                  <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md p-4 sm:p-5 border border-gray-200">
                    <label className="block text-xs sm:text-sm font-bold text-gray-900 mb-2 sm:mb-3">
                      {t('scanner.optionalNote')}
                    </label>
                    <textarea
                      value={updateNote}
                      onChange={(e) => setUpdateNote(e.target.value)}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none text-sm sm:text-base"
                      rows={3}
                      placeholder={t('scanner.notePlaceholder')}
                    />
                  </div>

                  {/* Action Buttons - Confirm or Cancel */}
                  <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-2xl -mx-4 sm:-mx-6 -mb-4 sm:-mb-6">
                    <div className="flex flex-col sm:flex-row gap-3 max-w-4xl mx-auto">
                      <button
                        onClick={async () => {
                          if (!selectedStatus || !scannedPackage) {
                            toast.error(t('scanner.selectStatus'))
                            return
                          }

                          try {
                            setIsProcessingScan(true)
                            const currentStatus = scannedPackage.status
                            const currentLocation = scannedPackage.current_location || 'Main Office'

                            console.log('[Status Update] Attempting to update:', {
                              packageId: scannedPackage.id,
                              packageCode: scannedPackage.short_code,
                              fromStatus: currentStatus,
                              toStatus: selectedStatus
                            })

                            // Update package status - single transaction
                            const { data: updateData, error: updateError } = await supabase
                              .from('packages')
                              .update({
                                status: selectedStatus,
                                current_location: currentLocation
                              })
                              .eq('id', scannedPackage.id)
                              .select()

                            console.log('[Status Update] Update result:', { updateData, updateError })

                            if (updateError) {
                              console.error('[Status Update] Error details:', {
                                message: updateError.message,
                                code: updateError.code,
                                details: updateError.details,
                                hint: updateError.hint
                              })
                              // Show more detailed error message
                              const errorMsg = updateError.message || updateError.code || 'Unknown error'
                              toast.error(`${t('scanner.errorUpdating')}: ${errorMsg}`, { duration: 5000 })
                              setIsProcessingScan(false)
                              return
                            }

                            if (!updateData || updateData.length === 0) {
                              console.error('[Status Update] No data returned from update')
                              toast.error(t('scanner.errorUpdating') + ': No package was updated', { duration: 5000 })
                              setIsProcessingScan(false)
                              return
                            }

                            console.log('[Status Update] Success! Updated package:', updateData[0])

                            // Record status history with user, timestamp, location, and note
                            const { error: historyError } = await supabase
                              .from('package_status_history')
                              .insert({
                                package_id: scannedPackage.id,
                                from_status: currentStatus,
                                to_status: selectedStatus,
                                location: currentLocation,
                                scanned_by: user?.id || '',
                                scanned_at: new Date().toISOString(),
                                note: updateNote || null
                              })

                            if (historyError) {
                              console.error('Status history error:', historyError)
                              // Don't fail the whole operation if history fails, but log it
                              console.warn('Failed to record status history, but status was updated')
                            }

                            toast.success(t('scanner.packageUpdated', { code: scannedPackage.short_code }))

                            // Record the scan
                            await recordScan(scannedPackage.id, scannedPackage.short_code, 'QR_CODE', currentLocation)

                            // Refresh package data and history
                            const { data: updatedPackage } = await supabase
                              .from('packages')
                              .select(`
                                *,
                                destination_branch:branches(name, code),
                                created_by_user:users!packages_created_by_fkey(name)
                              `)
                              .eq('id', scannedPackage.id)
                              .single()

                            const { data: newHistory } = await supabase
                              .from('package_status_history')
                              .select(`
                                *,
                                scanned_by_user:users!package_status_history_scanned_by_fkey(name)
                              `)
                              .eq('package_id', scannedPackage.id)
                              .order('scanned_at', { ascending: false })
                              .limit(10)

                            // Update state with fresh data
                            setScannedPackage(updatedPackage)
                            setStatusHistory(newHistory || [])
                            setSelectedStatus(null)
                            setUpdateNote('')
                            setShowUpdateStatus(false)
                            setIsProcessingScan(false)

                            toast.success(t('scanner.statusUpdated'), { duration: 2000 })
                            
                            // Automatically close modal and return to QR scanning after a short delay
                            setTimeout(() => {
                              setShowStatusModal(false)
                              setScannedPackage(null)
                              setSelectedStatus(null)
                              setUpdateNote('')
                              setStatusHistory([])
                              setIsScanning(true)
                            }, 1500) // Wait 1.5 seconds to show success message
                          } catch (error: any) {
                            console.error('Error updating status:', error)
                            // Show detailed error message
                            const errorMsg = error?.message || error?.code || 'Unknown error'
                            toast.error(`${t('scanner.errorUpdating')}: ${errorMsg}`)
                            setIsProcessingScan(false)
                          }
                        }}
                        disabled={!selectedStatus || selectedStatus === scannedPackage.status || isProcessingScan}
                        title={!selectedStatus ? t('scanner.selectStatus') : selectedStatus === scannedPackage.status ? 'Status is already ' + t(`scanner.statuses.${selectedStatus}`) : ''}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md text-sm sm:text-base"
                      >
                        {isProcessingScan ? t('scanner.saving') : t('scanner.confirmSave')}
                      </button>
                      <button
                        onClick={() => {
                          setShowUpdateStatus(false)
                          setSelectedStatus(null)
                          setUpdateNote('')
                        }}
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold py-3 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors text-sm sm:text-base"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Scanner View - Simplified for Mobile
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Header - Simplified for Mobile */}
      <div className="bg-white/95 backdrop-blur-sm p-3 sm:p-4 border-b border-gray-200 z-30 relative">
        {/* Mode Tabs */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex bg-gray-100 rounded-lg p-1 w-full max-w-xs">
            <button
              onClick={() => {
                setScanMode('single')
                setBulkSelectedStatus(null)
                setBulkUpdatedPackages([])
                if (!isScanning) setIsScanning(true)
              }}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                scanMode === 'single'
                  ? 'bg-white text-red-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('scanner.singleScan')}
            </button>
            <button
              onClick={() => {
                setScanMode('bulk')
                setScannedPackage(null)
                setShowStatusModal(false)
                if (!isScanning) setIsScanning(true)
              }}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                scanMode === 'bulk'
                  ? 'bg-white text-red-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('scanner.bulkUpdate')}
            </button>
          </div>
          <div className="flex items-center space-x-1 sm:space-x-2">
            <button
              onClick={resetScanner}
              className="p-2 sm:p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('scanner.reset')}
              aria-label={t('scanner.reset')}
            >
              <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <button
              onClick={toggleFlash}
              disabled={!hasFlash}
            className={`p-2 sm:p-2.5 rounded-lg transition-colors ${
              hasFlash 
                ? flashOn 
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                : 'text-gray-400 cursor-not-allowed opacity-50'
            }`}
            title={hasFlash ? (flashOn ? t('scanner.flashOff') : t('scanner.flash')) : t('scanner.flashUnavailable')}
            aria-label={hasFlash ? (flashOn ? t('scanner.flashOff') : t('scanner.flash')) : t('scanner.flashUnavailable')}
            >
              {flashOn ? <FlashlightOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Flashlight className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 sm:p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('scanner.close')}
              aria-label={t('scanner.close')}
            >
              <XCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>
        
        {/* Bulk Mode Status Selector */}
        {scanMode === 'bulk' && (
          <div className="mt-3">
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              {t('scanner.selectStatusForBulk')}:
            </label>
            <select
              value={bulkSelectedStatus || ''}
              onChange={(e) => {
                setBulkSelectedStatus(e.target.value as PackageStatus || null)
                setBulkUpdatedPackages([])
              }}
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white text-sm font-semibold"
            >
              <option value="">{t('scanner.selectStatusFirst')}</option>
              {(['just_created', 'created', 'envelope_prepared', 'queued_for_print', 'printed', 'handed_over', 'in_transit', 'at_branch', 'delivered', 'returned', 'canceled'] as PackageStatus[]).map((status) => (
                <option key={status} value={status}>
                  {t(`scanner.statuses.${status}`)}
                </option>
              ))}
            </select>
            {bulkSelectedStatus && (
              <p className="mt-2 text-xs text-gray-600">
                {t('scanner.scanToUpdate')}: <span className="font-bold text-red-600">{t(`scanner.statuses.${bulkSelectedStatus}`)}</span>
              </p>
            )}
          </div>
        )}
        
        {/* Bulk Update Results */}
        {scanMode === 'bulk' && bulkUpdatedPackages.length > 0 && (
          <div className="mt-3 max-h-32 overflow-y-auto bg-gray-50 rounded-lg p-2 border border-gray-200">
            <p className="text-xs font-semibold text-gray-700 mb-1">
              {t('scanner.updated')}: {bulkUpdatedPackages.filter(p => p.success).length} / {bulkUpdatedPackages.length}
            </p>
            <div className="space-y-1">
              {bulkUpdatedPackages.slice(-5).map((pkg, idx) => (
                <div key={idx} className={`text-xs px-2 py-1 rounded ${
                  pkg.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {pkg.code} {pkg.success ? '✓' : `✗ ${pkg.error}`}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating Close Button for Mobile - Always Visible */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 sm:hidden bg-white/95 backdrop-blur-sm hover:bg-white border-2 border-gray-300 hover:border-red-500 rounded-full p-3 shadow-lg z-[60] transition-all"
        title={t('scanner.close')}
        aria-label={t('scanner.close')}
        style={{ 
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 60
        }}
      >
        <XCircle className="w-6 h-6 text-gray-900" />
      </button>

      {/* Scanner Area */}
      <div className="flex-1 relative bg-black">
        <div 
          id="barcode-scanner" 
          className="w-full h-full" 
          style={{ 
            position: 'relative',
            visibility: isScanning ? 'visible' : 'hidden',
            display: 'block'
          }} 
        />
        
        {/* Loading overlay - Simplified */}
        {isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 z-20">
            <div className="text-center text-white p-4 sm:p-6">
              <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-2 border-white mx-auto mb-3 sm:mb-4"></div>
              <p className="text-base sm:text-lg mb-1 sm:mb-2 font-medium">{t('scanner.startingCamera')}</p>
              <p className="text-xs sm:text-sm opacity-75">{t('scanner.allowCameraAccess')}</p>
            </div>
          </div>
        )}
        
        {/* Error overlay - Simplified */}
        {error && !isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-90 z-20">
            <div className="text-center text-white p-4 sm:p-6 max-w-md mx-4">
              <CameraOff className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 opacity-50" />
              <p className="text-base sm:text-lg mb-2 font-medium">{t('scanner.cameraError')}</p>
              <p className="text-xs sm:text-sm mb-4 opacity-75 whitespace-pre-line">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  startScanner()
                }}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 sm:py-3 px-6 sm:px-8 rounded-lg transition-colors text-sm sm:text-base"
              >
                {t('scanner.tryAgain')}
              </button>
            </div>
          </div>
        )}
        
        {/* Stopped state - Simplified */}
        {!isScanning && !error && !isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-20">
            <div className="text-center text-white p-4">
              <CameraOff className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 opacity-50" />
              <p className="text-base sm:text-lg mb-4">{t('scanner.stopped')}</p>
              <button
                onClick={() => setIsScanning(true)}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 sm:py-3 px-6 sm:px-8 rounded-lg transition-colors text-sm sm:text-base"
              >
                {t('scanner.startScanning')}
              </button>
            </div>
          </div>
        )}

        {/* Scanning Overlay - Simplified for Mobile */}
        {isScanning && !error && !isInitializing && (
          <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
              <div className="w-64 h-64 sm:w-80 sm:h-80 border-4 border-white rounded-lg shadow-2xl" style={{ 
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5), 0 0 30px rgba(255,255,255,0.8)' 
              }}>
                <div className="absolute top-0 left-0 w-8 h-8 sm:w-12 sm:h-12 border-t-4 border-l-4 border-red-500 rounded-tl-lg"></div>
                <div className="absolute top-0 right-0 w-8 h-8 sm:w-12 sm:h-12 border-t-4 border-r-4 border-red-500 rounded-tr-lg"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 sm:w-12 sm:h-12 border-b-4 border-l-4 border-red-500 rounded-bl-lg"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 sm:w-12 sm:h-12 border-b-4 border-r-4 border-red-500 rounded-br-lg"></div>
              </div>
            </div>
            {/* Simplified instructions for mobile */}
            <div className="absolute bottom-4 sm:bottom-8 left-0 right-0 text-center text-white z-20 px-4" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.9)' }}>
              <p className="text-base sm:text-lg md:text-xl font-bold mb-1 sm:mb-2">{t('scanner.positionBarcode')}</p>
              <p className="text-xs sm:text-sm opacity-90 hidden sm:block">{t('scanner.supportsFormats')}</p>
              <p className="text-xs opacity-75 hidden md:block">{t('scanner.holdDistance')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Stats - Simplified for Mobile */}
      <div className="bg-white/95 backdrop-blur-sm p-3 sm:p-4 border-t border-gray-200">
        <div className="flex justify-between items-center text-xs sm:text-sm">
          <div className="flex items-center space-x-2">
            <span className="text-gray-600 font-medium">{t('scanner.scans')}: {scanCount}</span>
          </div>
          <div className="flex items-center space-x-2">
            {isScanning && !error && !isInitializing && (
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-600 font-medium text-xs sm:text-sm">{t('scanner.scanning')}</span>
              </div>
            )}
            {isInitializing && (
              <span className="text-gray-500 text-xs sm:text-sm">{t('scanner.initializing')}</span>
            )}
            {error && (
              <span className="text-red-600 text-xs sm:text-sm">{t('scanner.error')}</span>
            )}
            {!isScanning && !isInitializing && !error && (
              <span className="text-gray-500 text-xs sm:text-sm">{t('scanner.stopped')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
