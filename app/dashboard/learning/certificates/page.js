'use client'

import { useState, useEffect } from 'react'
import { FaTrophy, FaDownload, FaShare, FaCalendar, FaClock, FaAward, FaMedal } from 'react-icons/fa'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'

export default function CertificatesPage() {
  const [mounted, setMounted] = useState(false)
  const [certificates, setCertificates] = useState([])

  useEffect(() => {
    setMounted(true)
  }, [])
  const [loading, setLoading] = useState(true)
  const [selectedCertificate, setSelectedCertificate] = useState(null)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchCertificates()
  }, [])

  const fetchCertificates = async () => {
    try {
      // Mock data - replace with actual API call
      const mockCertificates = [
        {
          id: 'CERT-2024-001',
          courseTitle: 'Effective Communication Skills',
          instructor: 'Mike Johnson',
          completedDate: '2024-01-28',
          issueDate: '2024-01-28',
          validUntil: null, // null means lifetime validity
          score: 95,
          duration: '6 hours',
          skills: ['Communication', 'Presentation', 'Public Speaking'],
          verificationUrl: 'https://tailo.com/verify/CERT-2024-001'
        },
        {
          id: 'CERT-2023-045',
          courseTitle: 'Project Management Fundamentals',
          instructor: 'Jane Smith',
          completedDate: '2023-12-15',
          issueDate: '2023-12-15',
          validUntil: '2025-12-15',
          score: 88,
          duration: '8 hours',
          skills: ['Project Management', 'Agile', 'Scrum'],
          verificationUrl: 'https://tailo.com/verify/CERT-2023-045'
        },
        {
          id: 'CERT-2023-032',
          courseTitle: 'Leadership & Team Building',
          instructor: 'Robert Brown',
          completedDate: '2023-11-20',
          issueDate: '2023-11-20',
          validUntil: null,
          score: 92,
          duration: '10 hours',
          skills: ['Leadership', 'Team Management', 'Motivation'],
          verificationUrl: 'https://talio.com/verify/CERT-2023-032'
        }
      ]

      setCertificates(mockCertificates)
    } catch (error) {
      console.error('Error fetching certificates:', error)
      toast.error('Failed to load certificates')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = (certificate) => {
    toast.success(`Downloading certificate ${certificate.id}...`)
    // Implement PDF download
  }

  const handleShare = (certificate) => {
    // Copy verification URL to clipboard
    navigator.clipboard.writeText(certificate.verificationUrl)
    toast.success('Verification link copied to clipboard!')
  }

  const handleViewDetails = (certificate) => {
    setSelectedCertificate(certificate)
  }

  const stats = {
    total: certificates.length,
    thisYear: certificates.filter(c => new Date(c.completedDate).getFullYear() === 2024).length,
    avgScore: certificates.length > 0
      ? Math.round(certificates.reduce((sum, c) => sum + c.score, 0) / certificates.length)
      : 0,
    totalHours: certificates.reduce((sum, c) => sum + parseInt(c.duration), 0)
  }

  // Show loading state while detecting device
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="md" />
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <FaTrophy className="text-yellow-500" />
          My Certificates
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          View and manage your earned certificates
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Total Certificates</p>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <FaTrophy className="text-4xl opacity-30" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">This Year</p>
              <p className="text-3xl font-bold mt-1">{stats.thisYear}</p>
            </div>
            <FaCalendar className="text-4xl opacity-30" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Avg Score</p>
              <p className="text-3xl font-bold mt-1">{stats.avgScore}%</p>
            </div>
            <FaAward className="text-4xl opacity-30" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Learning Hours</p>
              <p className="text-3xl font-bold mt-1">{stats.totalHours}</p>
            </div>
            <FaClock className="text-4xl opacity-30" />
          </div>
        </div>
      </div>

      {/* Certificates Grid */}
      {loading ? (
        <div className="text-center py-12">
          <Loader size="lg" className="mx-auto" />
          <p className="text-gray-600 mt-4">Loading certificates...</p>
        </div>
      ) : certificates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <FaTrophy className="text-6xl text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No certificates yet</p>
          <p className="text-gray-500 text-sm mt-2">
            Complete courses to earn certificates
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {certificates.map((certificate) => (
            <div key={certificate.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
              {/* Certificate Header */}
              <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 p-6 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 opacity-10">
                  <FaMedal className="text-9xl transform rotate-12" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-2">
                    <FaTrophy className="text-2xl" />
                    <span className="text-sm font-medium opacity-90">Certificate of Completion</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">{certificate.courseTitle}</h3>
                  <p className="text-sm opacity-90">Certificate ID: {certificate.id}</p>
                </div>
              </div>

              {/* Certificate Details */}
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-500">Instructor</p>
                    <p className="font-medium text-gray-800">{certificate.instructor}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Score</p>
                    <p className="font-medium text-gray-800">{certificate.score}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Completed Date</p>
                    <p className="font-medium text-gray-800">
                      {new Date(certificate.completedDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Duration</p>
                    <p className="font-medium text-gray-800">{certificate.duration}</p>
                  </div>
                </div>

                {/* Validity Status */}
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Validity: </span>
                    {certificate.validUntil ? (
                      <>
                        Valid until {new Date(certificate.validUntil).toLocaleDateString()}
                        {new Date(certificate.validUntil) > new Date() ? (
                          <span className="ml-2 text-green-600 font-medium">✓ Active</span>
                        ) : (
                          <span className="ml-2 text-red-600 font-medium">⚠ Expired</span>
                        )}
                      </>
                    ) : (
                      <span className="text-green-600 font-medium">Lifetime</span>
                    )}
                  </p>
                </div>

                {/* Skills */}
                <div className="mb-4">
                  <p className="text-sm text-gray-500 mb-2">Skills Acquired</p>
                  <div className="flex flex-wrap gap-2">
                    {certificate.skills.map((skill, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(certificate)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <FaDownload />
                    Download
                  </button>
                  <button
                    onClick={() => handleShare(certificate)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    <FaShare />
                    Share
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Certificate Detail Modal */}
      {selectedCertificate && (
        <div className="fixed inset-0 flex items-center justify-center z-[9100] p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-800">Certificate Details</h2>
                <button
                  onClick={() => setSelectedCertificate(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              {/* Certificate preview would go here */}
              <div className="bg-gradient-to-br from-yellow-100 to-yellow-200 p-8 rounded-lg text-center mb-4">
                <FaTrophy className="text-6xl text-yellow-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-800 mb-2">
                  {selectedCertificate.courseTitle}
                </h3>
                <p className="text-gray-600">Certificate ID: {selectedCertificate.id}</p>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="font-medium text-gray-700">Verification URL:</span>
                  <p className="text-sm text-blue-600 break-all">{selectedCertificate.verificationUrl}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
