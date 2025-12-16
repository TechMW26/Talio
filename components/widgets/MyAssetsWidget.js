'use client'
import { useState, useEffect } from 'react'
import { FaLaptop, FaBarcode } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getEmployeeId } from '@/utils/userHelper'

export default function MyAssetsWidget({ user }) {
  const router = useRouter()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) fetchAssets()
  }, [user])

  const fetchAssets = async () => {
    try {
      const employeeId = getEmployeeId(user)
      if (!employeeId) return
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/assets?employeeId=${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) setAssets(data.data)
    } catch (error) {
      console.error('Error fetching assets:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
  <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">My Assets</h3>
        <span className="text-xs font-medium bg-primary-100 text-primary-800 px-2 py-1 rounded-full">
          {assets.length}
        </span>
      </div>
      {assets.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <FaLaptop className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No assets assigned</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {assets.map(asset => (
            <div key={asset._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{asset.name}</p>
                <p className="text-xs text-gray-500">{asset.assetId || asset.uin}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${
                asset.status === 'active' ? 'bg-green-100 text-green-700' :
                asset.status === 'maintenance' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {asset.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
