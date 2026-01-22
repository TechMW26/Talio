'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaUser, FaEnvelope, FaPhone, FaMapMarkerAlt, FaEdit, FaArrowLeft, FaBriefcase, FaCalendarAlt } from 'react-icons/fa'
import { formatDesignation, formatDepartments } from '@/lib/formatters'
import { Card, CardBody, CardHeader, Button, Chip, Skeleton } from '@heroui/react'

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
        <Card shadow="sm">
          <CardBody className="p-8 text-center">
            <div className="space-y-4">
              <div className="flex items-start space-x-6">
                <Skeleton className="w-24 h-24 rounded-full" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-8 w-48 rounded-lg" />
                  <Skeleton className="h-5 w-64 rounded-lg" />
                  <Skeleton className="h-6 w-32 rounded-lg" />
                </div>
              </div>
            </div>
            <p className="mt-4 text-default-500">Loading employee details...</p>
          </CardBody>
        </Card>
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
        <Button
          variant="light"
          onPress={() => router.push('/dashboard/employees')}
          startContent={<FaArrowLeft />}
        >
          Back to Employees
        </Button>
        <Button
          color="primary"
          onPress={() => router.push(`/dashboard/employees/edit/${employee._id}`)}
          startContent={<FaEdit />}
        >
          Edit Employee
        </Button>
      </div>

      {/* Profile Card */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-6">
          <div className="flex items-start space-x-6">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0">
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
              <h1 className="text-3xl font-bold text-default-800">
                {employee.firstName} {employee.lastName}
              </h1>
              <p className="text-lg text-default-500 mt-1">
                {formatDesignation(employee.designation, employee)} • {formatDepartments(employee)}
              </p>
              <div className="flex items-center space-x-4 mt-4">
                <Chip 
                  color={employee.status === 'active' ? 'success' : employee.status === 'inactive' ? 'default' : 'danger'}
                  variant="flat"
                >
                  {employee.status}
                </Chip>
                <span className="text-default-500">
                  Employee ID: <span className="font-semibold text-default-800">{employee.employeeCode}</span>
                </span>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Information */}
        <Card shadow="sm">
          <CardHeader>
            <h2 className="text-xl font-bold text-default-800">Personal Information</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center space-x-3">
              <FaEnvelope className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Email</p>
                <p className="font-medium text-default-800">{employee.email}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaPhone className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Phone</p>
                <p className="font-medium text-default-800">{employee.phone || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaCalendarAlt className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Date of Birth</p>
                <p className="font-medium text-default-800">
                  {employee.dateOfBirth
                    ? new Date(employee.dateOfBirth).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaUser className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Gender</p>
                <p className="font-medium text-default-800">{employee.gender || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaMapMarkerAlt className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Address</p>
                <p className="font-medium text-default-800">{employee.address || 'N/A'}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Employment Information */}
        <Card shadow="sm">
          <CardHeader>
            <h2 className="text-xl font-bold text-default-800">Employment Information</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Department(s)</p>
                <p className="font-medium text-default-800">{formatDepartments(employee)}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Designation</p>
                <p className="font-medium text-default-800">
                  {formatDesignation(employee.designation, employee)}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaCalendarAlt className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Date of Joining</p>
                <p className="font-medium text-default-800">
                  {employee.dateOfJoining
                    ? new Date(employee.dateOfJoining).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Employment Type</p>
                <p className="font-medium text-default-800">{employee.employmentType || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <FaBriefcase className="text-default-400" />
              <div>
                <p className="text-sm text-default-500">Work Location</p>
                <p className="font-medium text-default-800">{employee.workLocation || 'N/A'}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Emergency Contact */}
        {employee.emergencyContact && (
          <Card shadow="sm">
            <CardHeader>
              <h2 className="text-xl font-bold text-default-800">Emergency Contact</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm text-default-500">Name</p>
                <p className="font-medium text-default-800">
                  {employee.emergencyContact.name || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-default-500">Relationship</p>
                <p className="font-medium text-default-800">
                  {employee.emergencyContact.relationship || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-default-500">Phone</p>
                <p className="font-medium text-default-800">
                  {employee.emergencyContact.phone || 'N/A'}
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Bank Details */}
        {employee.bankDetails && (
          <Card shadow="sm">
            <CardHeader>
              <h2 className="text-xl font-bold text-default-800">Bank Details</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm text-default-500">Bank Name</p>
                <p className="font-medium text-default-800">
                  {employee.bankDetails.bankName || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-default-500">Account Number</p>
                <p className="font-medium text-default-800">
                  {employee.bankDetails.accountNumber || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-default-500">IFSC Code</p>
                <p className="font-medium text-default-800">
                  {employee.bankDetails.ifscCode || 'N/A'}
                </p>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}

