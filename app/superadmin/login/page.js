'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, CardFooter, Button, Divider, Spinner } from '@heroui/react'
import { FaEnvelope, FaLock, FaEye, FaEyeSlash } from 'react-icons/fa'

export default function SuperAdminLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/superadmin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message || 'Login failed')
      }

      // Store token and superadmin data
      localStorage.setItem('superadmin_token', data.token)
      localStorage.setItem('superadmin_user', JSON.stringify(data.superadmin))

      toast.success('Welcome back, SuperAdmin!')
      router.push('/superadmin/dashboard')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:bg-[#09090b] dark:from-transparent dark:via-transparent dark:to-transparent">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-200 dark:bg-primary-500/10 rounded-full blur-3xl opacity-30" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-secondary-200 dark:bg-secondary-500/10 rounded-full blur-3xl opacity-30" />
      </div>

      <div className="min-h-screen flex items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-md">
          <Card
            className="shadow-2xl border border-default-100 dark:border-zinc-700/50 bg-white/80 dark:bg-[#18181b]/90 backdrop-blur-xl"
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
                <h1 className="text-2xl font-bold text-default-900 mb-1">Talio SuperAdmin</h1>
                <p className="text-default-500 text-sm">Platform Management Portal</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold text-default-700 mb-1.5">
                    Email Address<span className="text-danger-500">*</span>
                  </label>
                  <div className="input-with-icon">
                    <FaEnvelope className="input-icon" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input input-search"
                      placeholder="superadmin@talio.in"
                      required
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="pt-2">
                  <label className="block text-sm font-semibold text-default-700 mb-1.5">
                    Password<span className="text-danger-500">*</span>
                  </label>
                  <div className="input-with-icon" style={{ position: 'relative' }}>
                    <FaLock className="input-icon" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input input-search"
                      style={{ paddingRight: '2.5rem' }}
                      placeholder="Enter your password"
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none z-10"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <FaEyeSlash className="text-default-400 hover:text-default-600 transition-colors" />
                      ) : (
                        <FaEye className="text-default-400 hover:text-default-600 transition-colors" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  color="primary"
                  size="lg"
                  radius="lg"
                  isLoading={loading}
                  isDisabled={loading}
                  className="w-full font-semibold shadow-lg shadow-primary-500/30 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700"
                  spinner={<Spinner size="sm" color="white" />}
                >
                  {loading ? 'Authenticating...' : 'Sign In'}
                </Button>
              </form>
            </CardBody>

            <Divider />

            <CardFooter className="justify-center py-4 bg-default-50/50 dark:bg-zinc-800/50">
              <p className="text-default-500 text-xs">
                Powered by <span className="text-primary-600 dark:text-primary-400 font-semibold">Talio</span>
              </p>
            </CardFooter>
          </Card>

          <p className="text-center mt-6 text-default-500 text-sm">
            Protected access. Unauthorized login attempts are logged.
          </p>
        </div>
      </div>
    </div>
  )
}
