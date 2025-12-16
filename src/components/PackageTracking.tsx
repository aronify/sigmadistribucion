import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTranslation } from 'react-i18next'

export function PackageTracking() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [packageData, setPackageData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusHistory, setStatusHistory] = useState<any[]>([])

  useEffect(() => {
    if (!code) {
      setError(t('packages.tracking.packageNotFound'))
      setLoading(false)
      return
    }

    loadPackageData()
  }, [code, t])

  const loadPackageData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Try to find package by short_code
      const { data: packageData, error: packageError } = await supabase
        .from('packages')
        .select(`
          *,
          destination_branch:branches(name, code, address),
          created_by_user:users!packages_created_by_fkey(name)
        `)
        .eq('short_code', code.toUpperCase())
        .maybeSingle()

      if (packageError) {
        throw packageError
      }

      if (!packageData) {
        setError(t('packages.tracking.packageNotFound'))
        setLoading(false)
        return
      }

      setPackageData(packageData)

      // Load status history
      const { data: historyData } = await supabase
        .from('package_status_history')
        .select(`
          *,
          scanned_by_user:users!package_status_history_scanned_by_fkey(name)
        `)
        .eq('package_id', packageData.id)
        .order('scanned_at', { ascending: false })
        .limit(20)

      if (historyData) {
        setStatusHistory(historyData)
      }
    } catch (err: any) {
      console.error('Error loading package:', err)
      setError(err.message || t('packages.tracking.packageNotFound'))
    } finally {
      setLoading(false)
    }
  }

  const parsePackageContents = (contentsNote: string) => {
    const lines = contentsNote.split('\n').filter(l => l.trim())
    let recipientName = ''
    let recipientCompany = ''
    let deliveryAddress = ''
    const items: Array<{ product: string; quantity: number }> = []

    for (const line of lines) {
      if (line.startsWith('To: ')) {
        const toLine = line.substring(4).trim()
        const pipeMatch = toLine.match(/^(.+?)\s*\|\s*(.+)$/)
        const parenMatch = toLine.match(/^(.+?)\s+\((.+)\)\s*$/)
        
        if (pipeMatch) {
          recipientName = pipeMatch[1].trim()
          recipientCompany = pipeMatch[2].trim()
        } else if (parenMatch) {
          recipientName = parenMatch[1].trim()
          recipientCompany = parenMatch[2].trim()
        } else {
          recipientName = toLine
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
      } else if (line.trim() && !line.startsWith('To: ') && !line.startsWith('Items: ')) {
        if (!deliveryAddress) {
          deliveryAddress = line.trim()
        } else {
          deliveryAddress += '\n' + line.trim()
        }
      }
    }

    return { recipientName, recipientCompany, deliveryAddress, items }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'just_created': 'bg-emerald-100 text-emerald-800 border-emerald-300',
      'created': 'bg-blue-100 text-blue-800 border-blue-300',
      'queued_for_print': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'printed': 'bg-purple-100 text-purple-800 border-purple-300',
      'handed_over': 'bg-indigo-100 text-indigo-800 border-indigo-300',
      'in_transit': 'bg-orange-100 text-orange-800 border-orange-300',
      'at_branch': 'bg-cyan-100 text-cyan-800 border-cyan-300',
      'delivered': 'bg-green-100 text-green-800 border-green-300',
      'returned': 'bg-red-100 text-red-800 border-red-300',
      'canceled': 'bg-gray-100 text-gray-800 border-gray-300'
    }
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300'
  }

  const getStatusIcon = (status: string) => {
    const icons: Record<string, string> = {
      'just_created': '✨',
      'created': '📦',
      'queued_for_print': '🖨️',
      'printed': '✅',
      'handed_over': '🤝',
      'in_transit': '🚚',
      'at_branch': '🏢',
      'delivered': '🎉',
      'returned': '↩️',
      'canceled': '❌'
    }
    return icons[status] || '📦'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">{t('packages.tracking.loading')}</p>
        </div>
      </div>
    )
  }

  if (error || !packageData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">📦</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('packages.tracking.packageNotFound')}</h1>
          <p className="text-gray-600 mb-6">{error || t('packages.tracking.packageNotFoundDesc')}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {t('packages.tracking.goToHome')}
          </button>
        </div>
      </div>
    )
  }

  const parsed = parsePackageContents(packageData.contents_note || '')

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('packages.tracking.title')}</h1>
              <p className="text-gray-600 mt-1">{t('packages.tracking.subtitle')}</p>
            </div>
            <button
              onClick={() => window.location.href = '/'}
              className="text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t('packages.tracking.home')}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Package Code Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">{t('packages.packageCode')}</p>
              <h2 className="text-3xl font-bold font-mono text-gray-900">{packageData.short_code}</h2>
            </div>
            <div className={`px-4 py-2 rounded-lg border-2 font-semibold ${getStatusColor(packageData.status)}`}>
              <span className="text-lg mr-2">{getStatusIcon(packageData.status)}</span>
              {t(`scanner.statuses.${packageData.status}`) || packageData.status.replace(/_/g, ' ')}
            </div>
          </div>
        </div>

        {/* Recipient & Address Card */}
        {(parsed.recipientName || parsed.recipientCompany || parsed.deliveryAddress) && (
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">👤</span>
              {t('packages.tracking.recipientInfo')}
            </h3>
            <div className="space-y-3">
              {(parsed.recipientName || parsed.recipientCompany) && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">{t('packages.tracking.name')}</p>
                  <p className="font-semibold text-gray-900">
                    {parsed.recipientName}
                    {parsed.recipientCompany && ` | ${parsed.recipientCompany}`}
                  </p>
                </div>
              )}
              {parsed.deliveryAddress && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">{t('packages.deliveryAddress')}</p>
                  <p className="font-medium text-gray-900 whitespace-pre-line">{parsed.deliveryAddress}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Contents Card */}
        {parsed.items && parsed.items.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">📋</span>
              {t('packages.tracking.packageContents')}
            </h3>
            <div className="space-y-2">
              {parsed.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <span className="font-medium text-gray-900">{item.product}</span>
                  <span className="text-gray-600">x{item.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Package Details Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <span className="mr-2">ℹ️</span>
            {t('packages.tracking.packageDetails')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">{t('packages.currentLocation')}</p>
              <p className="font-medium text-gray-900">{packageData.current_location || t('packages.noNotes')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">{t('packages.origin')}</p>
              <p className="font-medium text-gray-900">{packageData.origin || t('packages.noNotes')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">{t('packages.createdAt')}</p>
              <p className="font-medium text-gray-900">
                {new Date(packageData.created_at).toLocaleString()}
              </p>
            </div>
            {packageData.created_by_user && (
              <div>
                <p className="text-sm text-gray-600 mb-1">{t('packages.createdBy')}</p>
                <p className="font-medium text-gray-900">{packageData.created_by_user.name}</p>
              </div>
            )}
          </div>
        </div>

        {/* Status History Card */}
        {statusHistory.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">📊</span>
              {t('packages.tracking.statusHistory')}
            </h3>
            <div className="space-y-3">
              {statusHistory.map((event, idx) => (
                <div key={event.id} className="flex items-start space-x-4 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="flex-shrink-0 mt-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${getStatusColor(event.to_status)}`}>
                      {getStatusIcon(event.to_status)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-gray-900">
                        {t(`scanner.statuses.${event.to_status}`) || event.to_status.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(event.scanned_at).toLocaleString()}
                      </p>
                    </div>
                    {event.location && (
                      <p className="text-sm text-gray-600 mt-1">📍 {event.location}</p>
                    )}
                    {event.scanned_by_user && (
                      <p className="text-sm text-gray-600">👤 {event.scanned_by_user.name}</p>
                    )}
                    {event.note && (
                      <p className="text-sm text-gray-500 mt-1 italic">{event.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

