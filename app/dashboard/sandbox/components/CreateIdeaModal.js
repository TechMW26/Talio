'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { 
  HiOutlineLightBulb,
  HiOutlineXMark,
  HiOutlineSparkles,
  HiOutlineCog6Tooth,
  HiOutlineCurrencyDollar,
  HiOutlineComputerDesktop,
  HiOutlineBuildingOffice2,
  HiOutlineUserGroup,
  HiOutlineCube,
  HiOutlineShieldCheck,
  HiOutlineGlobeAlt,
  HiOutlineAcademicCap,
  HiOutlineEyeSlash
} from 'react-icons/hi2'
import Loader from '@/components/ui/Loader'
import toast from '@/utils/toast'
import { useAILoading } from '@/contexts/AILoadingContext'

const CATEGORIES = [
  { value: 'process_improvement', label: 'Process', Icon: HiOutlineCog6Tooth },
  { value: 'cost_reduction', label: 'Cost', Icon: HiOutlineCurrencyDollar },
  { value: 'technology', label: 'Tech', Icon: HiOutlineComputerDesktop },
  { value: 'workplace', label: 'Office', Icon: HiOutlineBuildingOffice2 },
  { value: 'customer_service', label: 'Service', Icon: HiOutlineUserGroup },
  { value: 'product', label: 'Product', Icon: HiOutlineCube },
  { value: 'safety', label: 'Safety', Icon: HiOutlineShieldCheck },
  { value: 'environment', label: 'Env', Icon: HiOutlineGlobeAlt },
  { value: 'training', label: 'Learn', Icon: HiOutlineAcademicCap },
  { value: 'other', label: 'Other', Icon: HiOutlineLightBulb }
]

export default function CreateIdeaModal({ isOpen, onClose, onSuccess }) {
  const [mounted, setMounted] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'other',
    isAnonymous: false
  })
  const [submitting, setSubmitting] = useState(false)
  const [aiExpanding, setAiExpanding] = useState(false)
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleSubmit = async (e) => {
    e?.preventDefault()
    
    if (!formData.title.trim()) {
      toast.error('Please enter a title')
      return
    }
    if (!formData.description.trim()) {
      toast.error('Please enter a description')
      return
    }

    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, type: 'idea' })
      })

      const data = await res.json()
      if (data.success) {
        setFormData({ title: '', description: '', category: 'other', isAnonymous: false })
        onSuccess(data.data)
      } else {
        toast.error(data.message || 'Failed to submit idea')
      }
    } catch (error) {
      console.error('Error submitting idea:', error)
      toast.error('Failed to submit idea')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAiExpand = async () => {
    if (!formData.title.trim()) {
      toast.error('Please enter a title first')
      return
    }

    setAiExpanding(true)
    startAILoading('MIRA is expanding your idea...')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/ideas/expand', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          category: formData.category
        })
      })

      const data = await res.json()
      if (data.success && data.data?.expandedDescription) {
        setFormData(prev => ({ ...prev, description: data.data.expandedDescription }))
        toast.success('AI expanded your idea!')
      } else {
        toast.error(data.message || 'Failed to generate suggestions')
      }
    } catch (error) {
      console.error('Error expanding idea:', error)
      toast.error('Failed to expand idea with AI')
    } finally {
      setAiExpanding(false)
      stopAILoading()
    }
  }

  if (!isOpen || !mounted) return null

  const modalContent = (
    <div 
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-4"
      style={{ zIndex: 99999 }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header - Compact */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <HiOutlineLightBulb className="w-4 h-4 text-amber-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800">New Idea</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <HiOutlineXMark className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter your idea title..."
                className="w-full px-3 py-2 bg-white text-black text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                maxLength={200}
              />
            </div>

            {/* Category - Compact Grid */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <div className="grid grid-cols-5 gap-1.5">
                {CATEGORIES.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFormData({ ...formData, category: value })}
                    className={`p-1.5 rounded-lg border text-center transition-all ${
                      formData.category === value
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mx-auto mb-0.5 ${formData.category === value ? 'text-white' : 'text-gray-500'}`} />
                    <span className="text-[10px] leading-tight block">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">Description *</label>
                <button
                  type="button"
                  onClick={handleAiExpand}
                  disabled={aiExpanding || !formData.title.trim()}
                  className="flex items-center gap-1 px-2 py-1 bg-purple-600 text-white text-[10px] font-medium rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {aiExpanding ? (
                    <Loader size="xs" />
                  ) : (
                    <HiOutlineSparkles className="w-2.5 h-2.5" />
                  )}
                  <span>AI Expand</span>
                </button>
              </div>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your idea..."
                rows={3}
                className="w-full px-3 py-2 bg-white text-black text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 resize-none"
                maxLength={2000}
              />
              <div className="flex justify-end">
                <span className="text-[10px] text-gray-400">{formData.description.length}/2000</span>
              </div>
            </div>

            {/* Anonymous Toggle - Compact */}
            <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <HiOutlineEyeSlash className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-medium text-gray-700">Anonymous</span>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, isAnonymous: !formData.isAnonymous })}
                className={`toggle-switch ${formData.isAnonymous ? 'active' : ''}`}
              />
            </div>
          </form>
        </div>

        {/* Footer - Compact */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !formData.title.trim() || !formData.description.trim()}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <span className="flex items-center gap-1.5">
                <Loader size="xs" />
                Submitting...
              </span>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
