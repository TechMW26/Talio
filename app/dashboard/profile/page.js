'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Loader from '@/components/ui/Loader'
import {
  FaUser,
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
  FaCalendarAlt,
  FaEdit,
  FaSave,
  FaTimes,
  FaCheck,
  FaCamera,
  FaSearchPlus,
  FaSearchMinus,
  FaUndo,
  FaRedo,
  FaSun,
  FaAdjust,
  FaExclamationTriangle,
} from 'react-icons/fa'
import toast from '@/utils/toast'
import ModalPortal from '@/components/ModalPortal'
import { formatDesignation, formatDepartments, getLevelNameFromNumber } from '@/lib/formatters'
import TiltWrapper from "@/components/TiltWrapper";
import dynamic from 'next/dynamic'
import AadhaarVerificationSection from '@/components/AadhaarVerificationSection'
import ActiveSessionsSection from '@/components/ActiveSessionsSection'

// Dynamically import Lanyard with no SSR and error boundary
const Lanyard = dynamic(() => import('@/src/component/Lanyard').catch((error) => {
  console.error('Failed to load Lanyard component:', error);
  // Return transparent fallback to not interfere with UI
  return {
    default: () => (
      <div className="w-full h-full bg-transparent" />
    )
  };
}), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-transparent" />
  )
});


