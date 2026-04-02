'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, CardFooter, Button, Divider, Spinner } from '@heroui/react'
import { FaEye, FaEyeSlash } from 'react-icons/fa'

export default function TenantSetupPage({ params }) {
  const router = useRouter()
  const { code } = use(params)
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  useEffect(() => {
    validateCode()
  }, [code])

  const validateCode = async () => {
    try {
      const res = await fetch(`/api/setup/tenant?code=${code}`)
      const data = await res.json()

      if (data.success) {
        setCompany(data.company)
      } else {
        setError(data.message)
      }
    } catch (err) {
      setError('Failed to validate setup code')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    // Validate password strength
    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch('/api/setup/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupCode: code,
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message || 'Setup failed')
      }

      // Store token and user data
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      document.cookie = `token=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}` // 7 days

      toast.success(`Welcome to ${data.company.name}!`)
      router.push('/dashboard')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:bg-[#0F172A] dark:from-transparent dark:to-transparent">
        <div className="text-center flex flex-col items-center justify-center">
          <Spinner size="lg" color="primary" />
          <p className="mt-4 text-default-600 text-center font-medium">Validating setup link...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:bg-[#0F172A] dark:from-transparent dark:via-transparent dark:to-transparent flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl border border-default-100 dark:border-slate-700/50 bg-white/80 dark:bg-[#1E293B]/90 backdrop-blur-xl" radius="lg">
          <CardBody className="p-8 text-center">
            <div className="w-16 h-16 bg-danger-100 dark:bg-danger-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-danger-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-default-900 mb-2">Invalid Setup Link</h1>
            <p className="text-default-500 mb-6">{error}</p>
            <Button as="a" href="/login" color="primary" radius="lg" className="font-semibold">
              Go to Login
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:bg-[#0F172A] dark:from-transparent dark:via-transparent dark:to-transparent">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-200 dark:bg-primary-500/10 rounded-full blur-3xl opacity-30" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-secondary-200 dark:bg-secondary-500/10 rounded-full blur-3xl opacity-30" />
      </div>

      <div className="min-h-screen flex items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-md">
          <Card
            className="shadow-2xl border border-default-100 dark:border-slate-700/50 bg-white/80 dark:bg-[#1E293B]/90 backdrop-blur-xl"
            radius="lg"
          >
            <CardBody className="p-8 md:p-10">
              {/* Logo and Title */}
              <div className="text-center mb-8">
                <div className="flex justify-center mb-5">
                  <img
                    src="/logo.png"
                    alt="Talio Logo"
                    className="h-12 w-auto object-contain"
                  />
                </div>
                <h1 className="text-2xl font-bold text-default-900 mb-1">Welcome to Talio</h1>
                <p className="text-default-500 text-sm">
                  Setting up <span className="text-primary-600 dark:text-primary-400 font-semibold">{company?.name}</span>
                </p>
              </div>

              <h2 className="text-lg font-semibold text-default-900 mb-6">Create Admin Account</h2>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-default-700 mb-1.5">
                      First Name<span className="text-danger-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      className="input input-search"
                      placeholder="John"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-default-700 mb-1.5">
                      Last Name<span className="text-danger-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleChange}
                      className="input input-search"
                      placeholder="Doe"
                      required
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold text-default-700 mb-1.5">
                    Email Address<span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="input input-search"
                    placeholder="john@yourcompany.com"
                    required
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-semibold text-default-700 mb-1.5">
                    Password<span className="text-danger-500">*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      className="input input-search"
                      style={{ paddingRight: '2.5rem' }}
                      placeholder="Min. 8 characters"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none z-10"
                    >
                      {showPassword ? (
                        <FaEyeSlash className="text-default-400 hover:text-default-600 transition-colors" />
                      ) : (
                        <FaEye className="text-default-400 hover:text-default-600 transition-colors" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm font-semibold text-default-700 mb-1.5">
                    Confirm Password<span className="text-danger-500">*</span>
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className="input input-search"
                    placeholder="Confirm your password"
                    required
                  />
                </div>

                {/* Submit */}
                <Button
                  type="submit"
                  color="primary"
                  size="lg"
                  radius="lg"
                  isLoading={submitting}
                  isDisabled={submitting}
                  className="w-full font-semibold shadow-lg shadow-primary-500/30 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700"
                  spinner={<Spinner size="sm" color="white" />}
                >
                  {submitting ? 'Creating Account...' : 'Create Admin Account'}
                </Button>
              </form>
            </CardBody>

            <Divider />

            <CardFooter className="justify-center py-4 bg-default-50/50 dark:bg-slate-800/50">
              <p className="text-default-500 text-xs">
                Powered by <span className="text-primary-600 dark:text-primary-400 font-semibold">Talio</span>
              </p>
            </CardFooter>
          </Card>

          <p className="text-center mt-6 text-default-500 text-sm">
            Already have an account?{' '}
            <a href="/login" className="text-primary-600 font-medium hover:text-primary-700 transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
