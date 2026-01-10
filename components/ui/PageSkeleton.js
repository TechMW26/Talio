'use client'

import Loader from './Loader'

/**
 * PageSkeleton - A lightweight skeleton component for instant page loading
 * Shows immediately while data is being fetched
 * 
 * @param {Object} props
 * @param {string} props.variant - Skeleton variant: 'default' | 'table' | 'cards' | 'form' | 'dashboard'
 * @param {string} props.title - Optional page title to show
 * @param {boolean} props.showLoader - Whether to show the Talio logo loader (default: true)
 * @param {string} props.message - Optional loading message
 */
export default function PageSkeleton({ 
  variant = 'default', 
  title = '', 
  showLoader = true,
  message = ''
}) {
  return (
    <div className="min-h-[400px] w-full animate-fade-in">
      {/* Page Header Skeleton */}
      {title && (
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-800">{title}</h1>
        </div>
      )}
      
      {/* Centered Loader */}
      {showLoader && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader size="lg" />
          {message && (
            <p className="mt-4 text-sm text-gray-500 animate-pulse">{message}</p>
          )}
        </div>
      )}
      
      {/* Skeleton Content based on variant */}
      {variant === 'table' && <TableSkeleton />}
      {variant === 'cards' && <CardsSkeleton />}
      {variant === 'form' && <FormSkeleton />}
      {variant === 'dashboard' && <DashboardSkeleton />}
      {variant === 'default' && !showLoader && <DefaultSkeleton />}
    </div>
  )
}

/**
 * Table skeleton - for list/table pages
 */
function TableSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-4">
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
      </div>
      {/* Table Rows */}
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="px-4 py-4 border-b border-gray-50 flex items-center gap-4">
          <div className="h-10 w-10 bg-gray-200 rounded-full animate-pulse"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-3 w-32 bg-gray-100 rounded animate-pulse"></div>
          </div>
          <div className="h-8 w-20 bg-gray-200 rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  )
}

/**
 * Cards skeleton - for grid/card layouts
 */
function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
          <div className="h-4 w-3/4 bg-gray-200 rounded mb-3"></div>
          <div className="h-3 w-full bg-gray-100 rounded mb-2"></div>
          <div className="h-3 w-2/3 bg-gray-100 rounded mb-4"></div>
          <div className="flex justify-between items-center">
            <div className="h-6 w-16 bg-gray-200 rounded"></div>
            <div className="h-8 w-8 bg-gray-200 rounded-full"></div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Form skeleton - for form pages
 */
function FormSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mt-4 max-w-2xl">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="mb-6 animate-pulse">
          <div className="h-4 w-24 bg-gray-200 rounded mb-2"></div>
          <div className="h-10 w-full bg-gray-100 rounded"></div>
        </div>
      ))}
      <div className="flex gap-3 mt-8">
        <div className="h-10 w-24 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-10 w-20 bg-gray-100 rounded animate-pulse"></div>
      </div>
    </div>
  )
}

/**
 * Dashboard skeleton - for dashboard/overview pages
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-6 mt-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-200 rounded mb-2"></div>
            <div className="h-8 w-24 bg-gray-100 rounded"></div>
          </div>
        ))}
      </div>
      {/* Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-4 h-48 animate-pulse">
            <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-100 rounded"></div>
              <div className="h-3 w-5/6 bg-gray-100 rounded"></div>
              <div className="h-3 w-4/6 bg-gray-100 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Default skeleton - basic content placeholder
 */
function DefaultSkeleton() {
  return (
    <div className="space-y-4 mt-4 animate-pulse">
      <div className="h-6 w-48 bg-gray-200 rounded"></div>
      <div className="h-4 w-full bg-gray-100 rounded"></div>
      <div className="h-4 w-5/6 bg-gray-100 rounded"></div>
      <div className="h-4 w-4/6 bg-gray-100 rounded"></div>
    </div>
  )
}

/**
 * FullPageLoader - Centered loader for full page transitions
 * Use this when navigating between pages
 */
export function FullPageLoader({ message = 'Loading...' }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9998]" style={{ backgroundColor: 'rgba(255,255,255,0.6)' }}>
      <div className="flex flex-col items-center">
        <Loader size="xl" />
        {message && (
          <p className="mt-4 text-gray-600 animate-pulse">{message}</p>
        )}
      </div>
    </div>
  )
}

/**
 * InlineLoader - Small inline loader for buttons/actions
 */
export function InlineLoader({ size = 'sm', className = '' }) {
  return <Loader size={size} className={className} />
}