export default function ProfilePage() {
  const [mounted, setMounted] = useState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    setMounted(true)
  }, [])
  const [user, setUser] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedEmployee, setEditedEmployee] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef(null)

  // Profile completion state
  const [profileCompletionStatus, setProfileCompletionStatus] = useState(null)
  const [isCompleteProfileMode, setIsCompleteProfileMode] = useState(false)

  // Use imported getLevelNameFromNumber for level name lookup
  const getLevelName = getLevelNameFromNumber

  // Image editor state
  const [showImageEditor, setShowImageEditor] = useState(false)
  const [selectedImage, setSelectedImage] = useState(null)
  const [imageScale, setImageScale] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)
  const [imageBrightness, setImageBrightness] = useState(100)
  const [imageContrast, setImageContrast] = useState(100)
  const [imageSaturation, setImageSaturation] = useState(100)
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const canvasRef = useRef(null)
  const imageRef = useRef(null)

  // Check for edit mode from URL params (from profile completion modal)
  useEffect(() => {
    const editMode = searchParams.get('edit')
    const completeProfile = searchParams.get('completeProfile')

    if (editMode === 'true') {
      setIsEditing(true)
    }
    if (completeProfile === 'true') {
      setIsCompleteProfileMode(true)
    }
  }, [searchParams])

  useEffect(() => {
    fetchProfile()
    fetchProfileCompletionStatus()
  }, [])

  const fetchProfileCompletionStatus = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/profile/completion-status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const result = await response.json()
      if (result.success) {
        setProfileCompletionStatus(result.data)
      }
    } catch (error) {
      console.error('Error fetching profile completion status:', error)
    }
  }

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/profile', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const result = await response.json()
      if (result.success) {
        console.log('Profile data - company:', result.data.employee?.company)
        setUser(result.data.user)
        setEmployee(result.data.employee)
        setEditedEmployee(result.data.employee)
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
      // Fallback to localStorage
      const userData = localStorage.getItem('user')
      if (userData) {
        const parsedUser = JSON.parse(userData)
        console.log('Loading from localStorage:', parsedUser)
        setUser(parsedUser)

        // Extract employee data - handle both structures
        let employeeData = null
        if (parsedUser.employeeId && typeof parsedUser.employeeId === 'object') {
          // Employee data is in employeeId object
          employeeData = {
            ...parsedUser.employeeId,
            // Fallback to top-level fields if not in employeeId
            dateOfBirth: parsedUser.employeeId.dateOfBirth || parsedUser.dateOfBirth,
            gender: parsedUser.employeeId.gender || parsedUser.gender,
            address: parsedUser.employeeId.address || parsedUser.address,
            emergencyContact: parsedUser.employeeId.emergencyContact || parsedUser.emergencyContact,
            designation: parsedUser.employeeId.designation || parsedUser.designation,
            department: parsedUser.employeeId.department || parsedUser.department,
            departments: parsedUser.employeeId.departments || parsedUser.departments,
          }
        } else {
          // Build employee object from top-level fields
          employeeData = {
            _id: parsedUser.employeeId,
            employeeCode: parsedUser.employeeCode,
            firstName: parsedUser.firstName,
            lastName: parsedUser.lastName,
            email: parsedUser.email,
            phone: parsedUser.phone,
            dateOfBirth: parsedUser.dateOfBirth,
            gender: parsedUser.gender,
            address: parsedUser.address,
            designation: parsedUser.designation,
            designationLevel: parsedUser.designationLevel,
            designationLevelName: parsedUser.designationLevelName,
            department: parsedUser.department,
            departments: parsedUser.departments,
            profilePicture: parsedUser.profilePicture,
            status: parsedUser.status,
            dateOfJoining: parsedUser.dateOfJoining,
            emergencyContact: parsedUser.emergencyContact,
          }
        }

        console.log('Extracted employee data:', employeeData)
        setEmployee(employeeData)
        setEditedEmployee(employeeData)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleEditClick = () => {
    setEditedEmployee({ ...employee })
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setEditedEmployee({ ...employee })
    setIsEditing(false)
  }

  const handleFieldChange = (field, value) => {
    setEditedEmployee((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleNestedFieldChange = (parent, field, value) => {
    setEditedEmployee((prev) => ({
      ...prev,
      [parent]: {
        ...prev[parent],
        [field]: value,
      },
    }))
  }

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB')
      return
    }

    // Read the file and open editor
    const reader = new FileReader()
    reader.onloadend = () => {
      setSelectedImage(reader.result)
      setShowImageEditor(true)
      // Reset editor state
      setImageScale(1)
      setImageRotation(0)
      setImageBrightness(100)
      setImageContrast(100)
      setImageSaturation(100)
      setImagePosition({ x: 0, y: 0 })
    }
    reader.readAsDataURL(file)
  }

  const handleMouseDown = (e) => {
    setIsDragging(true)
    setDragStart({
      x: e.clientX - imagePosition.x,
      y: e.clientY - imagePosition.y,
    })
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    setImagePosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleTouchStart = (e) => {
    const touch = e.touches[0]
    setIsDragging(true)
    setDragStart({
      x: touch.clientX - imagePosition.x,
      y: touch.clientY - imagePosition.y,
    })
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return
    const touch = e.touches[0]
    setImagePosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    })
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  const resetImageEditor = () => {
    setImageScale(1)
    setImageRotation(0)
    setImageBrightness(100)
    setImageContrast(100)
    setImageSaturation(100)
    setImagePosition({ x: 0, y: 0 })
  }

  const closeImageEditor = () => {
    setShowImageEditor(false)
    setSelectedImage(null)
    resetImageEditor()
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const getCroppedImage = () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const size = 400 // Output size

    canvas.width = size
    canvas.height = size

    const img = imageRef.current
    if (!img) return null

    // Create a circular clipping path
    ctx.save()
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()

    // Apply filters
    ctx.filter = `brightness(${imageBrightness}%) contrast(${imageContrast}%) saturate(${imageSaturation}%)`

    // Calculate the image dimensions to match object-cover behavior
    const imgAspect = img.naturalWidth / img.naturalHeight
    const containerAspect = 1 // Square container (300x300 in preview, 400x400 in output)

    let drawWidth, drawHeight, offsetX, offsetY

    if (imgAspect > containerAspect) {
      // Image is wider - fit to height
      drawHeight = size
      drawWidth = size * imgAspect
      offsetX = -(drawWidth - size) / 2
      offsetY = 0
    } else {
      // Image is taller - fit to width
      drawWidth = size
      drawHeight = size / imgAspect
      offsetX = 0
      offsetY = -(drawHeight - size) / 2
    }

    // Apply transformations
    ctx.translate(size / 2, size / 2)
    ctx.rotate((imageRotation * Math.PI) / 180)
    ctx.scale(imageScale, imageScale)
    ctx.translate(imagePosition.x, imagePosition.y)

    // Draw the image
    ctx.drawImage(img, offsetX - size / 2, offsetY - size / 2, drawWidth, drawHeight)

    ctx.restore()

    return canvas.toDataURL('image/jpeg', 0.95)
  }

  const handleSaveImage = async () => {
    try {
      setUploadingImage(true)

      const croppedImage = getCroppedImage()
      if (!croppedImage) {
        toast.error('Failed to process image')
        return
      }

      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employee._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ profilePicture: croppedImage }),
      })

      const result = await response.json()
      if (result.success) {
        // Use the URL returned from the API (could be ImageKit URL or base64 fallback)
        const profilePictureUrl = result.data?.profilePicture || croppedImage

        setEmployee((prev) => ({ ...prev, profilePicture: profilePictureUrl }))
        setEditedEmployee((prev) => ({ ...prev, profilePicture: profilePictureUrl }))
        toast.success('Profile picture updated successfully!')

        // Update localStorage user data if it has employeeId
        const userData = localStorage.getItem('user')
        if (userData) {
          const parsedUser = JSON.parse(userData)
          if (parsedUser.employeeId) {
            parsedUser.employeeId.profilePicture = profilePictureUrl
            localStorage.setItem('user', JSON.stringify(parsedUser))
          }
        }

        closeImageEditor()
      } else {
        toast.error(result.message || 'Failed to update profile picture')
      }
    } catch (error) {
      console.error('Error uploading image:', error)
      toast.error('Failed to upload image')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleSaveProfile = async () => {
    try {
      setSaving(true)
      const token = localStorage.getItem('token')

      // Prepare update data
      const updateData = {
        phone: editedEmployee.phone,
        address: editedEmployee.address,
        emergencyContact: editedEmployee.emergencyContact,
        bloodGroup: editedEmployee.bloodGroup,
        dateOfBirth: editedEmployee.dateOfBirth,
        gender: editedEmployee.gender,
      }

      const response = await fetch(`/api/employees/${employee._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updateData),
      })

      const result = await response.json()
      if (result.success) {
        // Update local state
        const updatedEmployee = { ...employee, ...updateData }
        setEmployee(updatedEmployee)
        setEditedEmployee(updatedEmployee)

        // Update localStorage
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}')
        if (storedUser.employeeId && typeof storedUser.employeeId === 'object') {
          storedUser.employeeId = { ...storedUser.employeeId, ...updateData }
        }
        // Update top-level fields
        Object.assign(storedUser, updateData)
        localStorage.setItem('user', JSON.stringify(storedUser))

        setIsEditing(false)
        toast.success('Profile updated successfully!')
      } else {
        toast.error(result.message || 'Failed to update profile')
      }
    } catch (error) {
      console.error('Error updating profile:', error)
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !user || !employee) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader size="lg" />
          <p className="text-sm text-slate-500 font-medium tracking-wide">
            Loading your profile…
          </p>
        </div>
      </div>
    )
  }

  // Status and Edit buttons component for reuse
  const StatusEditButtons = () => (
    <div className="flex items-center justify-center lg:justify-end gap-3 flex-wrap">
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${employee.status === 'active'
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
          }`}
      >
        <span className="h-2 w-2 rounded-full mr-1.5 bg-current" />
        {employee.status === 'active'
          ? 'Active Employee'
          : employee.status?.toUpperCase() || 'ACTIVE'}
      </span>

      {!isEditing ? (
        <button
          onClick={handleEditClick}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <FaEdit className="text-xs" />
          <span>Edit Profile</span>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={handleCancelEdit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            <FaTimes className="text-xs" />
            <span>Cancel</span>
          </button>
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-black disabled:opacity-60"
          >
            <FaSave className="text-xs" />
            <span>{saving ? 'Saving…' : 'Save Changes'}</span>
          </button>
        </div>
      )}
    </div>
  );

  // Handler for Aadhaar verification status changes
  const handleAadhaarStatusChange = async (status) => {
    // Refresh completion status first
    await fetchProfileCompletionStatus()

    // If verification completed with extracted data, enable edit mode so user can see suggestions
    if (status?.extractedData) {
      const extractedData = status.extractedData

      // Check if there's useful data to suggest (DOB or address that differs from current)
      const hasDobSuggestion = extractedData.dateOfBirth && (!employee?.dateOfBirth || (() => {
        const aadhaarDateMatch = extractedData.dateOfBirth.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (!aadhaarDateMatch) return false
        const aadhaarDateFormatted = `${aadhaarDateMatch[3]}-${aadhaarDateMatch[2].padStart(2, '0')}-${aadhaarDateMatch[1].padStart(2, '0')}`
        const currentDob = employee?.dateOfBirth ? new Date(employee.dateOfBirth).toISOString().split('T')[0] : ''
        return aadhaarDateFormatted !== currentDob
      })())

      const hasAddressSuggestion = extractedData.address && extractedData.address !== employee?.address

      // If there are suggestions available, enable edit mode
      if (hasDobSuggestion || hasAddressSuggestion) {
        setIsEditing(true)
        setEditedEmployee({ ...employee })
        toast.success('Aadhaar verified! You can now use the extracted data to update your profile.', {
          duration: 4000,
          icon: '📋'
        })
      }
    }
  }

  // Handler for using Aadhaar data in profile
  const handleUseAadhaarData = async (field, value) => {
    if (!value) return

    // Map field names to employee fields
    const fieldMapping = {
      'name': null, // Name changes require HR approval
      'dateofbirth': 'dateOfBirth',
      'address': 'address',
    }

    const employeeField = fieldMapping[field]

    if (field === 'name') {
      toast.error('Name changes require HR approval. Please contact HR to update your name.')
      return
    }

    if (!employeeField) {
      toast.error('Cannot update this field automatically.')
      return
    }

    try {
      // Parse date if it's DOB field
      let processedValue = value
      if (field === 'dateofbirth') {
        // Convert DD/MM/YYYY to YYYY-MM-DD for the API
        const dateMatch = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (dateMatch) {
          processedValue = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`
        }
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ [employeeField]: processedValue }),
      })

      const result = await response.json()
      if (result.success) {
        toast.success(`${field === 'dateofbirth' ? 'Date of Birth' : 'Address'} updated from Aadhaar!`)
        // Refresh profile data
        fetchProfile()
        fetchProfileCompletionStatus()
      } else {
        toast.error(result.message || 'Failed to update profile')
      }
    } catch (error) {
      console.error('Error updating profile with Aadhaar data:', error)
      toast.error('Failed to update profile')
    }
  }

  // Render the Complete Profile Status Section
  const renderCompleteProfileSection = () => {
    if (!profileCompletionStatus) return null

    const { steps, completionPercentage, daysRemaining, isComplete, warning } = profileCompletionStatus

    // Check if there's a mismatch issue
    const hasMismatch = steps?.ocrVerification?.status === 'mismatch'

    // Show if: not complete OR has mismatch OR in complete profile mode
    // Mismatch always shows because it requires user action
    if (isComplete && !hasMismatch && !isCompleteProfileMode) return null

    return (
      <section className={`rounded-3xl border shadow-sm p-4 sm:p-6 ${hasMismatch
        ? 'bg-red-50 border-red-200 shadow-red-900/5'
        : 'bg-white border-slate-100 shadow-slate-900/5'
        }`}>
        {/* Section Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isComplete ? 'bg-emerald-100' : hasMismatch ? 'bg-red-100' : 'bg-amber-100'
              }`}>
              {isComplete ? (
                <FaCheck className="w-5 h-5 text-emerald-600" />
              ) : hasMismatch ? (
                <FaExclamationTriangle className="w-5 h-5 text-red-600" />
              ) : (
                <FaExclamationTriangle className="w-5 h-5 text-amber-600" />
              )}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                {hasMismatch ? 'Profile Verification Issue' : 'Complete Your Profile'}
              </h3>
              <p className={`text-xs mt-0.5 ${hasMismatch ? 'text-red-600' : 'text-slate-500'}`}>
                {hasMismatch
                  ? 'Aadhaar data doesn\'t match your profile - please update'
                  : isComplete
                    ? 'All required information has been completed'
                    : daysRemaining !== null
                      ? `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining to complete`
                      : 'Complete all required fields'
                }
              </p>
            </div>
          </div>
          <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${isComplete ? 'bg-emerald-100 text-emerald-700' :
            hasMismatch ? 'bg-red-100 text-red-700' :
              completionPercentage >= 70 ? 'bg-emerald-100 text-emerald-700' :
                completionPercentage >= 40 ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-700'
            }`}>
            {completionPercentage}%
          </span>
        </div>

        {/* Progress Bar - Always show */}
        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-slate-500">Progress</span>
            <span className="text-xs font-medium text-slate-700">{completionPercentage}/100</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${completionPercentage === 100
                ? 'bg-emerald-500'
                : hasMismatch
                  ? 'bg-red-500'
                  : completionPercentage >= 70
                    ? 'bg-blue-500'
                    : completionPercentage >= 40
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                }`}
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-400">
            <span>Personal Info (40%)</span>
            <span>Aadhaar (30%)</span>
            <span>Verification (30%)</span>
          </div>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Personal Info */}
          <div className={`p-4 rounded-2xl border ${steps?.personalInfo?.complete
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-slate-50 border-slate-200'
            }`}>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${steps?.personalInfo?.complete ? 'bg-emerald-500' : 'bg-slate-300'
                }`}>
                {steps?.personalInfo?.complete ? (
                  <FaCheck className="w-4 h-4 text-white" />
                ) : (
                  <FaUser className="w-4 h-4 text-white" />
                )}
              </div>
              <div>
                <p className={`text-sm font-semibold ${steps?.personalInfo?.complete ? 'text-emerald-700' : 'text-slate-700'
                  }`}>
                  Personal Info
                </p>
                <p className="text-xs text-slate-500">
                  {steps?.personalInfo?.completedCount || 0}/{steps?.personalInfo?.totalFields || 7} fields
                </p>
              </div>
            </div>
            {!steps?.personalInfo?.complete && steps?.personalInfo?.missingFields?.length > 0 && (
              <p className="text-xs text-amber-600 mt-2 line-clamp-2">
                Missing: {steps.personalInfo.missingFields.slice(0, 3).join(', ')}
                {steps.personalInfo.missingFields.length > 3 && ` +${steps.personalInfo.missingFields.length - 3} more`}
              </p>
            )}
          </div>

          {/* Aadhaar Upload */}
          <div className={`p-4 rounded-2xl border ${steps?.aadhaarUpload?.complete
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-slate-50 border-slate-200'
            }`}>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${steps?.aadhaarUpload?.complete ? 'bg-emerald-500' : 'bg-slate-300'
                }`}>
                {steps?.aadhaarUpload?.complete ? (
                  <FaCheck className="w-4 h-4 text-white" />
                ) : (
                  <FaUser className="w-4 h-4 text-white" />
                )}
              </div>
              <div>
                <p className={`text-sm font-semibold ${steps?.aadhaarUpload?.complete ? 'text-emerald-700' : 'text-slate-700'
                  }`}>
                  Aadhaar Upload
                </p>
                <p className="text-xs text-slate-500">
                  {steps?.aadhaarUpload?.frontUploaded && steps?.aadhaarUpload?.backUploaded
                    ? '2/2 uploaded'
                    : steps?.aadhaarUpload?.frontUploaded || steps?.aadhaarUpload?.backUploaded
                      ? '1/2 uploaded'
                      : '0/2 uploaded'
                  }
                </p>
              </div>
            </div>
            {!steps?.aadhaarUpload?.complete && (
              <p className="text-xs text-amber-600 mt-2">
                {!steps?.aadhaarUpload?.frontUploaded && !steps?.aadhaarUpload?.backUploaded
                  ? 'Upload front & back'
                  : !steps?.aadhaarUpload?.frontUploaded
                    ? 'Upload front side'
                    : 'Upload back side'
                }
              </p>
            )}
          </div>

          {/* OCR Verification */}
          <div className={`p-4 rounded-2xl border ${steps?.ocrVerification?.complete
            ? 'bg-emerald-50 border-emerald-200'
            : steps?.ocrVerification?.status === 'mismatch'
              ? 'bg-red-50 border-red-200'
              : 'bg-slate-50 border-slate-200'
            }`}>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${steps?.ocrVerification?.complete
                ? 'bg-emerald-500'
                : steps?.ocrVerification?.status === 'mismatch'
                  ? 'bg-red-500'
                  : 'bg-slate-300'
                }`}>
                {steps?.ocrVerification?.complete ? (
                  <FaCheck className="w-4 h-4 text-white" />
                ) : (
                  <FaUser className="w-4 h-4 text-white" />
                )}
              </div>
              <div>
                <p className={`text-sm font-semibold ${steps?.ocrVerification?.complete
                  ? 'text-emerald-700'
                  : steps?.ocrVerification?.status === 'mismatch'
                    ? 'text-red-700'
                    : 'text-slate-700'
                  }`}>
                  Verification
                </p>
                <p className={`text-xs ${steps?.ocrVerification?.status === 'mismatch' ? 'text-red-500' : 'text-slate-500'
                  }`}>
                  {steps?.ocrVerification?.complete
                    ? 'Verified'
                    : steps?.ocrVerification?.status === 'mismatch'
                      ? 'Needs review'
                      : 'Pending'
                  }
                </p>
              </div>
            </div>
            {steps?.ocrVerification?.status === 'mismatch' && (
              <div className="mt-2">
                <p className="text-xs text-red-600 font-medium">
                  ⚠️ {steps.ocrVerification.mismatches?.length || 0} field(s) don't match
                </p>
                {steps.ocrVerification.mismatches?.slice(0, 2).map((m, i) => (
                  <p key={i} className="text-xs text-red-500 mt-1">
                    {m.field}: Profile "{m.profileValue}" ≠ Aadhaar "{m.aadhaarValue}"
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mismatch Action Banner */}
        {hasMismatch && (
          <div className="mt-4 p-3 bg-red-100 rounded-xl border border-red-200">
            <p className="text-sm text-red-700 font-medium">
              🔴 Action Required: Update your profile to match your Aadhaar details, or contact HR if there's an error.
            </p>
          </div>
        )}
      </section>
    )
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="page-container pb-24 md:pb-6 px-2 sm:px-4 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container pb-24 md:pb-6 px-2 sm:px-4 lg:px-8">
      <div className="max-w-[1400px] mx-auto w-full">
        {/* Status and Edit buttons - Desktop only (hidden on mobile) */}
        <div className="mb-4 hidden lg:flex items-center justify-end gap-3">
          <StatusEditButtons />
        </div>

        {/* Content - Two Column Layout */}
        <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 lg:gap-8 overflow-visible">
          {/* Left Column: ID Card */}
          <div className="lg:col-span-1 relative lg:sticky lg:top-4 lg:self-start order-1" style={{ overflow: 'visible' }}>
            {/* Hidden file input for profile picture */}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />

            {/* Lanyard Model - hanging from top */}
            {typeof window !== 'undefined' && (
              <div className="relative w-full overflow-visible z-10 h-[560px] sm:h-[620px] md:h-[680px] lg:h-[750px] mt-[-60px] lg:mt-[-140px]">
                <Lanyard
                  key={`lanyard-${employee?.company?._id || employee?.company || 'default'}`}
                  employee={{
                    name: employee ? `${employee.firstName} ${employee.lastName}` : undefined,
                    designation: employee?.designation?.title || employee?.designation,
                    employeeId: employee?.employeeCode,
                    photo: employee?.profilePicture,
                    phone: employee?.phone,
                    bloodGroup: employee?.bloodGroup,
                    email: employee?.email,
                    address: employee?.address,
                    dob: employee?.dateOfBirth,
                    joiningDate: employee?.dateOfJoining,
                    company: employee?.company ? {
                      _id: employee.company._id,
                      name: employee.company.name,
                      logo: employee.company.logo
                    } : null
                  }}
                  onImageClick={() => fileInputRef.current?.click()}
                  uploadingImage={uploadingImage}
                />
              </div>
            )}
          </div>

          {/* Right Column: All Sections */}
          <div className="lg:col-span-2 space-y-5 sm:space-y-6 order-2 mt-6 lg:mt-0">
            {/* Complete Your Profile Section - Always at top */}
            {renderCompleteProfileSection()}

            {/* Aadhaar Verification Section - shown when in complete profile mode or when profile is incomplete */}
            {(isCompleteProfileMode || (profileCompletionStatus && !profileCompletionStatus.isComplete)) && (
              <AadhaarVerificationSection
                initialStatus={profileCompletionStatus?.steps ? {
                  aadhaarFront: profileCompletionStatus.steps.aadhaarUpload?.frontUploaded ? { url: true } : null,
                  aadhaarBack: profileCompletionStatus.steps.aadhaarUpload?.backUploaded ? { url: true } : null,
                  ocrVerification: {
                    status: profileCompletionStatus.steps.ocrVerification?.status || 'pending',
                    extractedData: null,
                    mismatches: profileCompletionStatus.steps.ocrVerification?.mismatches || []
                  }
                } : null}
                onStatusChange={handleAadhaarStatusChange}
                onUseAadhaarData={handleUseAadhaarData}
                showUrgentWarning={profileCompletionStatus?.warning?.urgent}
              />
            )}

            {/* Personal Information */}
            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm shadow-slate-900/5 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-5">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                    Personal Information
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                    Basic details that help us identify and contact you.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                {/* Email (read-only) */}
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200/70 shadow-xs">
                  <div className="w-11 h-11 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-500/40">
                    <FaEnvelope className="text-white text-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-blue-700 tracking-wide uppercase mb-1.5">
                      Email Address
                    </p>
                    <p className="font-semibold text-slate-900 text-sm sm:text-base truncate">
                      {employee.email}
                    </p>
                    <p className="text-[11px] text-blue-700/70 mt-1">
                      This field is managed by your organization.
                    </p>
                  </div>
                </div>

                {/* Phone */}
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200/70 shadow-xs">
                  <div className="w-11 h-11 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/40">
                    <FaPhone className="text-white text-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-emerald-700 tracking-wide uppercase mb-1.5">
                      Phone Number
                    </p>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedEmployee.phone || ''}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9+\-() ]/g, '')
                          handleFieldChange('phone', value)
                        }}
                        pattern="[0-9+\-() ]*"
                        className="w-full px-3 py-2 border border-emerald-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                        placeholder="Enter phone number"
                      />
                    ) : (
                      <p className="font-semibold text-slate-900 text-sm sm:text-base">
                        {employee.phone || 'N/A'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Date of birth */}
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200/70 shadow-xs">
                  <div className="w-11 h-11 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-purple-500/40">
                    <FaCalendarAlt className="text-white text-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-purple-700 tracking-wide uppercase mb-1.5">
                      Date of Birth
                    </p>
                    {isEditing ? (
                      <>
                        <input
                          type="date"
                          value={
                            editedEmployee.dateOfBirth
                              ? new Date(editedEmployee.dateOfBirth)
                                .toISOString()
                                .split('T')[0]
                              : ''
                          }
                          onChange={(e) => handleFieldChange('dateOfBirth', e.target.value)}
                          className="w-full px-3 py-2 border border-purple-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        />
                        {/* Show extracted DOB from Aadhaar if available and different */}
                        {profileCompletionStatus?.steps?.ocrVerification?.extractedData?.dateOfBirth && (() => {
                          const aadhaarDob = profileCompletionStatus.steps.ocrVerification.extractedData.dateOfBirth
                          // Parse Aadhaar DOB (DD/MM/YYYY) to compare
                          const aadhaarDateMatch = aadhaarDob.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
                          const aadhaarDateFormatted = aadhaarDateMatch
                            ? `${aadhaarDateMatch[3]}-${aadhaarDateMatch[2].padStart(2, '0')}-${aadhaarDateMatch[1].padStart(2, '0')}`
                            : null
                          const currentDob = editedEmployee.dateOfBirth
                            ? new Date(editedEmployee.dateOfBirth).toISOString().split('T')[0]
                            : ''

                          if (aadhaarDateFormatted && aadhaarDateFormatted !== currentDob) {
                            return (
                              <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                                <p className="text-[10px] font-medium text-emerald-700 uppercase mb-1 flex items-center gap-1">
                                  <FaCheck className="text-emerald-500" />
                                  Date of Birth from Aadhaar
                                </p>
                                <p className="text-xs text-emerald-800 mb-2">
                                  {aadhaarDob}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleFieldChange('dateOfBirth', aadhaarDateFormatted)}
                                  className="text-xs px-2 py-1 bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors"
                                >
                                  Use this date
                                </button>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-slate-900 text-sm sm:text-base">
                          {employee.dateOfBirth
                            ? new Date(employee.dateOfBirth).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })
                            : 'N/A'}
                        </p>
                        {/* Show verified badge when DOB matches Aadhaar */}
                        {profileCompletionStatus?.steps?.ocrVerification?.extractedData?.dateOfBirth && employee.dateOfBirth && (() => {
                          const aadhaarDob = profileCompletionStatus.steps.ocrVerification.extractedData.dateOfBirth
                          const aadhaarDateMatch = aadhaarDob.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
                          const aadhaarDateFormatted = aadhaarDateMatch
                            ? `${aadhaarDateMatch[3]}-${aadhaarDateMatch[2].padStart(2, '0')}-${aadhaarDateMatch[1].padStart(2, '0')}`
                            : null
                          const currentDob = new Date(employee.dateOfBirth).toISOString().split('T')[0]

                          if (aadhaarDateFormatted === currentDob) {
                            return (
                              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-medium rounded-full">
                                <FaCheck className="text-[8px]" />
                                Verified from Aadhaar
                              </span>
                            )
                          }
                          return null
                        })()}
                        {/* Show suggestion if no DOB but Aadhaar has one */}
                        {!employee.dateOfBirth && profileCompletionStatus?.steps?.ocrVerification?.extractedData?.dateOfBirth && (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-[10px] font-medium text-blue-700 uppercase mb-1">
                              📅 DOB found in Aadhaar
                            </p>
                            <p className="text-xs text-blue-800">
                              {profileCompletionStatus.steps.ocrVerification.extractedData.dateOfBirth}
                            </p>
                            <p className="text-[10px] text-blue-600 mt-1">
                              Click Edit to use this date
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Gender */}
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-pink-50 to-pink-100 border border-pink-200/70 shadow-xs">
                  <div className="w-11 h-11 rounded-full bg-pink-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-pink-500/40">
                    <FaUser className="text-white text-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-pink-700 tracking-wide uppercase mb-1.5">
                      Gender
                    </p>
                    {isEditing ? (
                      <select
                        value={editedEmployee.gender || ''}
                        onChange={(e) => handleFieldChange('gender', e.target.value)}
                        className="w-full px-3 py-2 border border-pink-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                      >
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    ) : (
                      <p className="font-semibold text-slate-900 text-sm sm:text-base capitalize">
                        {employee.gender || 'N/A'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Address */}
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 border border-rose-200/70 shadow-xs sm:col-span-2">
                  <div className="w-11 h-11 rounded-full bg-rose-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-rose-500/40">
                    <FaMapMarkerAlt className="text-white text-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-rose-700 tracking-wide uppercase mb-1.5">
                      Address
                    </p>
                    {isEditing ? (
                      <>
                        <textarea
                          value={editedEmployee.address || ''}
                          onChange={(e) => handleFieldChange('address', e.target.value)}
                          className="w-full px-3 py-2 border border-rose-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all resize-none"
                          placeholder="Enter complete address"
                          rows="2"
                        />
                        {/* Show extracted address from Aadhaar if available and different */}
                        {profileCompletionStatus?.steps?.ocrVerification?.extractedData?.address &&
                          profileCompletionStatus.steps.ocrVerification.extractedData.address !== editedEmployee.address && (
                            <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                              <p className="text-[10px] font-medium text-emerald-700 uppercase mb-1 flex items-center gap-1">
                                <FaCheck className="text-emerald-500" />
                                Address from Aadhaar
                              </p>
                              <p className="text-xs text-emerald-800 mb-2">
                                {profileCompletionStatus.steps.ocrVerification.extractedData.address}
                              </p>
                              <button
                                type="button"
                                onClick={() => handleFieldChange('address', profileCompletionStatus.steps.ocrVerification.extractedData.address)}
                                className="text-xs px-2 py-1 bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors"
                              >
                                Use this address
                              </button>
                            </div>
                          )}
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-slate-900 text-sm sm:text-base whitespace-pre-line">
                          {employee.address || 'N/A'}
                        </p>
                        {/* Show extracted address badge when address matches Aadhaar */}
                        {profileCompletionStatus?.steps?.ocrVerification?.extractedData?.address &&
                          employee.address === profileCompletionStatus.steps.ocrVerification.extractedData.address && (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-medium rounded-full">
                              <FaCheck className="text-[8px]" />
                              Verified from Aadhaar
                            </span>
                          )}
                        {/* Show suggestion if no address but Aadhaar has one */}
                        {!employee.address && profileCompletionStatus?.steps?.ocrVerification?.extractedData?.address && (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-[10px] font-medium text-blue-700 uppercase mb-1">
                              📍 Address found in Aadhaar
                            </p>
                            <p className="text-xs text-blue-800">
                              {profileCompletionStatus.steps.ocrVerification.extractedData.address}
                            </p>
                            <p className="text-[10px] text-blue-600 mt-1">
                              Click Edit to use this address
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Blood Group */}
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200/70 shadow-xs">
                  <div className="w-11 h-11 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-amber-500/40">
                    <FaUser className="text-white text-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-amber-700 tracking-wide uppercase mb-1.5">
                      Blood Group
                    </p>
                    {isEditing ? (
                      <select
                        value={editedEmployee.bloodGroup || ''}
                        onChange={(e) => handleFieldChange('bloodGroup', e.target.value)}
                        className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                      >
                        <option value="">Select blood group</option>
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    ) : (
                      <p className="font-semibold text-slate-900 text-sm sm:text-base">
                        {employee.bloodGroup || 'N/A'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Employment Information */}
            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm shadow-slate-900/5 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-5">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                    Employment Information
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                    Details about your current role and reporting structure.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-indigo-700 tracking-wide uppercase mb-1.5">
                    Date of Joining
                  </p>
                  <p className="font-semibold text-slate-900 text-sm sm:text-base">
                    {employee.dateOfJoining
                      ? new Date(employee.dateOfJoining).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })
                      : 'N/A'}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-teal-50 to-teal-100 border border-teal-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-teal-700 tracking-wide uppercase mb-1.5">
                    Employment Type
                  </p>
                  <p className="font-semibold text-slate-900 text-sm sm:text-base capitalize">
                    {employee.employmentType || 'N/A'}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-cyan-700 tracking-wide uppercase mb-1.5">
                    Department(s)
                  </p>
                  <p className="font-semibold text-slate-900 text-sm sm:text-base">
                    {formatDepartments(employee)}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-violet-700 tracking-wide uppercase mb-1.5">
                    Designation
                  </p>
                  <p className="font-semibold text-slate-900 text-sm sm:text-base">
                    {formatDesignation(employee.designation, employee)}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-amber-700 tracking-wide uppercase mb-1.5">
                    Reporting Manager
                  </p>
                  <p className="font-semibold text-slate-900 text-sm sm:text-base">
                    {employee.reportingManager
                      ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName}`
                      : 'N/A'}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-emerald-700 tracking-wide uppercase mb-1.5">
                    Work Location
                  </p>
                  <p className="font-semibold text-slate-900 text-sm sm:text-base">
                    {employee.workLocation || 'N/A'}
                  </p>
                </div>
              </div>
            </section>

            {/* Emergency Contact */}
            <section className="bg-white rounded-3xl border border-slate-100 shadow-sm shadow-slate-900/5 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-5">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                    Emergency Contact
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                    Person we should reach out to in case of any emergency.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                {/* Name */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 border border-rose-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-rose-700 tracking-wide uppercase mb-1.5">
                    Contact Name
                  </p>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedEmployee.emergencyContact?.name || ''}
                      onChange={(e) =>
                        handleNestedFieldChange('emergencyContact', 'name', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-rose-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all"
                      placeholder="Enter contact name"
                    />
                  ) : (
                    <p className="font-semibold text-slate-900 text-sm sm:text-base">
                      {employee.emergencyContact?.name || 'N/A'}
                    </p>
                  )}
                </div>

                {/* Relationship */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 border border-fuchsia-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-fuchsia-700 tracking-wide uppercase mb-1.5">
                    Relationship
                  </p>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedEmployee.emergencyContact?.relationship || ''}
                      onChange={(e) =>
                        handleNestedFieldChange('emergencyContact', 'relationship', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-fuchsia-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent transition-all"
                      placeholder="e.g., Spouse, Parent, Sibling"
                    />
                  ) : (
                    <p className="font-semibold text-slate-900 text-sm sm:text-base">
                      {employee.emergencyContact?.relationship || 'N/A'}
                    </p>
                  )}
                </div>

                {/* Phone */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-lime-50 to-lime-100 border border-lime-200/70 shadow-xs">
                  <p className="text-[11px] font-medium text-lime-700 tracking-wide uppercase mb-1.5">
                    Phone Number
                  </p>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editedEmployee.emergencyContact?.phone || ''}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9+\-() ]/g, '')
                        handleNestedFieldChange('emergencyContact', 'phone', value)
                      }}
                      pattern="[0-9+\-() ]*"
                      className="w-full px-3 py-2 border border-lime-300 rounded-lg text-sm font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-lime-500 focus:border-transparent transition-all"
                      placeholder="Enter phone number"
                    />
                  ) : (
                    <p className="font-semibold text-slate-900 text-sm sm:text-base">
                      {employee.emergencyContact?.phone || 'N/A'}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Aadhaar Verification Section - only show here when profile is complete and not in complete profile mode */}
            {!isCompleteProfileMode && profileCompletionStatus?.isComplete && (
              <AadhaarVerificationSection
                initialStatus={profileCompletionStatus?.steps ? {
                  aadhaarFront: profileCompletionStatus.steps.aadhaarUpload?.frontUploaded ? { url: true } : null,
                  aadhaarBack: profileCompletionStatus.steps.aadhaarUpload?.backUploaded ? { url: true } : null,
                  ocrVerification: {
                    status: profileCompletionStatus.steps.ocrVerification?.status || 'pending',
                    extractedData: null,
                    mismatches: profileCompletionStatus.steps.ocrVerification?.mismatches || []
                  }
                } : null}
                onStatusChange={handleAadhaarStatusChange}
                onUseAadhaarData={handleUseAadhaarData}
                showUrgentWarning={false}
              />
            )}

            {/* Active Sessions Section - always visible */}
            <ActiveSessionsSection />

            {/* Mobile only: Status and Edit buttons at bottom */}
            <div className="lg:hidden mt-8 mb-4">
              <StatusEditButtons />
            </div>
          </div>
        </div>
      </div>

      {/* Image Editor Modal */}
      <ModalPortal show={showImageEditor}>
        <div
          className="fixed inset-0 modal-overlay-dark flex items-center justify-center p-0 sm:p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-none sm:rounded-3xl shadow-2xl w-full h-full sm:max-w-5xl sm:max-h-[95vh] sm:h-auto overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 flex-shrink-0">
              <div className="flex flex-col">
                <h2 className="text-base sm:text-lg font-semibold text-slate-900">
                  Edit Profile Picture
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Crop, adjust and fine-tune how your profile photo looks.
                </p>
              </div>
              <button
                onClick={closeImageEditor}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
                title="Close"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>

            {/* Editor Content */}
            <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row lg:p-6 lg:gap-6 bg-slate-50/60">
              {/* Preview area */}
              <div className="lg:flex-[2] flex-shrink-0 sticky top-0 bg-slate-50 z-10 lg:static rounded-none lg:rounded-2xl">
                <div className="bg-slate-100 rounded-none lg:rounded-2xl overflow-hidden relative h-[300px] sm:h-[350px] lg:h-[450px] border border-slate-200/80">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="relative overflow-hidden rounded-full bg-slate-200 shadow-2xl shadow-slate-900/20 border-[6px] border-white"
                      style={{ width: '260px', height: '260px' }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                    >
                      <img
                        ref={imageRef}
                        src={selectedImage}
                        alt="Preview"
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{
                          transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${imageScale}) rotate(${imageRotation}deg)`,
                          filter: `brightness(${imageBrightness}%) contrast(${imageContrast}%) saturate(${imageSaturation}%)`,
                          cursor: isDragging ? 'grabbing' : 'grab',
                          transformOrigin: 'center center',
                        }}
                        draggable={false}
                      />
                    </div>
                  </div>

                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/80 text-white px-3 py-1.5 rounded-full text-[11px] shadow-lg">
                    Drag to reposition • Use controls to adjust
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="lg:flex-1 overflow-y-auto p-4 sm:p-6 lg:p-0">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {/* Zoom */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 col-span-2 sm:col-span-1 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <FaSearchPlus className="text-slate-500 text-xs" />
                        Zoom
                      </label>
                      <span className="text-[11px] font-medium text-slate-500">
                        {Math.round(imageScale * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="3"
                      step="0.1"
                      value={imageScale}
                      onChange={(e) => setImageScale(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-slate-900"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setImageScale(Math.max(0.5, imageScale - 0.1))}
                        className="flex-1 px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <FaSearchMinus className="inline mr-1" />
                        Zoom out
                      </button>
                      <button
                        onClick={() => setImageScale(Math.min(3, imageScale + 0.1))}
                        className="flex-1 px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <FaSearchPlus className="inline mr-1" />
                        Zoom in
                      </button>
                    </div>
                  </div>

                  {/* Rotation */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 col-span-2 sm:col-span-1 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <FaUndo className="text-slate-500 text-xs" />
                        Rotation
                      </label>
                      <span className="text-[11px] font-medium text-slate-500">
                        {imageRotation}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="1"
                      value={imageRotation}
                      onChange={(e) => setImageRotation(parseInt(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-slate-900"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setImageRotation((imageRotation - 90 + 360) % 360)}
                        className="flex-1 px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <FaUndo className="inline mr-1" /> 90°
                      </button>
                      <button
                        onClick={() => setImageRotation((imageRotation + 90) % 360)}
                        className="flex-1 px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <FaRedo className="inline mr-1" /> 90°
                      </button>
                    </div>
                  </div>

                  {/* Brightness */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 col-span-2 sm:col-span-1 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <FaSun className="text-slate-500 text-xs" />
                        Brightness
                      </label>
                      <span className="text-[11px] font-medium text-slate-500">
                        {imageBrightness}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      step="1"
                      value={imageBrightness}
                      onChange={(e) => setImageBrightness(parseInt(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-slate-900"
                    />
                  </div>

                  {/* Contrast */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 col-span-2 sm:col-span-1 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <FaAdjust className="text-slate-500 text-xs" />
                        Contrast
                      </label>
                      <span className="text-[11px] font-medium text-slate-500">
                        {imageContrast}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="150"
                      step="1"
                      value={imageContrast}
                      onChange={(e) => setImageContrast(parseInt(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-slate-900"
                    />
                  </div>

                  {/* Saturation */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 col-span-2 sm:col-span-1 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <FaAdjust className="text-slate-500 text-xs" />
                        Saturation
                      </label>
                      <span className="text-[11px] font-medium text-slate-500">
                        {imageSaturation}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="1"
                      value={imageSaturation}
                      onChange={(e) => setImageSaturation(parseInt(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-slate-900"
                    />
                  </div>

                  {/* Reset */}
                  <button
                    onClick={resetImageEditor}
                    className="col-span-2 sm:col-span-1 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-2xl hover:bg-slate-50 transition-colors text-xs font-semibold flex items-center justify-center"
                  >
                    Reset all adjustments
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 sm:gap-3 flex-shrink-0">
              <button
                onClick={closeImageEditor}
                disabled={uploadingImage}
                className="px-4 sm:px-6 py-2 bg-white border border-slate-300 text-slate-700 rounded-full hover:bg-slate-50 transition-colors text-xs sm:text-sm font-semibold disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveImage}
                disabled={uploadingImage}
                className="px-4 sm:px-6 py-2 bg-slate-900 text-white rounded-full hover:bg-black transition-colors text-xs sm:text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
              >
                {uploadingImage ? (
                  <>
                    <Loader size="xs" />
                    Saving…
                  </>
                ) : (
                  <>
                    <FaCheck />
                    Save Picture
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}
