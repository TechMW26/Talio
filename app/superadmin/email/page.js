'use client'

import { useEffect, useState } from 'react'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'

export default function EmailPage() {
  const [companies, setCompanies] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [emailForm, setEmailForm] = useState({
    to: '',
    subject: '',
    body: '',
    cc: '',
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('superadmin_token')
      
      // Fetch companies and templates in parallel
      const [companiesRes, templatesRes] = await Promise.all([
        fetch('/api/superadmin/companies?limit=100', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/superadmin/email', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      const [companiesData, templatesData] = await Promise.all([
        companiesRes.json(),
        templatesRes.json(),
      ])

      if (companiesData.success) {
        setCompanies(companiesData.companies)
      }
      if (templatesData.success) {
        setTemplates(templatesData.templates)
      }
    } catch (error) {
      toast.error('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  const handleCompanySelect = (companyId) => {
    if (companyId === 'custom') {
      setSelectedCompany(null)
      setEmailForm({ ...emailForm, to: '' })
      return
    }

    const company = companies.find((c) => c._id === companyId)
    if (company) {
      setSelectedCompany(company)
      setEmailForm({ ...emailForm, to: company.primaryContact?.email || '' })
    }
  }

  const handleTemplateSelect = (templateId) => {
    const template = templates.find((t) => t.id === templateId)
    if (!template) return

    let body = template.body
    let subject = template.subject

    // Replace placeholders if company is selected
    if (selectedCompany) {
      const replacements = {
        '{companyName}': selectedCompany.name,
        '{plan}': selectedCompany.subscription?.plan || 'N/A',
        '{amount}': selectedCompany.subscription?.amount?.toLocaleString() || '0',
        '{expiryDate}': selectedCompany.subscription?.endDate 
          ? new Date(selectedCompany.subscription.endDate).toLocaleDateString()
          : 'N/A',
        '{maxUsers}': selectedCompany.subscription?.maxUsers?.toString() || 'N/A',
        '{currentUsers}': selectedCompany.userStats?.total?.toString() || '0',
        '{date}': new Date().toLocaleDateString(),
        '{transactionId}': 'TXN' + Date.now(),
      }

      Object.entries(replacements).forEach(([placeholder, value]) => {
        body = body.replace(new RegExp(placeholder, 'g'), value)
        subject = subject.replace(new RegExp(placeholder, 'g'), value)
      })
    }

    setEmailForm({ ...emailForm, subject, body })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!emailForm.to || !emailForm.subject || !emailForm.body) {
      toast.error('Please fill in all required fields')
      return
    }

    setSending(true)
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch('/api/superadmin/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyId: selectedCompany?._id,
          to: emailForm.to,
          subject: emailForm.subject,
          body: emailForm.body,
          cc: emailForm.cc || undefined,
        }),
      })

      const data = await res.json()
      if (data.success) {
        toast.success('Email sent successfully!')
        // Reset form
        setEmailForm({ to: '', subject: '', body: '', cc: '' })
        setSelectedCompany(null)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-96 bg-gray-100 rounded-2xl"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Email</h1>
        <p className="text-gray-500 mt-1">Send emails to companies or compose custom messages</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose Email */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Compose Email</h2>

            {/* Company Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Company</label>
              <select
                value={selectedCompany?._id || 'custom'}
                onChange={(e) => handleCompanySelect(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="custom">Custom Recipient</option>
                {companies.map((company) => (
                  <option key={company._id} value={company._id}>
                    {company.name} ({company.primaryContact?.email})
                  </option>
                ))}
              </select>
            </div>

            {/* To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">To *</label>
              <input
                type="email"
                value={emailForm.to}
                onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                placeholder="recipient@example.com"
                required
              />
            </div>

            {/* CC */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">CC (optional)</label>
              <input
                type="email"
                value={emailForm.cc}
                onChange={(e) => setEmailForm({ ...emailForm, cc: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                placeholder="cc@example.com"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Subject *</label>
              <input
                type="text"
                value={emailForm.subject}
                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                placeholder="Email subject..."
                required
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Message *</label>
              <textarea
                value={emailForm.body}
                onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })}
                rows={12}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white resize-none font-mono text-sm"
                placeholder="Type your message..."
                required
              />
            </div>

            {/* Send Button */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sending || !emailForm.to || !emailForm.subject || !emailForm.body}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/25 flex items-center gap-2"
              >
                {sending ? (
                  <>
                    <Loader size="xs" />
                    Sending...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Send Email
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Templates Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Email Templates</h2>
            <p className="text-sm text-gray-500 mb-4">Click a template to use it. Placeholders will be filled automatically when a company is selected.</p>
            <div className="space-y-3">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateSelect(template.id)}
                  className="w-full text-left p-3 bg-gray-50 border border-gray-200 rounded-xl hover:bg-purple-50 hover:border-purple-200 transition-colors"
                >
                  <p className="font-medium text-gray-900">{template.name}</p>
                  <p className="text-xs text-gray-500 mt-1 truncate">{template.subject}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Info */}
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-purple-900 mb-2">Template Placeholders</h3>
            <ul className="text-xs text-purple-700 space-y-1">
              <li><code className="bg-purple-100 px-1 rounded">{'{companyName}'}</code> - Company name</li>
              <li><code className="bg-purple-100 px-1 rounded">{'{plan}'}</code> - Subscription plan</li>
              <li><code className="bg-purple-100 px-1 rounded">{'{amount}'}</code> - Subscription amount</li>
              <li><code className="bg-purple-100 px-1 rounded">{'{expiryDate}'}</code> - Subscription end date</li>
              <li><code className="bg-purple-100 px-1 rounded">{'{maxUsers}'}</code> - Max users limit</li>
              <li><code className="bg-purple-100 px-1 rounded">{'{currentUsers}'}</code> - Current user count</li>
            </ul>
          </div>

          {/* Selected Company Info */}
          {selectedCompany && (
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Selected Company</h3>
              <div className="space-y-2 text-sm">
                <p className="text-gray-700"><span className="text-gray-500">Name:</span> {selectedCompany.name}</p>
                <p className="text-gray-700"><span className="text-gray-500">Plan:</span> {selectedCompany.subscription?.plan}</p>
                <p className="text-gray-700">
                  <span className="text-gray-500">Status:</span>{' '}
                  <span className={`font-medium ${
                    selectedCompany.serviceStatus === 'active' ? 'text-green-600' :
                    selectedCompany.serviceStatus === 'paused' ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {selectedCompany.serviceStatus}
                  </span>
                </p>
                <p className="text-gray-700">
                  <span className="text-gray-500">Expiry:</span>{' '}
                  {selectedCompany.subscription?.endDate 
                    ? new Date(selectedCompany.subscription.endDate).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
