'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { FaArrowLeft, FaEdit, FaTrash, FaBriefcase, FaMapMarkerAlt, FaClock, FaDollarSign, FaUsers, FaEye } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function JobDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [applications, setApplications] = useState([])
  const [user, setUser] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchJob()
    fetchApplications()
  }, [params.id])

  const fetchJob = async () => {
    try {
      // Mock data for now - replace with actual API call
      const mockJob = {
        _id: params.id,
        title: 'Senior Software Engineer',
        department: { name: 'Engineering', _id: 'dept1' },
        location: 'New York, NY',
        employmentType: 'full-time',
        experienceLevel: 'senior-level',
        salaryRange: { min: 80000, max: 120000, currency: 'USD' },
        description: 'We are looking for a Senior Software Engineer to join our dynamic engineering team. You will be responsible for designing, developing, and maintaining high-quality software solutions that drive our business forward.',
        requirements: [
          '5+ years of experience in software development',
          'Proficiency in JavaScript, React, and Node.js',
          'Experience with cloud platforms (AWS, Azure, or GCP)',
          'Strong problem-solving and analytical skills',
          'Excellent communication and teamwork abilities'
        ],
        responsibilities: [
          'Design and develop scalable web applications',
          'Collaborate with cross-functional teams to define and implement new features',
          'Write clean, maintainable, and well-documented code',
          'Participate in code reviews and mentor junior developers',
          'Troubleshoot and debug applications'
        ],
        benefits: [
          'Competitive salary and equity package',
          'Comprehensive health, dental, and vision insurance',
          'Flexible work arrangements and remote work options',
          'Professional development opportunities',
          '401(k) with company matching'
        ],
        skills: ['JavaScript', 'React', 'Node.js', 'AWS', 'MongoDB'],
        hiringManager: { firstName: 'Jane', lastName: 'Smith', position: 'Engineering Manager' },
        applicationDeadline: '2025-02-28T00:00:00.000Z',
        status: 'active',
        remote: true,
        educationLevel: 'bachelor',
        postedDate: '2024-12-01T00:00:00.000Z',
        applicationsCount: 15
      }
      
      setJob(mockJob)
    } catch (error) {
      console.error('Fetch job error:', error)
      toast.error('Failed to fetch job details')
    } finally {
      setLoading(false)
    }
  }

  const fetchApplications = async () => {
    try {
      // Mock applications data
      const mockApplications = [
        {
          _id: 'app1',
          candidate: { firstName: 'John', lastName: 'Doe', email: 'john.doe@email.com' },
          appliedDate: '2024-12-10T00:00:00.000Z',
          status: 'under-review',
          experience: '6 years'
        },
        {
          _id: 'app2',
          candidate: { firstName: 'Alice', lastName: 'Johnson', email: 'alice.johnson@email.com' },
          appliedDate: '2024-12-08T00:00:00.000Z',
          status: 'shortlisted',
          experience: '8 years'
        }
      ]
      setApplications(mockApplications)
    } catch (error) {
      console.error('Fetch applications error:', error)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this job posting?')) return

    try {
      // Mock delete - replace with actual API call
      toast.success('Job posting deleted successfully')
      router.push('/dashboard/recruitment')
    } catch (error) {
      console.error('Delete job error:', error)
      toast.error('Failed to delete job posting')
    }
  }

  const canManageJobs = () => {
    return user && ['admin', 'hr', 'manager'].includes(user.role)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800'
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'closed': return 'bg-red-100 text-red-800'
      case 'on-hold': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getApplicationStatusColor = (status) => {
    switch (status) {
      case 'applied': return 'bg-blue-100 text-blue-800'
      case 'under-review': return 'bg-yellow-100 text-yellow-800'
      case 'shortlisted': return 'bg-green-100 text-green-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      case 'hired': return 'bg-purple-100 text-purple-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Job Not Found</h1>
          <p className="text-gray-600 mb-4">The job posting you&apos;re looking for doesn&apos;t exist.</p>
          <button
            onClick={() => router.push('/dashboard/recruitment')}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            Back to Recruitment
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{job.title}</h1>
            <p className="text-gray-600 mt-1">{job.department.name} • {job.location}</p>
          </div>
        </div>
        {canManageJobs() && (
          <div className="flex space-x-3">
            <button
              onClick={() => router.push(`/dashboard/recruitment/edit/${job._id}`)}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center space-x-2"
            >
              <FaEdit className="w-4 h-4" />
              <span>Edit</span>
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center space-x-2"
            >
              <FaTrash className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Job Overview */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Job Overview</h2>
              <span className={`px-3 py-1 text-sm rounded-full ${getStatusColor(job.status)}`}>
                {job.status.replace('-', ' ')}
              </span>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="flex items-center space-x-2">
                <FaBriefcase className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Type</p>
                  <p className="font-medium capitalize">{job.employmentType.replace('-', ' ')}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <FaMapMarkerAlt className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Location</p>
                  <p className="font-medium">{job.location}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <FaClock className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Experience</p>
                  <p className="font-medium capitalize">{job.experienceLevel.replace('-', ' ')}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <FaDollarSign className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Salary</p>
                  <p className="font-medium">
                    {job.salaryRange.min && job.salaryRange.max 
                      ? `${job.salaryRange.currency} ${job.salaryRange.min.toLocaleString()} - ${job.salaryRange.max.toLocaleString()}`
                      : 'Negotiable'
                    }
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Description</h3>
              <p className="text-gray-700 leading-relaxed">{job.description}</p>
            </div>
          </div>

          {/* Requirements */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Requirements</h3>
            <ul className="space-y-2">
              {job.requirements.map((req, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="w-2 h-2 bg-primary-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span className="text-gray-700">{req}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Responsibilities */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Responsibilities</h3>
            <ul className="space-y-2">
              {job.responsibilities.map((resp, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span className="text-gray-700">{resp}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Benefits */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Benefits</h3>
            <ul className="space-y-2">
              {job.benefits.map((benefit, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></span>
                  <span className="text-gray-700">{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Job Info */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Job Information</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-500">Posted Date</p>
                <p className="font-medium">{new Date(job.postedDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Application Deadline</p>
                <p className="font-medium">{new Date(job.applicationDeadline).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Hiring Manager</p>
                <p className="font-medium">{job.hiringManager.firstName} {job.hiringManager.lastName}</p>
                <p className="text-sm text-gray-500">{job.hiringManager.position}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Remote Work</p>
                <p className="font-medium">{job.remote ? 'Available' : 'Not Available'}</p>
              </div>
            </div>
          </div>

          {/* Skills */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Required Skills</h3>
            <div className="flex flex-wrap gap-2">
              {job.skills.map((skill, index) => (
                <span key={index} className="px-3 py-1 bg-primary-100 text-primary-800 text-sm rounded-full">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {/* Applications */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Applications</h3>
              <span className="bg-primary-100 text-primary-800 px-2 py-1 rounded-full text-sm font-medium">
                {applications.length}
              </span>
            </div>
            <div className="space-y-3">
              {applications.slice(0, 3).map((app) => (
                <div key={app._id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-gray-800">
                      {app.candidate.firstName} {app.candidate.lastName}
                    </p>
                    <span className={`px-2 py-1 text-xs rounded-full ${getApplicationStatusColor(app.status)}`}>
                      {app.status.replace('-', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{app.candidate.email}</p>
                  <p className="text-sm text-gray-500">Applied: {new Date(app.appliedDate).toLocaleDateString()}</p>
                </div>
              ))}
              {applications.length > 3 && (
                <button
                  onClick={() => router.push(`/dashboard/recruitment/${job._id}/applications`)}
                  className="w-full text-center text-primary-600 hover:text-primary-800 text-sm font-medium py-2"
                >
                  View all {applications.length} applications
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
