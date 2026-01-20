'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'
import {
  FaUsers, FaSearch, FaUser, FaEnvelope, FaPhone, FaCalendarAlt,
  FaBriefcase, FaStar, FaChartLine, FaFilter
} from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'

export default function TeamMembersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [teamMembers, setTeamMembers] = useState([])
  const [department, setDepartment] = useState(null)
  const [departments, setDepartments] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchTeamMembers()
  }, [selectedDepartment])

  const fetchTeamMembers = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const url = selectedDepartment && selectedDepartment !== 'all' 
        ? `/api/team/members?department=${selectedDepartment}`
        : '/api/team/members'

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setTeamMembers(data.data)
        setDepartment(data.meta.department)
        // Set departments list for filter (only on first load)
        if (data.meta.departments && data.meta.departments.length > 0) {
          setDepartments(data.meta.departments)
        }
      } else {
        toast.error(data.message || 'Failed to fetch team members')
      }
    } catch (error) {
      console.error('Error fetching team members:', error)
      toast.error('Failed to fetch team members')
    } finally {
      setLoading(false)
    }
  }

  const filteredMembers = teamMembers.filter(member => {
    if (!searchTerm) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      member.firstName.toLowerCase().includes(searchLower) ||
      member.lastName.toLowerCase().includes(searchLower) ||
      member.employeeCode.toLowerCase().includes(searchLower) ||
      member.email.toLowerCase().includes(searchLower)
    )
  })

  return (
    <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center mb-2">
          <FaUsers className="text-blue-600 mr-3 text-2xl" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Team Members</h1>
            <p className="text-gray-600 text-sm sm:text-base">
              {selectedDepartment === 'all' 
                ? (departments.length > 1 ? 'All Departments' : department?.name + ' Department')
                : departments.find(d => d._id === selectedDepartment)?.name + ' Department'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Total Team Members</p>
            <p className="text-3xl font-bold text-gray-900">{teamMembers.length}</p>
          </div>
          <FaUsers className="text-blue-500 text-4xl" />
        </div>
      </div>

      {/* Search and Filter */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search Input */}
          <div className="relative flex-1">
            <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, employee code, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          {/* Department Filter - show only if multiple departments */}
          {departments.length > 1 && (
            <div className="relative sm:w-64">
              <FaFilter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
              >
                <option value="all">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept._id} value={dept._id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Team Members List */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Loader size="lg" className="mx-auto" />
          <p className="mt-4 text-gray-600">Loading team members...</p>
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <FaUsers className="text-gray-400 text-4xl mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No Team Members Found</h3>
          <p className="text-gray-600">
            {searchTerm ? 'Try adjusting your search' : 'No team members in your department yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredMembers.map((member) => (
            <div
              key={member._id}
              onClick={() => router.push(`/dashboard/team/members/${member._id}`)}
              className="bg-white rounded-lg shadow-md p-4 sm:p-6 cursor-pointer hover:shadow-lg transition-shadow"
            >
              {/* Profile Picture */}
              <div className="flex items-center mb-4">
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl mr-4">
                  {member.profilePicture ? (
                    <img
                      src={member.profilePicture}
                      alt={`${member.firstName} ${member.lastName}`}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900">
                    {member.firstName} {member.lastName}
                  </h3>
                  <p className="text-sm text-gray-600">{member.employeeCode}</p>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm text-gray-600">
                  <FaBriefcase className="mr-2 text-gray-400" />
                  <span>
                    {formatDesignation(member.designation, member) || 'No designation'}
                  </span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <FaEnvelope className="mr-2 text-gray-400" />
                  <span className="truncate">{member.email}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <FaPhone className="mr-2 text-gray-400" />
                  <span>{member.phone}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <FaCalendarAlt className="mr-2 text-gray-400" />
                  <span>Joined {new Date(member.dateOfJoining).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Skills */}
              {member.skills && member.skills.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Skills:</p>
                  <div className="flex flex-wrap gap-1">
                    {member.skills.slice(0, 3).map((skill, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                      >
                        {skill}
                      </span>
                    ))}
                    {member.skills.length > 3 && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                        +{member.skills.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* View Details Button */}
              <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center">
                <FaChartLine className="mr-2" />
                View Details & Reviews
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

