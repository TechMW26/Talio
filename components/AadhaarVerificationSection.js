'use client'

import { useState, useRef, useEffect } from 'react'
import {
  FaIdCard,
  FaUpload,
  FaCheckCircle,
  FaTimesCircle,
  FaExclamationTriangle,
  FaShieldAlt,
  FaCamera,
  FaEye,
  FaTimes,
  FaSync
} from 'react-icons/fa'
import toast from '@/utils/toast'
import ModalPortal from '@/components/ModalPortal'
import { useAILoading } from '@/contexts/AILoadingContext'
import Loader from '@/components/ui/Loader'

/**
 * AadhaarVerificationSection
 * Component for uploading and verifying Aadhaar documents
 */
export default function AadhaarVerificationSection({
  initialStatus,
  onStatusChange,
  onUseAadhaarData,
  showUrgentWarning = false
}) {
  const [frontImage, setFrontImage] = useState(null)
  const [backImage, setBackImage] = useState(null)
  const [frontPreview, setFrontPreview] = useState(null)
  const [backPreview, setBackPreview] = useState(null)
  const [uploadingFront, setUploadingFront] = useState(false)
  const [uploadingBack, setUploadingBack] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verificationStatus, setVerificationStatus] = useState(initialStatus?.ocrVerification?.status || 'pending')
  const [extractedData, setExtractedData] = useState(initialStatus?.ocrVerification?.extractedData || null)
  const [mismatches, setMismatches] = useState(initialStatus?.ocrVerification?.mismatches || [])
  const [suggestions, setSuggestions] = useState(initialStatus?.ocrVerification?.suggestions || [])
  const [showPreviewModal, setShowPreviewModal] = useState(null)

  const frontInputRef = useRef(null)
  const backInputRef = useRef(null)
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  // Load existing uploads on mount
  useEffect(() => {
    const loadExistingImages = async () => {
      const token = localStorage.getItem('token')
      if (!token) return

      // Fetch Aadhaar upload status
      try {
        const response = await fetch('/api/profile/aadhaar-upload', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const result = await response.json()

        if (result.success && result.data) {
          if (result.data.aadhaarFront?.url) {
            // Load the actual image through the secured endpoint
            loadSecuredImage(result.data.aadhaarFront.url, setFrontPreview, token)
          }
          if (result.data.aadhaarBack?.url) {
            loadSecuredImage(result.data.aadhaarBack.url, setBackPreview, token)
          }
        }
      } catch (error) {
        console.error('Error loading Aadhaar images:', error)
      }
    }

    loadExistingImages()
  }, [])

  // Load image - either directly from external URL (ImageKit) or through secured API endpoint
  const loadSecuredImage = async (url, setPreview, token) => {
    try {
      // If URL is an external URL (ImageKit, etc.), use it directly
      if (url.startsWith('http://') || url.startsWith('https://')) {
        console.log('[Aadhaar] Loading image directly from external URL:', url)
        setPreview(url)
        return
      }

      // For local paths, load through secured API endpoint
      const apiUrl = `/api${url}`
      console.log('[Aadhaar] Loading image through secured API:', apiUrl)
      const response = await fetch(apiUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        setPreview(objectUrl)
      }
    } catch (error) {
      console.error('Error loading secured image:', error)
    }
  }

  const handleImageSelect = async (side, file) => {
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

    // Read and preview
    const reader = new FileReader()
    reader.onloadend = async () => {
      const imageData = reader.result

      if (side === 'front') {
        setFrontImage(imageData)
        setFrontPreview(imageData)
        await uploadImage('front', imageData)
      } else {
        setBackImage(imageData)
        setBackPreview(imageData)
        await uploadImage('back', imageData)
      }
    }
    reader.readAsDataURL(file)
  }

  const uploadImage = async (side, imageData) => {
    const setUploading = side === 'front' ? setUploadingFront : setUploadingBack
    setUploading(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/profile/aadhaar-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ side, imageData })
      })

      const result = await response.json()

      if (result.success) {
        toast.success(`Aadhaar ${side} uploaded successfully`)

        // Reset verification status when new images are uploaded
        setVerificationStatus('pending')
        setExtractedData(null)
        setMismatches([])

        if (onStatusChange) {
          onStatusChange({
            aadhaarUploaded: result.data.bothUploaded,
            verificationStatus: 'pending'
          })
        }
      } else {
        toast.error(result.message || 'Failed to upload image')
        // Reset preview on failure
        if (side === 'front') {
          setFrontPreview(initialStatus?.aadhaarFront?.url || null)
        } else {
          setBackPreview(initialStatus?.aadhaarBack?.url || null)
        }
      }
    } catch (error) {
      console.error('Upload error:', error)
      toast.error('Failed to upload image')
    } finally {
      setUploading(false)
    }
  }

  const handleVerify = async () => {
    if (!frontPreview || !backPreview) {
      toast.error('Please upload both front and back of your Aadhaar card')
      return
    }

    setVerifying(true)
    startAILoading('MIRA is verifying your Aadhaar documents...')

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/profile/verify-aadhaar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })

      const result = await response.json()

      if (result.success) {
        setVerificationStatus(result.data.status)
        setExtractedData(result.data.extractedData)
        setMismatches(result.data.mismatches || [])
        setSuggestions(result.data.suggestions || [])

        if (result.verified) {
          toast.success('Aadhaar verification successful!')
        } else {
          toast.error('Verification found mismatches. Please review.')
        }

        if (onStatusChange) {
          onStatusChange({
            verificationStatus: result.data.status,
            verified: result.verified,
            extractedData: result.data.extractedData
          })
        }
      } else {
        toast.error(result.message || 'Verification failed')
        setVerificationStatus('failed')
        // Store failure reason and suggestions from failed response
        if (result.suggestion) {
          setSuggestions([result.suggestion])
        }
      }
    } catch (error) {
      console.error('Verification error:', error)
      toast.error('Verification failed. Please try again.')
      setVerificationStatus('failed')
    } finally {
      setVerifying(false)
      stopAILoading()
    }
  }

  const getStatusBadge = () => {
    switch (verificationStatus) {
      case 'verified':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">
            <FaCheckCircle className="w-3 h-3" />
            Verified
          </span>
        )
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
            <FaExclamationTriangle className="w-3 h-3" />
            Mismatch Found
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
            <FaTimesCircle className="w-3 h-3" />
            Verification Failed
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
            <FaShieldAlt className="w-3 h-3" />
            Pending Verification
          </span>
        )
    }
  }

  return (
    <section className={`bg-white rounded-3xl border shadow-sm p-4 sm:p-6 ${showUrgentWarning
      ? 'border-red-200 ring-2 ring-red-100'
      : 'border-slate-100 shadow-slate-900/5'
      }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <FaIdCard className="text-blue-600 text-lg" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">
              Aadhaar Verification
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Upload your Aadhaar card for identity verification
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Urgent Warning */}
      {showUrgentWarning && verificationStatus !== 'verified' && (
        <div className="mb-5 p-4 rounded-xl bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <FaExclamationTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-800 text-sm">Mandatory Document Upload</p>
              <p className="text-xs text-red-600 mt-1">
                Aadhaar verification is required to complete your profile. Your account may be suspended if not completed within the deadline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Front Side Upload */}
        <div className="relative">
          <input
            ref={frontInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleImageSelect('front', e.target.files?.[0])}
            className="hidden"
          />

          <div
            onClick={() => !uploadingFront && frontInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-4 transition-all cursor-pointer ${frontPreview
              ? 'border-green-300 bg-green-50/50'
              : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
              }`}
          >
            {frontPreview ? (
              <div className="relative">
                <img
                  src={frontPreview}
                  alt="Aadhaar Front"
                  className={`w-full h-32 object-cover rounded-xl ${uploadingFront ? 'opacity-50' : ''}`}
                />
                {/* Loading Overlay */}
                {uploadingFront && (
                  <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <Loader size="md" />
                      <p className="text-xs text-blue-600 mt-2 font-medium">Uploading...</p>
                    </div>
                  </div>
                )}
                {/* Hover Overlay - only show when not uploading */}
                {!uploadingFront && (
                  <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowPreviewModal('front')
                        }}
                        className="p-2 bg-white rounded-full text-slate-700 hover:bg-slate-100"
                      >
                        <FaEye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          frontInputRef.current?.click()
                        }}
                        className="p-2 bg-white rounded-full text-slate-700 hover:bg-slate-100"
                      >
                        <FaCamera className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
                {/* Success checkmark - only show when not uploading */}
                {!uploadingFront && (
                  <div className="absolute top-2 right-2">
                    <FaCheckCircle className="w-5 h-5 text-green-500" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6">
                {uploadingFront ? (
                  <div className="mb-2"><Loader size="md" /></div>
                ) : (
                  <FaUpload className="w-8 h-8 text-slate-400 mb-2" />
                )}
                <p className="text-sm font-medium text-slate-700">
                  {uploadingFront ? 'Uploading...' : 'Aadhaar Front'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Click to upload
                </p>
              </div>
            )}
          </div>
          <p className="text-center text-xs text-slate-500 mt-2">Front Side</p>
        </div>

        {/* Back Side Upload */}
        <div className="relative">
          <input
            ref={backInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleImageSelect('back', e.target.files?.[0])}
            className="hidden"
          />

          <div
            onClick={() => !uploadingBack && backInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-4 transition-all cursor-pointer ${backPreview
              ? 'border-green-300 bg-green-50/50'
              : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
              }`}
          >
            {backPreview ? (
              <div className="relative">
                <img
                  src={backPreview}
                  alt="Aadhaar Back"
                  className={`w-full h-32 object-cover rounded-xl ${uploadingBack ? 'opacity-50' : ''}`}
                />
                {/* Loading Overlay */}
                {uploadingBack && (
                  <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <Loader size="md" />
                      <p className="text-xs text-blue-600 mt-2 font-medium">Uploading...</p>
                    </div>
                  </div>
                )}
                {/* Hover Overlay - only show when not uploading */}
                {!uploadingBack && (
                  <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowPreviewModal('back')
                        }}
                        className="p-2 bg-white rounded-full text-slate-700 hover:bg-slate-100"
                      >
                        <FaEye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          backInputRef.current?.click()
                        }}
                        className="p-2 bg-white rounded-full text-slate-700 hover:bg-slate-100"
                      >
                        <FaCamera className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
                {/* Success checkmark - only show when not uploading */}
                {!uploadingBack && (
                  <div className="absolute top-2 right-2">
                    <FaCheckCircle className="w-5 h-5 text-green-500" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6">
                {uploadingBack ? (
                  <div className="mb-2"><Loader size="md" /></div>
                ) : (
                  <FaUpload className="w-8 h-8 text-slate-400 mb-2" />
                )}
                <p className="text-sm font-medium text-slate-700">
                  {uploadingBack ? 'Uploading...' : 'Aadhaar Back'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Click to upload
                </p>
              </div>
            )}
          </div>
          <p className="text-center text-xs text-slate-500 mt-2">Back Side</p>
        </div>
      </div>

      {/* Verification Button */}
      {verificationStatus !== 'verified' && (
        <div className="mb-5">
          <button
            onClick={handleVerify}
            disabled={verifying || uploadingFront || uploadingBack || !frontPreview || !backPreview}
            className={`w-full py-3 px-4 rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 ${!frontPreview || !backPreview || uploadingFront || uploadingBack
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
          >
            {verifying ? (
              <>
                <Loader size="xs" color="#ffffff" />
                Verifying with OCR...
              </>
            ) : uploadingFront || uploadingBack ? (
              <>
                <Loader size="xs" color="#ffffff" />
                Waiting for upload...
              </>
            ) : !frontPreview || !backPreview ? (
              <>
                <FaUpload className="w-4 h-4" />
                Upload both images to verify
              </>
            ) : (
              <>
                <FaShieldAlt className="w-4 h-4" />
                {verificationStatus === 'failed' || verificationStatus === 'mismatch'
                  ? 'Retry Verification'
                  : 'Verify Aadhaar'}
              </>
            )}
          </button>
        </div>
      )}

      {/* Mismatch Alert */}
      {verificationStatus === 'mismatch' && mismatches.length > 0 && (
        <div className="mb-5 p-4 rounded-xl bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <FaExclamationTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-red-800 text-sm">Data Mismatch Detected</p>
              <p className="text-xs text-red-600 mt-1 mb-3">
                The following fields do not match your profile information:
              </p>
              <div className="space-y-2">
                {mismatches.map((mismatch, index) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-red-200">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-red-700">{mismatch.field}</p>
                      {onUseAadhaarData && mismatch.aadhaarValue && (
                        <button
                          onClick={() => onUseAadhaarData(mismatch.field.toLowerCase().replace(' ', ''), mismatch.aadhaarValue)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors font-medium"
                        >
                          Use Aadhaar Value
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500">Profile:</span>
                        <span className="ml-1 text-slate-700">{mismatch.profileValue || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Aadhaar:</span>
                        <span className="ml-1 text-slate-700">{mismatch.aadhaarValue || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Suggestion for Address if extracted */}
              {extractedData?.address && (
                <div className="mt-3 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-xs font-medium text-blue-700 mb-1">Address from Aadhaar</p>
                      <p className="text-xs text-slate-600">{extractedData.address}</p>
                    </div>
                    {onUseAadhaarData && (
                      <button
                        onClick={() => onUseAadhaarData('address', extractedData.address)}
                        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                      >
                        Use Address
                      </button>
                    )}
                  </div>
                </div>
              )}

              <p className="text-xs text-red-600 mt-3">
                Please update your profile to match your Aadhaar details, or contact HR if there's an error.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Extracted Data Display (on successful verification) */}
      {verificationStatus === 'verified' && extractedData && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
          <div className="flex items-start gap-3">
            <FaCheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-green-800 text-sm">Verification Successful</p>
              <p className="text-xs text-green-600 mt-1 mb-3">
                Your identity has been verified successfully.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {extractedData.name && (
                  <div className="text-xs">
                    <span className="text-green-700 font-medium">Name:</span>
                    <span className="ml-1 text-slate-700">{extractedData.name}</span>
                  </div>
                )}
                {extractedData.dateOfBirth && (
                  <div className="text-xs">
                    <span className="text-green-700 font-medium">DOB:</span>
                    <span className="ml-1 text-slate-700">{extractedData.dateOfBirth}</span>
                  </div>
                )}
                {extractedData.aadhaarNumber && (
                  <div className="text-xs">
                    <span className="text-green-700 font-medium">Aadhaar:</span>
                    <span className="ml-1 text-slate-700">{extractedData.aadhaarNumber}</span>
                  </div>
                )}
              </div>

              {/* Address suggestion */}
              {extractedData.address && onUseAadhaarData && (
                <div className="mt-3 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-xs font-medium text-blue-700 mb-1">Address from Aadhaar</p>
                      <p className="text-xs text-slate-600">{extractedData.address}</p>
                    </div>
                    <button
                      onClick={() => onUseAadhaarData('address', extractedData.address)}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                    >
                      Use Address
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Security Note */}
      <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
        <p className="text-xs text-slate-600">
          <strong className="text-slate-700">Security Note:</strong> Your Aadhaar documents are stored securely and encrypted.
          Only the last 4 digits of your Aadhaar number are stored for verification purposes.
        </p>
      </div>

      {/* Image Preview Modal */}
      {showPreviewModal && (
        <ModalPortal show={true}>
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[99999]"
            onClick={() => setShowPreviewModal(null)}
          >
            <div className="relative max-w-3xl w-full">
              <button
                onClick={() => setShowPreviewModal(null)}
                className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              >
                <FaTimes className="w-6 h-6" />
              </button>
              <img
                src={showPreviewModal === 'front' ? frontPreview : backPreview}
                alt={`Aadhaar ${showPreviewModal}`}
                className="w-full rounded-xl"
                onClick={(e) => e.stopPropagation()}
              />
              <p className="text-center text-white text-sm mt-3">
                Aadhaar Card - {showPreviewModal === 'front' ? 'Front' : 'Back'} Side
              </p>
            </div>
          </div>
        </ModalPortal>
      )}
    </section>
  )
}
