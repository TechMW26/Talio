'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt, FaEdit, FaArrowLeft, FaBriefcase, FaCalendarAlt } from 'react-icons/fa'
import { formatDesignation, formatDepartments } from '@/lib/formatters'

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [employee, setEmployee] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (params.id) {
      fetchEmployee()
    }
  }, [params.id])

  const fetchEmployee = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${params.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setEmployee(data.data)
      } else {
        toast.error(data.message)
        router.push('/dashboard/employees')
      }
    } catch (error) {
      console.error('Fetch employee error:', error)
      toast.error('Failed to fetch employee details')
      router.push('/dashboard/employees')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading employee details...</p>
        </div>
      </div>
    )
  }

  if (!employee) {
    return null
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push('/dashboard/employees')}
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-800"
        >
          <FaArrowLeft />
          <span>Back to Employees</span>
        </button>
        <button
          onClick={() => router.push(`/dashboard/employees/edit/${employee._id}`)}
          className="btn-primary flex items-center space-x-2"
        >
          <FaEdit />
          <span>Edit Employee</span>
        </button>
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-start space-x-6">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
            {employee.profilePicture ? (
              <img
                src={employee.profilePicture}
                alt={`${employee.firstName} ${employee.lastName}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-3xl font-bold text-white">
                {employee.firstName?.[0]}{employee.lastName?.[0]}
              </span>
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-800">
              {employee.firstName} {employee.lastName}
            </h1>
            <p className="text-lg text-gray-600 mt-1">
              {formatDesignation(employee.designation, employee)} • {formatDepartments(employee)}
            </p>
            <div className="flex items-center space-x-4 mt-4">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${employee.status === 'active' ? 'bg-green-100 text-green-800' :
                  employee.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                    'bg-red-100 text-red-800'
                }`}>
                {employee.status}
              </span>
              <span className="text-gray-600">
                Employee ID: <span className="font-semibold">{employee.employeeCode}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Personal Information</h2>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <FaEnvelope className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Email</p>
                <p className="font-medium text-gray-800">{employee.email}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaPhone className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Phone</p>
                <p className="font-medium text-gray-800">{employee.phone || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaCalendarAlt className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Date of Birth</p>
                <p className="font-medium text-gray-800">
                  {employee.dateOfBirth
                    ? new Date(employee.dateOfBirth).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaUser className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Gender</p>
                <p className="font-medium text-gray-800">{employee.gender || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaMapMarkerAlt className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Address</p>
                <p className="font-medium text-gray-800">{employee.address || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Employment Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Employment Information</h2>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Department(s)</p>
                <p className="font-medium text-gray-800">{formatDepartments(employee)}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Designation</p>
                <p className="font-medium text-gray-800">
                  {formatDesignation(employee.designation, employee)}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaCalendarAlt className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Date of Joining</p>
                <p className="font-medium text-gray-800">
                  {employee.dateOfJoining
                    ? new Date(employee.dateOfJoining).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Employment Type</p>
                <p className="font-medium text-gray-800">{employee.employmentType || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Work Location</p>
                <p className="font-medium text-gray-800">{employee.workLocation || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Emergency Contact */}
        {employee.emergencyContact && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Emergency Contact</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Name</p>
                <p className="font-medium text-gray-800">
                  {employee.emergencyContact.name || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Relationship</p>
                <p className="font-medium text-gray-800">
                  {employee.emergencyContact.relationship || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Phone</p>
                <p className="font-medium text-gray-800">
                  {employee.emergencyContact.phone || 'N/A'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bank Details */}
        {employee.bankDetails && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Bank Details</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Bank Name</p>
                <p className="font-medium text-gray-800">
                  {employee.bankDetails.bankName || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Account Number</p>
                <p className="font-medium text-gray-800">
                  {employee.bankDetails.accountNumber || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">IFSC Code</p>
                <p className="font-medium text-gray-800">
                  {employee.bankDetails.ifscCode || 'N/A'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

