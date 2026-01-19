'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { 
  FaUser, 
  FaIdCard, 
  FaCheckCircle, 
  FaTimes,
  FaClock,
  FaShieldAlt,
  FaArrowRight,
  FaExclamationCircle
} from 'react-icons/fa'
import ModalPortal from '@/components/ModalPortal'

/**
 * ProfileCompletionModal
 * Shows a mandatory reminder for users to complete their profile
 * Clean, modern UI matching the project design
 */
export default function ProfileCompletionModal({ 
  isOpen, 
  onClose, 
  profileStatus,
  onCompleteProfile 
}) {
  const router = useRouter()
  const [isClosing, setIsClosing] = useState(false)

  // Don't render if not open
  if (!isOpen || !profileStatus) return null

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      onClose()
    }, 200)
  }

  const handleCompleteProfile = () => {
    router.push('/dashboard/profile?edit=true&completeProfile=true')
    onClose()
    if (onCompleteProfile) onCompleteProfile()
  }

  const { steps, daysRemaining, warning, completionPercentage } = profileStatus

  // Determine urgency level
  const isUrgent = warning?.urgent || daysRemaining <= 2
  const isDanger = daysRemaining === 0

  // Get the step icon with proper styling
  const getStepIcon = (step, isComplete, status) => {
    if (isComplete) {
      return (
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <FaCheckCircle className="w-5 h-5 text-emerald-600" />
        </div>
      )
    }
    
    if (status === 'mismatch') {
      return (
        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
          <FaExclamationCircle className="w-5 h-5 text-red-600" />
        </div>
      )
    }

    const icons = {
      personalInfo: FaUser,
      aadhaarUpload: FaIdCard,
      ocrVerification: FaShieldAlt
    }
    const Icon = icons[step] || FaUser

    return (
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
    )
  }

  return (
    <ModalPortal show={true}>
      <div 
        className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-opacity duration-200 ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Backdrop */}
        <div 
          className="absolute inset-0 modal-overlay-dark"
          onClick={handleClose}
        />
        
        {/* Modal Content */}
        <div 
          className={`relative bg-white rounded-3xl shadow-2xl max-w-md w-full mx-auto transform transition-all duration-200 overflow-hidden ${
            isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
          }`}
        >
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4">
            {/* Close Button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
              aria-label="Close"
            >
              <FaTimes className="w-4 h-4" />
            </button>

            {/* Title */}
            <div className="pr-8">
              <h2 className="text-xl font-bold text-slate-900">
                Complete Your Profile
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Please complete all required steps to access all features
              </p>
            </div>
          </div>

          {/* Time Warning Banner */}
          {daysRemaining !== null && (
            <div className={`mx-6 mb-4 px-4 py-3 rounded-2xl flex items-center gap-3 ${
              isDanger 
                ? 'bg-red-50 border border-red-200' 
                : isUrgent 
                  ? 'bg-amber-50 border border-amber-200' 
                  : 'bg-blue-50 border border-blue-200'
            }`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isDanger ? 'bg-red-100' : isUrgent ? 'bg-amber-100' : 'bg-blue-100'
              }`}>
                <FaClock className={`w-4 h-4 ${
                  isDanger ? 'text-red-600' : isUrgent ? 'text-amber-600' : 'text-blue-600'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${
                  isDanger ? 'text-red-800' : isUrgent ? 'text-amber-800' : 'text-blue-800'
                }`}>
                  {isDanger 
                    ? 'Deadline Passed!' 
                    : `${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''} Remaining`
                  }
                </p>
                <p className={`text-xs ${
                  isDanger ? 'text-red-600' : isUrgent ? 'text-amber-600' : 'text-blue-600'
                }`}>
                  {isDanger 
                    ? 'Your account may be suspended' 
                    : 'Complete your profile before the deadline'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Progress Section */}
          <div className="px-6 mb-4">
            <div className="flex items-center justify-start mb-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Progress
              </span>
              <span className="text-sm font-bold text-slate-900">
                {completionPercentage}%
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  completionPercentage === 100 
                    ? 'bg-emerald-500' 
                    : completionPercentage >= 70 
                      ? 'bg-blue-500' 
                      : completionPercentage >= 40 
                        ? 'bg-amber-500' 
                        : 'bg-slate-400'
                }`}
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="px-6 space-y-3 mb-6">
            {/* Personal Info Step */}
            <div className={`p-4 rounded-2xl border transition-colors ${
              steps?.personalInfo?.complete 
                ? 'bg-emerald-50/50 border-emerald-200' 
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-start gap-3">
                {getStepIcon('personalInfo', steps?.personalInfo?.complete)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold ${
                      steps?.personalInfo?.complete ? 'text-emerald-700' : 'text-slate-700'
                    }`}>
                      {steps?.personalInfo?.label || 'Personal Information'}
                    </p>
                    {steps?.personalInfo?.complete ? (
                      <span className="text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Complete
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-slate-500">
                        {steps?.personalInfo?.completedCount || 0}/{steps?.personalInfo?.totalFields || 7}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {steps?.personalInfo?.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Aadhaar Upload Step */}
            <div className={`p-4 rounded-2xl border transition-colors ${
              steps?.aadhaarUpload?.complete 
                ? 'bg-emerald-50/50 border-emerald-200' 
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-start gap-3">
                {getStepIcon('aadhaarUpload', steps?.aadhaarUpload?.complete)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold ${
                      steps?.aadhaarUpload?.complete ? 'text-emerald-700' : 'text-slate-700'
                    }`}>
                      {steps?.aadhaarUpload?.label || 'Aadhaar Upload'}
                    </p>
                    {steps?.aadhaarUpload?.complete ? (
                      <span className="text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Complete
                      </span>
                    ) : (
                      <div className="flex gap-1">
                        <span className={`w-2 h-2 rounded-full ${
                          steps?.aadhaarUpload?.frontUploaded ? 'bg-emerald-500' : 'bg-slate-300'
                        }`} title="Front" />
                        <span className={`w-2 h-2 rounded-full ${
                          steps?.aadhaarUpload?.backUploaded ? 'bg-emerald-500' : 'bg-slate-300'
                        }`} title="Back" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {steps?.aadhaarUpload?.description}
                  </p>
                </div>
              </div>
            </div>

            {/* OCR Verification Step */}
            <div className={`p-4 rounded-2xl border transition-colors ${
              steps?.ocrVerification?.complete 
                ? 'bg-emerald-50/50 border-emerald-200' 
                : steps?.ocrVerification?.status === 'mismatch'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-start gap-3">
                {getStepIcon('ocrVerification', steps?.ocrVerification?.complete, steps?.ocrVerification?.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold ${
                      steps?.ocrVerification?.complete 
                        ? 'text-emerald-700' 
                        : steps?.ocrVerification?.status === 'mismatch'
                          ? 'text-red-700'
                          : 'text-slate-700'
                    }`}>
                      {steps?.ocrVerification?.label || 'Identity Verification'}
                    </p>
                    {steps?.ocrVerification?.complete ? (
                      <span className="text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Verified
                      </span>
                    ) : steps?.ocrVerification?.status === 'mismatch' ? (
                      <span className="text-xs font-medium text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                        Review
                      </span>
                    ) : null}
                  </div>
                  <p className={`text-xs mt-1 ${
                    steps?.ocrVerification?.status === 'mismatch' ? 'text-red-500' : 'text-slate-500'
                  }`}>
                    {steps?.ocrVerification?.description}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-3 text-slate-600 bg-slate-100 rounded-xl font-semibold text-sm hover:bg-slate-200 transition-colors"
            >
              Later
            </button>
            <button
              onClick={handleCompleteProfile}
              className={`flex-1 px-4 py-3 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                isDanger 
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-slate-900 hover:bg-black'
              }`}
            >
              Complete Now
              <FaArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
