import { getLogoUrl } from '../lib/supabase'

/**
 * Logo utility functions for loading and converting logos to base64
 * for reliable printing
 */

// Logo cache
let logoCache: string | null = null

/**
 * Converts logo image to base64 for reliable printing
 * Uses Supabase Storage URL
 */
export const loadLogoAsBase64 = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
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
      
      img.onerror = () => {
        console.warn(`[Logo] Failed to load from: ${path}`)
        currentPathIndex++
        tryNextPath()
      }
    }
    
    tryNextPath()
  })
}

/**
 * Preload logo and cache it
 * Uses Supabase Storage URL
 */
export const preloadLogo = async (): Promise<string> => {
  if (logoCache) {
    return logoCache
  }
  
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
      console.warn(`[Logo] HTTP ${response.status} for Supabase Storage`)
    }
  } catch (error) {
    console.warn(`[Logo] Failed to preload from Supabase Storage:`, error)
  }
  
  console.log('[Logo] Using Supabase Storage URL')
  return supabaseLogoUrl
}



