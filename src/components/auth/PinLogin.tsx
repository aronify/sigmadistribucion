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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-red-100 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          {logo && (
            <img 
              src={logo} 
              alt="Logo" 
              className="h-16 mx-auto mb-6 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          )}
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {t('login.welcome')}
          </h1>
          <p className="text-gray-600">
            {t('login.enterPin')}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="pin" className="block text-sm font-medium text-gray-700 mb-2">
              {t('login.pin')}
            </label>
            <input
              ref={inputRef}
              id="pin"
              type="password"
              value={pin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6)
                setPin(value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pin.length === 6) {
                  handleSubmit()
                }
              }}
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="000000"
              maxLength={6}
              disabled={isLoading}
              autoComplete="off"
            />
            <p className="mt-2 text-sm text-gray-500 text-center">
              {pin.length}/6 {t('login.digits')}
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={pin.length !== 6 || isLoading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {isLoading ? t('login.loading') : t('login.submit')}
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>{t('login.scanBarcode')}</p>
        </div>
      </div>
    </div>
  )
}

