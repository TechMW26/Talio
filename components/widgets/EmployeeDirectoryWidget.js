'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FaSearch, FaUser } from 'react-icons/fa'

export default function EmployeeDirectoryWidget() {
  const router = useRouter()
  const [employees, setEmployees] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchEmployees()
  }, [])

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=20&status=active', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredEmployees = employees.filter(emp =>
    `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    emp.email?.toLowerCase().includes(search.toLowerCase()) ||
    emp.employeeCode?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse">
        <div className="h-10 bg-gray-200 rounded mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
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
          <FaUser className="w-5 h-5 text-primary-500" />
          <h3 className="text-base sm:text-lg font-bold text-gray-800">Employee Directory</h3>
        </div>
        <button
          onClick={() => router.push('/dashboard/employees')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium"
        >
          View All
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      {/* Employee List */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {filteredEmployees.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <FaUser className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm">No employees found</p>
          </div>
        ) : (
          filteredEmployees.slice(0, 8).map((emp) => (
            <div
              key={emp._id}
              className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              onClick={() => router.push(`/dashboard/employees/${emp._id}`)}
            >
              <div className="w-10 h-10 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center flex-shrink-0">
                {emp.profilePicture ? (
                  <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FaUser className="w-4 h-4 text-primary-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {emp.firstName} {emp.lastName}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {emp.designation?.title || emp.employeeCode}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
