'use client'

import { useState, useEffect } from 'react'
import { FaBook, FaClock, FaUsers, FaStar, FaPlay, FaFilter, FaSearch, FaGraduationCap } from 'react-icons/fa'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'
import { Select, SelectItem, Input } from '@heroui/react'

export default function CoursesPage() {
  const [courses, setCourses] = useState([])
  const [filteredCourses, setFilteredCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [levelFilter, setLevelFilter] = useState('all')

  useEffect(() => {
    fetchCourses()
  }, [])

  useEffect(() => {
    filterCourses()
  }, [searchTerm, categoryFilter, levelFilter, courses])

  const fetchCourses = async () => {
    try {
      // Mock data - replace with actual API call
      const mockCourses = [
        {
          id: 1,
          title: 'Advanced JavaScript Programming',
          description: 'Master modern JavaScript ES6+ features and advanced concepts',
          instructor: 'John Doe',
          duration: '12 hours',
          level: 'Advanced',
          category: 'Technical',
          rating: 4.8,
          students: 1250,
          thumbnail: '/assets/course-js.jpg',
          enrolled: false
        },
        {
          id: 2,
          title: 'Project Management Fundamentals',
          description: 'Learn the basics of project management and agile methodologies',
          instructor: 'Jane Smith',
          duration: '8 hours',
          level: 'Beginner',
          category: 'Management',
          rating: 4.6,
          students: 890,
          thumbnail: '/assets/course-pm.jpg',
          enrolled: true
        },
        {
          id: 3,
          title: 'Effective Communication Skills',
          description: 'Improve your interpersonal and professional communication',
          instructor: 'Mike Johnson',
          duration: '6 hours',
          level: 'Intermediate',
          category: 'Soft Skills',
          rating: 4.9,
          students: 2100,
          thumbnail: '/assets/course-comm.jpg',
          enrolled: true
        },
        {
          id: 4,
          title: 'Data Analytics with Python',
          description: 'Learn data analysis and visualization using Python',
          instructor: 'Sarah Williams',
          duration: '15 hours',
          level: 'Intermediate',
          category: 'Technical',
          rating: 4.7,
          students: 1650,
          thumbnail: '/assets/course-python.jpg',
          enrolled: false
        },
        {
          id: 5,
          title: 'Leadership & Team Building',
          description: 'Develop essential leadership and team management skills',
          instructor: 'Robert Brown',
          duration: '10 hours',
          level: 'Advanced',
          category: 'Management',
          rating: 4.8,
          students: 980,
          thumbnail: '/assets/course-leadership.jpg',
          enrolled: false
        },
        {
          id: 6,
          title: 'Time Management Mastery',
          description: 'Master productivity and time management techniques',
          instructor: 'Emily Davis',
          duration: '5 hours',
          level: 'Beginner',
          category: 'Soft Skills',
          rating: 4.5,
          students: 1420,
          thumbnail: '/assets/course-time.jpg',
          enrolled: false
        }
      ]

      setCourses(mockCourses)
      setFilteredCourses(mockCourses)
    } catch (error) {
      console.error('Error fetching courses:', error)
      toast.error('Failed to load courses')
    } finally {
      setLoading(false)
    }
  }

  const filterCourses = () => {
    let filtered = courses

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(course =>
        course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.description.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(course => course.category === categoryFilter)
    }

    // Level filter
    if (levelFilter !== 'all') {
      filtered = filtered.filter(course => course.level === levelFilter)
    }

    setFilteredCourses(filtered)
  }

  const handleEnroll = async (courseId) => {
    try {
      toast.success('Enrolled successfully!')
      // Update the courses list
      setCourses(courses.map(course =>
        course.id === courseId ? { ...course, enrolled: true } : course
      ))
    } catch (error) {
      toast.error('Failed to enroll in course')
    }
  }

  const categories = ['all', 'Technical', 'Management', 'Soft Skills']
  const levels = ['all', 'Beginner', 'Intermediate', 'Advanced']

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <FaBook className="text-blue-600" />
          Course Library
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Browse and enroll in available courses
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="relative">
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder="Search courses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                startContent={<FaSearch className="text-default-400" />}
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-default-50 dark:bg-[#1E293B] shadow-none",
                }}
              />
            </div>
          </div>

          {/* Category Filter */}
          <div className="flex-1">
            <Select
              selectedKeys={[categoryFilter]}
              onSelectionChange={(keys) => setCategoryFilter(Array.from(keys)[0] || 'all')}
              startContent={<FaFilter className="text-gray-400" />}
              aria-label="Filter by category"
            >
              {categories.map(cat => (
                <SelectItem key={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </SelectItem>
              ))}
            </Select>
          </div>

          {/* Level Filter */}
          <div className="flex-1">
            <Select
              selectedKeys={[levelFilter]}
              onSelectionChange={(keys) => setLevelFilter(Array.from(keys)[0] || 'all')}
              startContent={<FaGraduationCap className="text-gray-400" />}
              aria-label="Filter by level"
            >
              {levels.map(level => (
                <SelectItem key={level}>
                  {level === 'all' ? 'All Levels' : level}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-4">
        <p className="text-sm text-gray-600">
          Showing {filteredCourses.length} of {courses.length} courses
        </p>
      </div>

      {/* Courses Grid */}
      {loading ? (
        <div className="text-center py-12">
          <Loader size="lg" className="mx-auto" />
          <p className="text-gray-600 mt-4">Loading courses...</p>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <FaBook className="text-6xl text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No courses found</p>
          <button
            onClick={() => {
              setSearchTerm('')
              setCategoryFilter('all')
              setLevelFilter('all')
            }}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map((course) => (
            <div key={course.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
              {/* Course Thumbnail */}
              <div className="h-48 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <FaBook className="text-6xl text-white opacity-50" />
              </div>

              {/* Course Info */}
              <div className="p-6">
                <div className="flex items-center justify-start mb-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    course.level === 'Beginner' ? 'bg-green-100 text-green-700' :
                    course.level === 'Intermediate' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {course.level}
                  </span>
                  <span className="text-sm text-gray-600">{course.category}</span>
                </div>

                <h3 className="text-lg font-bold text-gray-800 mb-2 line-clamp-2">
                  {course.title}
                </h3>
                <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                  {course.description}
                </p>

                <div className="flex items-center text-sm text-gray-600 mb-2">
                  <FaUsers className="mr-2" />
                  <span>{course.students.toLocaleString()} students</span>
                </div>

                <div className="flex items-center text-sm text-gray-600 mb-2">
                  <FaClock className="mr-2" />
                  <span>{course.duration}</span>
                </div>

                <div className="flex items-center text-sm text-gray-600 mb-4">
                  <FaStar className="mr-2 text-yellow-400" />
                  <span>{course.rating} / 5.0</span>
                </div>

                <p className="text-sm text-gray-600 mb-4">
                  Instructor: <span className="font-medium">{course.instructor}</span>
                </p>

                {course.enrolled ? (
                  <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                    <FaPlay />
                    Continue Learning
                  </button>
                ) : (
                  <button
                    onClick={() => handleEnroll(course.id)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Enroll Now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
