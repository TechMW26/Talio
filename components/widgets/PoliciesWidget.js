'use client'
import { useState, useEffect } from 'react'
import { FaFileContract } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Button, Skeleton, ScrollShadow } from '@heroui/react'

export default function PoliciesWidget({ initialData }) {
  const router = useRouter()
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(!initialData)

  useEffect(() => {
    // Skip fetch if initialData provided from unified dashboard call
    if (initialData) {
      setPolicies(initialData)
      setLoading(false)
      return
    }
    fetchPolicies()
  }, [initialData])

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
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <Skeleton className="h-4 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Policies</h3>
        <Button
          variant="light"
          color="primary"
          size="sm"
          onPress={() => router.push('/dashboard/policies')}
        >
          View All
        </Button>
      </div>
      {policies.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <img
            src="/assets/Policies.png"
            alt="No policies found"
            className="w-24 h-24 object-contain mb-3"
          />
          <p className="text-sm text-default-500">No policies found</p>
        </div>
      ) : (
        <ScrollShadow className="space-y-2 max-h-[200px]">
          {policies.slice(0, 5).map(policy => (
            <Card
              key={policy._id}
              isPressable
              onPress={() => router.push('/dashboard/policies')}
              className="border border-default-100"
            >
              <CardBody className="p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <FaFileContract className="w-4 h-4 text-primary-600" />
                  </div>
                  <p className="text-sm font-semibold text-default-900 truncate">{policy.title}</p>
                </div>
              </CardBody>
            </Card>
          ))}
        </ScrollShadow>
      )}
    </div>
  )
}
