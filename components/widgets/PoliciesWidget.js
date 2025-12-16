'use client'
import { useState, useEffect } from 'react'
import { FaFileContract } from 'react-icons/fa'
import { useRouter } from 'next/navigation'

export default function PoliciesWidget() {
  const router = useRouter()
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPolicies()
  }, [])

  const fetchPolicies = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/policies?limit=3', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) setPolicies(data.data)
    } catch (error) {
      console.error('Error fetching policies:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse">
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
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FaFileContract className="w-5 h-5 text-primary-500" />
          <h3 className="text-base sm:text-lg font-bold text-gray-800">Policies</h3>
        </div>
        <button 
          onClick={() => router.push('/dashboard/policies')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium"
        >
          View All
        </button>
      </div>
      {policies.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <FaFileContract className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No policies found</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {policies.slice(0, 5).map(policy => (
            <div 
              key={policy._id} 
              className="flex items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              onClick={() => router.push('/dashboard/policies')}
            >
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                <FaFileContract className="w-4 h-4 text-primary-600" />
              </div>
              <p className="text-sm font-medium text-gray-800 truncate">{policy.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
