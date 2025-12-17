import QRCode from 'qrcode'

/**
 * QR Code utility functions
 */

/**
 * Generate QR code as base64 data URL for a package tracking code
 */
export const generateQRCode = async (shortCode: string): Promise<string | null> => {
  try {
    const canvas = document.createElement('canvas')
    // Generate URL for tracking page
    const trackingUrl = `${window.location.origin}/track/${shortCode}`
    
    await QRCode.toCanvas(canvas, trackingUrl, {
      width: 800, // Higher resolution for better print quality at larger size
      margin: 8, // Extra quiet zone margin so slight cuts still leave readable code
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'H' // Highest error correction (30%) - best for low-quality printing
    })
    return canvas.toDataURL('image/png')
  } catch (error) {
    console.error('QR code generation error:', error)
    return null
  }
}

