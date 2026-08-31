'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Select, SelectItem } from '@heroui/react'
import toast from '@/utils/toast'
import { PLAN_TEMPLATES, FEATURE_DEFINITIONS, FEATURE_BUNDLES, ALL_BUNDLE_KEYS, ALL_FEATURE_KEYS, getFeaturesForPlan, isBundleEnabled, toggleBundle } from '@/lib/planFeatures'
import HrmsModuleControls from '@/components/superadmin/HrmsModuleControls'

export default function NewCompanyPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')
  const [features, setFeatures] = useState(getFeaturesForPlan('custom'))
  const [miraTokensPerUser, setMiraTokensPerUser] = useState(0)
  const [formData, setFormData] = useState({
    // Basic Info
    name: '',
    slug: '',
    description: '',
    
    // Primary Contact
    primaryContact: {
      name: '',
      email: '',
      phone: '',
    },
    
    // Business Details
    businessDetails: {
      gstNumber: '',
      panNumber: '',
      tanNumber: '',
      cinNumber: '',
      businessType: '',
      industry: '',
      website: '',
    },
    
    // Billing Address
    billingAddress: {
      street: '',
      city: '',
      state: '',
      country: 'India',
      postalCode: '',
    },
    
    // Subscription
    subscription: {
      plan: 'custom',
      billingCycle: 'monthly',
      tenureDays: 30,
      amount: 0,
      maxUsers: 10,
      maxStorageGB: 1,
      startDate: new Date().toISOString().split('T')[0],
    },
    
    // Onboarding Payment
    onboarding: {
      amount: 0,
      paymentMethod: '',
      transactionId: '',
      notes: '',
      invoiceNumber: '',
    },
    
    tags: '',
  })

  // When plan changes, auto-apply the plan template features and limits
  const handlePlanChange = (plan) => {
    const tpl = PLAN_TEMPLATES[plan]
    if (!tpl) return
    setFeatures(getFeaturesForPlan(plan))
    setMiraTokensPerUser(tpl.miraTokensPerUser || 0)
    setFormData((prev) => ({
      ...prev,
      subscription: {
        ...prev.subscription,
        plan,
        maxUsers: tpl.maxUsers,
        maxStorageGB: tpl.maxStorageGB,
        amount: tpl.price,
      },
    }))
  }

  const handleToggleBundle = (bundleKey) => {
    const isOn = isBundleEnabled(features, bundleKey)
    setFeatures((prev) => toggleBundle(prev, bundleKey, !isOn))
  }

  const handleChange = (e) => {
    const { name, value, type } = e.target
    const finalValue = type === 'number' ? (value === '' ? '' : Number(value)) : value
    
    if (name.includes('.')) {
      const parts = name.split('.')
      if (parts.length === 2) {
        const [parent, child] = parts
        setFormData((prev) => ({
          ...prev,
          [parent]: { ...prev[parent], [child]: finalValue },
        }))
      }
    } else {
      setFormData((prev) => ({ ...prev, [name]: finalValue }))
    }
  }

  const generateSlug = () => {
    const slug = formData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    setFormData((prev) => ({ ...prev, slug }))
  }

  const calculateEndDate = () => {
    if (formData.subscription.startDate && formData.subscription.tenureDays) {
      const start = new Date(formData.subscription.startDate)
      const end = new Date(start.getTime() + formData.subscription.tenureDays * 24 * 60 * 60 * 1000)
      return end.toISOString().split('T')[0]
    }
    return ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('superadmin_token')
      
      // Calculate end date before submitting
      const endDate = calculateEndDate()
      
      const res = await fetch('/api/superadmin/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          subscription: {
            ...formData.subscription,
            endDate,
            status: 'active',
          },
          features,
          miraTokens: {
            perUserAllocation: miraTokensPerUser,
            allocationNote: '',
          },
          tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message || 'Failed to create company')
      }

      toast.success('Company created successfully!')
      
      if (data.company.setupUrl) {
        toast.success(`Setup URL copied to clipboard!`, { duration: 5000 })
        navigator.clipboard.writeText(data.company.setupUrl)
      }

      router.push(`/superadmin/companies/${data.company.id}`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    { id: 'basic', label: 'Basic Info' },
    { id: 'contact', label: 'Contact & Address' },
    { id: 'business', label: 'Business Details' },
    { id: 'subscription', label: 'Plan & Subscription' },
    { id: 'features', label: 'Features' },
    { id: 'payment', label: 'Onboarding Payment' },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors mb-4"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Add New Company</h1>
        <p className="text-gray-500 mt-1">Create a new tenant company with complete onboarding details</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Basic Info Tab */}
        {activeTab === 'basic' && (
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Company Information</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                onBlur={() => !formData.slug && generateSlug()}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                placeholder="Acme Corporation"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Slug (URL identifier) *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="slug"
                  value={formData.slug}
                  onChange={handleChange}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="acme-corp"
                  pattern="[a-z0-9]+[a-z0-9-]*[a-z0-9]+|[a-z0-9]+"
                  title="Lowercase letters, numbers, and hyphens only (min 2 chars, no leading/trailing hyphens)"
                  minLength={2}
                  required
                />
                <button
                  type="button"
                  onClick={generateSlug}
                  className="px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-200 transition-colors"
                >
                  Generate
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Database: talio_company_{formData.slug || 'slug'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white resize-none"
                placeholder="Brief description of the company..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                name="tags"
                value={formData.tags}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                placeholder="partner, enterprise, priority"
              />
            </div>
          </div>
        )}

        {/* Contact & Address Tab */}
        {activeTab === 'contact' && (
          <div className="space-y-6">
            {/* Primary Contact */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Primary Contact</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contact Name *
                  </label>
                  <input
                    type="text"
                    name="primaryContact.name"
                    value={formData.primaryContact.name}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contact Email *
                  </label>
                  <input
                    type="email"
                    name="primaryContact.email"
                    value={formData.primaryContact.email}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="john@acme.com"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  name="primaryContact.phone"
                  value={formData.primaryContact.phone}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            {/* Billing Address */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing Address</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Street Address
                </label>
                <input
                  type="text"
                  name="billingAddress.street"
                  value={formData.billingAddress.street}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="123 Business Street, Suite 100"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                  <input
                    type="text"
                    name="billingAddress.city"
                    value={formData.billingAddress.city}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="Mumbai"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
                  <input
                    type="text"
                    name="billingAddress.state"
                    value={formData.billingAddress.state}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="Maharashtra"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
                  <input
                    type="text"
                    name="billingAddress.country"
                    value={formData.billingAddress.country}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="India"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Postal Code</label>
                  <input
                    type="text"
                    name="billingAddress.postalCode"
                    value={formData.billingAddress.postalCode}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="400001"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Business Details Tab */}
        {activeTab === 'business' && (
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Business Details</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">GST Number</label>
                <input
                  type="text"
                  name="businessDetails.gstNumber"
                  value={formData.businessDetails.gstNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white uppercase"
                  placeholder="27AAAAA0000A1Z5"
                  maxLength={15}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">PAN Number</label>
                <input
                  type="text"
                  name="businessDetails.panNumber"
                  value={formData.businessDetails.panNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white uppercase"
                  placeholder="AAAAA0000A"
                  maxLength={10}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">TAN Number</label>
                <input
                  type="text"
                  name="businessDetails.tanNumber"
                  value={formData.businessDetails.tanNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white uppercase"
                  placeholder="AAAA00000A"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">CIN Number</label>
                <input
                  type="text"
                  name="businessDetails.cinNumber"
                  value={formData.businessDetails.cinNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white uppercase"
                  placeholder="U00000MH0000PTC000000"
                  maxLength={21}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Business Type</label>
                <Select
                  selectedKeys={formData.businessDetails.businessType ? [formData.businessDetails.businessType] : []}
                  onChange={(e) => handleChange({ target: { name: 'businessDetails.businessType', value: e.target.value } })}
                  aria-label="Business Type"
                  placeholder="Select Type"
                  classNames={{ trigger: "bg-gray-50" }}
                >
                  <SelectItem key="private_limited">Private Limited</SelectItem>
                  <SelectItem key="public_limited">Public Limited</SelectItem>
                  <SelectItem key="llp">LLP</SelectItem>
                  <SelectItem key="partnership">Partnership</SelectItem>
                  <SelectItem key="proprietorship">Proprietorship</SelectItem>
                  <SelectItem key="other">Other</SelectItem>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
                <input
                  type="text"
                  name="businessDetails.industry"
                  value={formData.businessDetails.industry}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="Technology, Manufacturing, etc."
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
              <input
                type="url"
                name="businessDetails.website"
                value={formData.businessDetails.website}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                placeholder="https://www.acme.com"
              />
            </div>
          </div>
        )}

        {/* Plan & Subscription Tab */}
        {activeTab === 'subscription' && (
          <div className="space-y-6">
            {/* Plan Selection Cards */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Plan</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(PLAN_TEMPLATES).map(([key, tpl]) => {
                  const isSelected = formData.subscription.plan === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handlePlanChange(key)}
                      className={`relative text-left p-5 rounded-2xl border-2 transition-all ${
                        isSelected
                          ? 'border-purple-600 bg-purple-50 shadow-lg shadow-purple-500/10'
                          : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-md'
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute top-3 right-3 w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                      <div className="font-bold text-gray-900 text-lg">{tpl.label}</div>
                      <div className="text-purple-600 font-semibold text-xl mt-1">{tpl.priceLabel}</div>
                      <div className="text-gray-500 text-xs mt-1">{tpl.tagline}</div>
                      <div className="flex gap-3 mt-3 text-xs text-gray-500">
                        <span>Up to {tpl.maxUsers} users</span>
                        <span>{tpl.maxStorageGB} GB</span>
                      </div>
                      {key === 'starter' && (
                        <div className="mt-2 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-lg inline-block">
                          100 MIRA tokens/user (1st month)
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Subscription Details */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Subscription Details</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Billing Cycle</label>
                  <Select
                    selectedKeys={[formData.subscription.billingCycle]}
                    onChange={(e) => handleChange({ target: { name: 'subscription.billingCycle', value: e.target.value } })}
                    aria-label="Billing Cycle"
                    classNames={{ trigger: "bg-gray-50" }}
                  >
                    <SelectItem key="monthly">Monthly</SelectItem>
                    <SelectItem key="quarterly">Quarterly</SelectItem>
                    <SelectItem key="yearly">Yearly</SelectItem>
                    <SelectItem key="custom">Custom</SelectItem>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount (₹/user/month)</label>
                  <input
                    type="number"
                    name="subscription.amount"
                    value={formData.subscription.amount}
                    onChange={handleChange}
                    min="0"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    name="subscription.startDate"
                    value={formData.subscription.startDate}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tenure (Days)</label>
                  <input
                    type="number"
                    name="subscription.tenureDays"
                    value={formData.subscription.tenureDays}
                    onChange={handleChange}
                    min="1"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date (Calculated)</label>
                  <input
                    type="date"
                    value={calculateEndDate()}
                    disabled
                    className="w-full px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-gray-600 cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 mt-4">
                <h3 className="text-md font-medium text-gray-900 mb-4">Usage Limits</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Max Users</label>
                    <input
                      type="number"
                      name="subscription.maxUsers"
                      value={formData.subscription.maxUsers}
                      onChange={handleChange}
                      min="1"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Company cannot add more users beyond this limit</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Max Storage (GB)</label>
                    <input
                      type="number"
                      name="subscription.maxStorageGB"
                      value={formData.subscription.maxStorageGB}
                      onChange={handleChange}
                      min="1"
                      step="1"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Storage limit for uploads and data</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Features Tab */}
        {activeTab === 'features' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Feature Sets</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {formData.subscription.plan === 'custom'
                      ? 'Manually configure which feature sets this company can access.'
                      : `Pre-filled from the ${PLAN_TEMPLATES[formData.subscription.plan]?.label || ''} plan. You can override below.`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFeatures(Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, true])))}
                    className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                  >
                    Enable All
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeatures(Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, false])))}
                    className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Disable All
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeatures(getFeaturesForPlan(formData.subscription.plan))}
                    className="px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                  >
                    Reset to Plan
                  </button>
                </div>
              </div>

              {/* Bundle toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ALL_BUNDLE_KEYS.map((bk) => {
                  const bundle = FEATURE_BUNDLES[bk]
                  const isOn = isBundleEnabled(features, bk)
                  return (
                    <button
                      key={bk}
                      type="button"
                      onClick={() => handleToggleBundle(bk)}
                      className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                        isOn
                          ? 'border-green-400 bg-green-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className={`w-10 h-6 rounded-full flex items-center transition-colors shrink-0 mt-0.5 ${
                        isOn ? 'bg-green-500 justify-end' : 'bg-gray-300 justify-start'
                      }`}>
                        <div className="w-5 h-5 bg-white rounded-full shadow-sm mx-0.5" />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-sm font-semibold ${isOn ? 'text-green-800' : 'text-gray-500'}`}>
                          {bundle.icon} {bundle.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{bundle.description}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          {bundle.features.map((fk) => FEATURE_DEFINITIONS[fk].label).join(', ')}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <HrmsModuleControls features={features} onChange={setFeatures} />

            {/* MIRA Tokens Per User */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h3 className="text-md font-semibold text-gray-900 mb-3">MIRA AI Token Allocation</h3>
              <p className="text-sm text-gray-500 mb-4">Set the number of MIRA AI tokens each user receives. Set to 0 for no allocation.</p>
              <div className="max-w-xs">
                <label className="block text-sm font-medium text-gray-700 mb-2">Tokens per user</label>
                <input
                  type="number"
                  value={miraTokensPerUser}
                  onChange={(e) => setMiraTokensPerUser(Number(e.target.value) || 0)}
                  min="0"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Feature summary */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Summary</h3>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-green-600 font-bold">{ALL_BUNDLE_KEYS.filter((bk) => isBundleEnabled(features, bk)).length}</span>
                  <span className="text-gray-500 ml-1">bundles enabled</span>
                </div>
                <div>
                  <span className="text-green-600 font-bold">{ALL_FEATURE_KEYS.filter((k) => features[k]).length}</span>
                  <span className="text-gray-500 ml-1">features enabled</span>
                </div>
                <div>
                  <span className="text-gray-400 font-bold">{ALL_FEATURE_KEYS.filter((k) => !features[k]).length}</span>
                  <span className="text-gray-500 ml-1">disabled</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Onboarding Payment Tab */}
        {activeTab === 'payment' && (
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Onboarding Payment</h2>
            <p className="text-sm text-gray-500 mb-4">
              Record the initial payment received during company onboarding (setup fees, advance, etc.)
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount Paid (₹)</label>
                <input
                  type="number"
                  name="onboarding.amount"
                  value={formData.onboarding.amount}
                  onChange={handleChange}
                  min="0"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
                <Select
                  selectedKeys={formData.onboarding.paymentMethod ? [formData.onboarding.paymentMethod] : []}
                  onChange={(e) => handleChange({ target: { name: 'onboarding.paymentMethod', value: e.target.value } })}
                  aria-label="Payment Method"
                  placeholder="Select Method"
                  classNames={{ trigger: "bg-gray-50" }}
                >
                  <SelectItem key="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem key="upi">UPI</SelectItem>
                  <SelectItem key="card">Card</SelectItem>
                  <SelectItem key="cash">Cash</SelectItem>
                  <SelectItem key="cheque">Cheque</SelectItem>
                  <SelectItem key="other">Other</SelectItem>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Transaction ID</label>
                <input
                  type="text"
                  name="onboarding.transactionId"
                  value={formData.onboarding.transactionId}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="TXN123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Invoice Number</label>
                <input
                  type="text"
                  name="onboarding.invoiceNumber"
                  value={formData.onboarding.invoiceNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="INV-2024-001"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea
                name="onboarding.notes"
                value={formData.onboarding.notes}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white resize-none"
                placeholder="Additional notes about the payment..."
              />
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => {
              const idx = tabs.findIndex((t) => t.id === activeTab)
              if (idx > 0) setActiveTab(tabs[idx - 1].id)
              else router.back()
            }}
            className="flex-1 py-3 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            {activeTab === tabs[0].id ? 'Cancel' : 'Back'}
          </button>
          {activeTab === tabs[tabs.length - 1].id ? (
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/25"
            >
              {loading ? 'Creating...' : 'Create Company'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const idx = tabs.findIndex((t) => t.id === activeTab)
                if (idx < tabs.length - 1) setActiveTab(tabs[idx + 1].id)
              }}
              className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all shadow-lg shadow-purple-500/25"
            >
              Next
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
