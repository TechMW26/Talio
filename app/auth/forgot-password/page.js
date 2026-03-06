'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FaEnvelope, FaArrowLeft, FaCheckCircle } from 'react-icons/fa'
import { 
  Card, 
  CardBody, 
  CardFooter,
  Input, 
  Button,
  Spinner,
  Divider
} from '@heroui/react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (response.ok) {
        setIsSubmitted(true)
      } else {
        setError(data.error || 'Something went wrong')
      }
    } catch (err) {
      setError('Failed to send request. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0F172A]">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-200 rounded-full blur-3xl opacity-30" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-secondary-200 rounded-full blur-3xl opacity-30" />
      </div>

      {/* Form - Centered */}
      <div className="min-h-screen flex items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-md">
          <Card 
            className="shadow-2xl border border-default-100 bg-white/80 backdrop-blur-xl"
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
                
                {!isSubmitted ? (
                  <>
                    <h1 className="text-2xl font-bold text-default-900 mb-1">Forgot Password?</h1>
                    <p className="text-default-500 text-sm">No worries! Enter your email and we'll send you a reset link.</p>
                  </>
                ) : (
                  <>
                    <div className="flex justify-center mb-4">
                      <div className="w-16 h-16 bg-success-100 rounded-full flex items-center justify-center">
                        <FaCheckCircle className="text-success-500 text-3xl" />
                      </div>
                    </div>
                    <h1 className="text-2xl font-bold text-default-900 mb-1">Check Your Email</h1>
                    <p className="text-default-500 text-sm">
                      We've sent a password reset link to{' '}
                      <span className="text-primary-600 font-medium">{email}</span>
                    </p>
                  </>
                )}
              </div>

              {!isSubmitted ? (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  {/* Email Field */}
                  <div>
                    <Input
                      label="Email Address"
                      labelPlacement="outside"
                      type="email"
                      name="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      isRequired
                      variant="bordered"
                      radius="lg"
                      size="lg"
                      startContent={
                        <FaEnvelope className="text-default-400 pointer-events-none flex-shrink-0" />
                      }
                      classNames={{
                        label: "text-default-700 font-semibold",
                        input: "text-default-900",
                        inputWrapper: "bg-default-50 hover:bg-default-100 border-default-200 hover:border-primary-300 transition-colors",
                      }}
                    />
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="p-3 bg-danger-50 border border-danger-200 rounded-xl">
                      <p className="text-danger-600 text-sm text-center">{error}</p>
                    </div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    color="primary"
                    size="lg"
                    radius="lg"
                    isLoading={isLoading}
                    isDisabled={isLoading || !email}
                    className="w-full font-semibold shadow-lg shadow-primary-500/30 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700"
                    spinner={<Spinner size="sm" color="white" />}
                  >
                    {isLoading ? 'Sending...' : 'Send Reset Link'}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  {/* Info Box */}
                  <div className="p-4 bg-warning-50 border border-warning-200 rounded-xl">
                    <p className="text-warning-700 text-sm text-center">
                      <strong>⏱️ Link expires in 15 minutes</strong>
                      <br />
                      <span className="text-warning-600">
                        Check your spam folder if you don't see it.
                      </span>
                    </p>
                  </div>

                  {/* Try Different Email */}
                  <Button
                    variant="light"
                    color="primary"
                    size="lg"
                    radius="lg"
                    className="w-full"
                    onPress={() => {
                      setIsSubmitted(false)
                      setEmail('')
                    }}
                  >
                    Try a different email
                  </Button>
                </div>
              )}
            </CardBody>

            <Divider />

            {/* Footer */}
            <CardFooter className="justify-center py-4">
              <Link 
                href="/login" 
                className="inline-flex items-center gap-2 text-default-500 hover:text-primary-600 text-sm font-medium transition-colors"
              >
                <FaArrowLeft className="text-xs" />
                Back to Login
              </Link>
            </CardFooter>
          </Card>

          {/* Help Link */}
          <p className="text-center text-default-400 text-sm mt-6">
            Need help?{' '}
            <a href="mailto:support@talio.in" className="text-primary-600 hover:underline">
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
