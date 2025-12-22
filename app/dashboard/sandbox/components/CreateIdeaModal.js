'use client'

import { useState } from 'react'
import { 
  HiOutlineLightBulb,
  HiOutlineXMark,
  HiOutlineSparkles,
  HiOutlineCheck,
  HiOutlineEyeSlash
} from 'react-icons/hi2'
import { FaSpinner, FaUserSecret, FaPaperPlane } from 'react-icons/fa'
import toast from 'react-hot-toast'

const CATEGORIES = [
  { value: 'process_improvement', label: 'Process Improvement', icon: '⚙️' },
  { value: 'cost_reduction', label: 'Cost Reduction', icon: '💰' },
  { value: 'technology', label: 'Technology', icon: '💻' },
  { value: 'workplace', label: 'Workplace', icon: '🏢' },
  { value: 'customer_service', label: 'Customer Service', icon: '🤝' },
  { value: 'product', label: 'Product', icon: '📦' },
  { value: 'safety', label: 'Safety', icon: '🛡️' },
  { value: 'environment', label: 'Environment', icon: '🌱' },
  { value: 'training', label: 'Training', icon: '📚' },
  { value: 'other', label: 'Other', icon: '💡' }
]

export default function CreateIdeaModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'other',
    isAnonymous: false
  })
  const [submitting, setSubmitting] = useState(false)
  const [aiExpanding, setAiExpanding] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    
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
        body: JSON.stringify({
          ...formData,
          type: 'idea'
        })
      })

      const data = await res.json()
      if (data.success) {
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
      if (data.success && data.data) {
        setAiSuggestions(data.data)
        toast.success('AI suggestions generated!')
      } else {
        toast.error(data.message || 'Failed to generate suggestions')
      }
    } catch (error) {
      console.error('Error expanding idea:', error)
      toast.error('Failed to expand idea with AI')
    } finally {
      setAiExpanding(false)
    }
  }

  const applyAiDescription = () => {
    if (aiSuggestions?.expandedDescription) {
      setFormData(prev => ({
        ...prev,
        description: aiSuggestions.expandedDescription
      }))
      toast.success('AI description applied!')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
              <HiOutlineLightBulb className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Share Your Idea</h2>
              <p className="text-sm text-gray-500">Let your creativity flow</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <HiOutlineXMark className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Give your idea a catchy title..."
                className="w-full px-4 py-3 bg-white text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-blue-600 placeholder-gray-500"
                maxLength={200}
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, category: cat.value })}
                    className={`p-2 rounded-lg border text-center transition-all ${
                      formData.category === cat.value
                        ? 'border-blue-600 bg-blue-600 text-black'
                        : 'bg-white text-black border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <span className="block text-lg mb-0.5">{cat.icon}</span>
                    <span className="text-xs">{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Description *
                </label>
                <button
                  type="button"
                  onClick={handleAiExpand}
                  disabled={aiExpanding || !formData.title.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {aiExpanding ? (
                    <>
                      <FaSpinner className="w-3 h-3 animate-spin" />
                      <span>Expanding...</span>
                    </>
                  ) : (
                    <>
                      <HiOutlineSparkles className="w-3 h-3" />
                      <span>AI Expand</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your idea in detail..."
                rows={5}
                className="w-full px-4 py-3 bg-white text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-blue-600 placeholder-gray-500 resize-none"
                maxLength={2000}
              />
              <div className="flex justify-end mt-1">
                <span className="text-xs text-gray-400">{formData.description.length}/2000</span>
              </div>
            </div>

            {/* AI Suggestions */}
            {aiSuggestions && (
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-purple-900 flex items-center gap-2">
                    <HiOutlineSparkles className="w-4 h-4" />
                    AI Suggestions
                  </h4>
                  <button
                    type="button"
                    onClick={() => setAiSuggestions(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <HiOutlineXMark className="w-4 h-4" />
                  </button>
                </div>

                {/* Expanded Description */}
                {aiSuggestions.expandedDescription && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-purple-700">Suggested Description</span>
                      <button
                        type="button"
                        onClick={applyAiDescription}
                        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
                      >
                        <HiOutlineCheck className="w-3 h-3" />
                        Apply
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 bg-white rounded-lg p-2 line-clamp-3">
                      {aiSuggestions.expandedDescription}
                    </p>
                  </div>
                )}

                {/* Benefits */}
                {aiSuggestions.benefits?.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-medium text-purple-700">Benefits</span>
                    <ul className="mt-1 space-y-1">
                      {aiSuggestions.benefits.slice(0, 3).map((benefit, idx) => (
                        <li key={idx} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <HiOutlineCheck className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Implementation Steps */}
                {aiSuggestions.implementationSteps?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-purple-700">Steps</span>
                    <ol className="mt-1 space-y-1">
                      {aiSuggestions.implementationSteps.slice(0, 3).map((step, idx) => (
                        <li key={idx} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="w-4 h-4 bg-purple-200 rounded-full text-xs flex items-center justify-center flex-shrink-0">
                            {idx + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            {/* Anonymous Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FaUserSecret className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Submit Anonymously</p>
                  <p className="text-xs text-gray-500">Your identity will be hidden</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, isAnonymous: !formData.isAnonymous })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  formData.isAnonymous ? 'bg-purple-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    formData.isAnonymous ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white text-black border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !formData.title.trim() || !formData.description.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <>
                <FaSpinner className="w-4 h-4 animate-spin inline mr-2" />
                <span>Submitting...</span>
              </>
            ) : (
              <span>Submit Idea</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
