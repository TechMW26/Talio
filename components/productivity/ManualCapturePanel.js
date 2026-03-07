'use client'

import { useState, useEffect } from 'react'
import {
  HiOutlineCamera,
  HiOutlineUsers,
  HiOutlineUser,
  HiOutlineShieldCheck,
  HiOutlineExclamationTriangle,
  HiOutlineCheckCircle,
  HiOutlineMagnifyingGlass
} from 'react-icons/hi2'
import Loader from '@/components/ui/Loader'

/**
 * ManualCapturePanel Component
 * Allows Admin and Department Heads to trigger manual captures of target users
 */
export default function ManualCapturePanel() {
  const [user, setUser] = useState(null)
  const [permissions, setPermissions] = useState(null)
  const [targetUsers, setTargetUsers] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUsers, setSelectedUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [captureResults, setCaptureResults] = useState([])
  const [error, setError] = useState(null)

  // Get current user
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  // Fetch permissions and targetable users
  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        setLoading(true)
        const token = localStorage.getItem('token')
        if (!token) {
          setError('Not authenticated')
          return
        }

        const res = await fetch('/api/activity/manual-capture', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (!res.ok) {
          const errorData = await res.json()
          setError(errorData.error || 'Failed to fetch permissions')
          return
        }

        const data = await res.json()
        setPermissions(data.permissions)
        setTargetUsers(data.targetableUsers || [])
        setFilteredUsers(data.targetableUsers || [])
        
      } catch (error) {
        console.error('Error fetching permissions:', error)
        setError('Failed to load permissions')
      } finally {
        setLoading(false)
      }
    }

    fetchPermissions()
  }, [])

  // Filter users based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(targetUsers)
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = targetUsers.filter(u =>
      u.name?.toLowerCase().includes(query) ||
      u.email?.toLowerCase().includes(query) ||
      u.employeeCode?.toLowerCase().includes(query)
    )
    setFilteredUsers(filtered)
  }, [searchQuery, targetUsers])

  // Toggle user selection
  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId)
      }
      return [...prev, userId]
    })
  }

  // Select all visible users
  const selectAll = () => {
    const allVisibleIds = filteredUsers.map(u => u._id)
    setSelectedUsers(allVisibleIds)
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedUsers([])
  }

  // Trigger capture for selected users
  const triggerCapture = async () => {
    if (selectedUsers.length === 0) return

    setCapturing(true)
    setCaptureResults([])

    const token = localStorage.getItem('token')
    const results = []

    for (const userId of selectedUsers) {
      try {
        const res = await fetch('/api/activity/manual-capture', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ targetUserId: userId })
        })

        const data = await res.json()
        const targetUser = targetUsers.find(u => u._id === userId)
        
        results.push({
          userId,
          userName: targetUser?.name || targetUser?.email || userId,
          success: data.success,
          message: data.success ? 'Capture request sent' : data.error,
          requestId: data.request?.requestId
        })
        
      } catch (error) {
        const targetUser = targetUsers.find(u => u._id === userId)
        results.push({
          userId,
          userName: targetUser?.name || targetUser?.email || userId,
          success: false,
          message: error.message
        })
      }
    }

    setCaptureResults(results)
    setCapturing(false)
    setSelectedUsers([])
  }

  // If user doesn't have permission
  if (!loading && (!permissions?.canInitiateCapture)) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-6">
        <div className="flex flex-col items-center text-center">
          <HiOutlineShieldCheck className="w-12 h-12 text-gray-300 mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Access Restricted</h3>
          <p className="text-gray-500 text-sm">
            Only Admin and Department Heads can initiate manual captures.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b bg-orange-50 dark:bg-orange-950/30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl">
            <HiOutlineCamera className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Manual Capture</h3>
            <p className="text-xs text-gray-500">
              {permissions?.captureScope === 'all' 
                ? 'Capture any user\'s screen' 
                : 'Capture screens of your department members'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader size="md" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <HiOutlineExclamationTriangle className="w-12 h-12 text-red-300 mb-3" />
            <p className="text-red-600">{error}</p>
          </div>
        ) : (
          <>
            {/* Search and Actions */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="flex-1 relative">
                <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-orange-500 focus:border-orange-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={selectAll}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition"
                >
                  Select All
                </button>
                <button
                  onClick={clearSelection}
                  disabled={selectedUsers.length === 0}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* User List */}
            {targetUsers.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <HiOutlineUsers className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No users available for capture</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                {filteredUsers.map((targetUser) => (
                  <label
                    key={targetUser._id}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(targetUser._id)}
                      onChange={() => toggleUserSelection(targetUser._id)}
                      className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                    />
                    <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-amber-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {(targetUser.name || targetUser.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {targetUser.name || targetUser.email}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {targetUser.employeeCode && `${targetUser.employeeCode} • `}
                        {targetUser.role}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Capture Button */}
            <button
              onClick={triggerCapture}
              disabled={selectedUsers.length === 0 || capturing}
              className="w-full mt-4 px-4 py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg font-medium hover:from-orange-600 hover:to-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {capturing ? (
                <>
                  <Loader size="xs" color="#ffffff" />
                  Capturing...
                </>
              ) : (
                <>
                  <HiOutlineCamera className="w-5 h-5" />
                  Capture {selectedUsers.length} User{selectedUsers.length !== 1 ? 's' : ''}
                </>
              )}
            </button>

            {/* Results */}
            {captureResults.length > 0 && (
              <div className="mt-4 border rounded-lg divide-y">
                <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-gray-500">
                  Capture Results
                </div>
                {captureResults.map((result, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${
                      result.success ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    {result.success ? (
                      <HiOutlineCheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    ) : (
                      <HiOutlineExclamationTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{result.userName}</p>
                      <p className={`text-xs ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                        {result.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Info Notice */}
            <div className="mt-4 p-3 bg-amber-50 rounded-lg text-xs text-amber-700">
              <p className="font-medium mb-1">Important Notes:</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-600">
                <li>Manual captures require the target user's desktop app to be running</li>
                <li>Admin screens cannot be captured under any circumstances</li>
                <li>All capture requests are logged for audit purposes</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
