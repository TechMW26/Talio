'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FaSearch, FaUser } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { Card, CardBody, Button, Input, Avatar, Skeleton, ScrollShadow } from '@heroui/react'

export default function EmployeeDirectoryWidget() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const { data, error, isLoading } = useAuthedSWR('/api/employees?limit=20&status=active', {
    refreshInterval: 300_000,
  })

  const employees = data?.data || []

  const filteredEmployees = employees.filter(emp =>
    `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    emp.email?.toLowerCase().includes(search.toLowerCase()) ||
    emp.employeeCode?.toLowerCase().includes(search.toLowerCase())
  )

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-10 w-full rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-full" />
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

  if (error) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <h3 className="text-base sm:text-lg font-bold text-default-900 mb-4">Employee Directory</h3>
        <p className="text-sm text-default-500">Unable to load employees.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Employee Directory</h3>
        <Button
          variant="light"
          color="primary"
          size="sm"
          onPress={() => router.push('/dashboard/employees')}
        >
          View All
        </Button>
      </div>

      {/* Search */}
      <Input
        placeholder="Search employees..."
        value={search}
        onValueChange={setSearch}
        startContent={<FaSearch className="text-default-400" />}
        size="sm"
        variant="bordered"
        classNames={{
          inputWrapper: "bg-default-50 dark:bg-[#18181b] shadow-none",
        }}
        className="mb-4"
      />

      {/* Employee List */}
      <ScrollShadow className="space-y-2 max-h-[200px]">
        {filteredEmployees.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-6">
            <div className="w-14 h-14 rounded-full bg-default-100 flex items-center justify-center mb-3">
              <FaUser className="w-7 h-7 text-default-400" />
            </div>
            <p className="text-sm text-default-500">No employees match your search</p>
          </div>
        ) : (
          filteredEmployees.slice(0, 8).map((emp) => (
            <Card
              key={emp._id}
              isPressable
              onPress={() => router.push(`/dashboard/employees/${emp._id}`)}
              className="border border-default-100"
            >
              <CardBody className="p-2">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={emp.profilePicture}
                    name={`${emp.firstName?.charAt(0) || ''}${emp.lastName?.charAt(0) || ''}`}
                    size="sm"
                    className="bg-primary-100 text-primary-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-default-900 truncate">
                      {emp.firstName} {emp.lastName}
                    </p>
                    <p className="text-xs text-default-500 truncate">
                      {emp.designation?.title || emp.employeeCode}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </ScrollShadow>
    </div>
  )
}
