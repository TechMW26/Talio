'use client'
import { useState, useEffect } from 'react'
import { FaLaptop, FaBarcode } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getEmployeeId } from '@/utils/userHelper'
import { Card, CardBody, Chip, Skeleton, ScrollShadow } from '@heroui/react'

export default function MyAssetsWidget({ user, initialData }) {
  const router = useRouter()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Data provided from unified dashboard call (including empty array)
    if (initialData !== undefined) {
      setAssets(initialData)
      setLoading(false)
      return
    }
    // undefined = standalone mode, self-fetch
    if (user) fetchAssets()
  }, [user, initialData])

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

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'success'
      case 'maintenance': return 'warning'
      default: return 'default'
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-lg" />
                <Skeleton className="h-3 w-1/2 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">My Assets</h3>
        <Chip size="sm" color="primary" variant="flat">
          {assets.length}
        </Chip>
      </div>
      <ScrollShadow className="space-y-2 max-h-[200px]">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-6">
            <img
              src="/assets/Assets.png"
              alt="No assets assigned"
              className="w-24 h-24 object-contain mb-3"
            />
            <p className="text-sm text-default-500">No assets assigned</p>
          </div>
        ) : (
          assets.map(asset => (
            <Card key={asset._id} className="border border-default-100">
              <CardBody className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-default-900 truncate">{asset.name}</p>
                    <p className="text-xs text-default-500">{asset.assetId || asset.uin}</p>
                  </div>
                  <Chip size="sm" color={getStatusColor(asset.status)} variant="flat" className="capitalize">
                    {asset.status}
                  </Chip>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </ScrollShadow>
    </div>
  )
}
