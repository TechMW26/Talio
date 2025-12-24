'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'

export default function NewCompanyPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')
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
      maxStorageMB: 500,
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
    { id: 'subscription', label: 'Subscription' },
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
                  pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                  title="Lowercase letters, numbers, and hyphens only"
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
                <select
                  name="businessDetails.businessType"
                  value={formData.businessDetails.businessType}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Select Type</option>
                  <option value="private_limited">Private Limited</option>
                  <option value="public_limited">Public Limited</option>
                  <option value="llp">LLP</option>
                  <option value="partnership">Partnership</option>
                  <option value="proprietorship">Proprietorship</option>
                  <option value="other">Other</option>
                </select>
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

        {/* Subscription Tab */}
        {activeTab === 'subscription' && (
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Subscription Details</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Plan</label>
                <select
                  name="subscription.plan"
                  value={formData.subscription.plan}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="trial">Trial</option>
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Billing Cycle</label>
                <select
                  name="subscription.billingCycle"
                  value={formData.subscription.billingCycle}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount (₹)</label>
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Max Storage (MB)</label>
                  <input
                    type="number"
                    name="subscription.maxStorageMB"
                    value={formData.subscription.maxStorageMB}
                    onChange={handleChange}
                    min="100"
                    step="100"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Storage limit for uploads and data</p>
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
                <select
                  name="onboarding.paymentMethod"
                  value={formData.onboarding.paymentMethod}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Select Method</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
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

        {/* Submit Buttons */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 py-3 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/25"
          >
            {loading ? 'Creating...' : 'Create Company'}
          </button>
        </div>
      </form>
    </div>
  )
}
