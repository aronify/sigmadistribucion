import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../lib/auth'
import { getLogoUrl } from '../../lib/supabase'
import { useTranslation } from 'react-i18next'

interface PinLoginProps {
  onSuccess: () => void
}

export function PinLogin({ onSuccess }: PinLoginProps) {
  const { login } = useAuth()
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [logo, setLogo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback(async () => {
    if (pin.length !== 6) return
    
    setIsLoading(true)
    
    try {
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
  }, [pin, login, onSuccess])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
    
    const logoUrl = getLogoUrl()
    setLogo(logoUrl)
  }, [])

  useEffect(() => {
    if (pin.length === 6 && !isLoading) {
      const timer = setTimeout(() => {
        handleSubmit()
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [pin.length, isLoading, handleSubmit])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (pin.length === 6) {
        handleSubmit()
      }
    } else if (e.key === 'Backspace') {
      // Allow backspace to work naturally with the input
    } else if (e.key >= '0' && e.key <= '9') {
      // Allow numbers to work naturally with the input
    } else if (e.key.length === 1) {
      // Prevent non-numeric characters
      e.preventDefault()
    }
  }

  const handleBarcodeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const digitsOnly = value.replace(/\D/g, '')
    
    if (digitsOnly.length > 6) {
      const extractedPin = digitsOnly.slice(-6)
      setPin(extractedPin)
    } else if (digitsOnly.length <= 6) {
      setPin(digitsOnly)
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
                target.style.display = 'none'
              }}
              onLoad={() => {
                console.log('[Logo] Logo loaded successfully from:', logo || getLogoUrl())
              }}
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('login.title')}</h1>
          <p className="text-gray-600">{t('login.subtitle')}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          {/* Hidden input for keyboard typing and barcode scanning */}
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={handleBarcodeInput}
            onKeyDown={handleKeyPress}
            className="sr-only"
            placeholder={t('login.placeholder')}
            maxLength={6}
            disabled={isLoading}
            autoFocus
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
              {t('login.instruction')}
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
              {t('login.clear')}
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
              {isLoading ? t('login.signingIn') : t('login.signin')}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
