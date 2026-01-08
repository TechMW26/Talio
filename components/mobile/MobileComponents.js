'use client';

import Loader from '@/components/ui/Loader';

/**
 * Mobile-optimized page wrapper component
 * Provides consistent mobile-first layout structure
 */
export default function MobilePageWrapper({ 
  children, 
  title, 
  subtitle,
  actions,
  className = '',
  noPadding = false 
}) {
  return (
    <div className={`min-h-full ${className}`}>
      {/* Page Header - Mobile Optimized */}
      {(title || actions) && (
        <div className="page-header-mobile sticky top-0 bg-white z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 border-b border-gray-200 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            {/* Title Section */}
            {title && (
              <div className="flex-1 min-w-0">
                <h1 className="page-title-mobile truncate">{title}</h1>
                {subtitle && <p className="page-subtitle-mobile">{subtitle}</p>}
              </div>
            )}
            
            {/* Action Buttons */}
            {actions && (
              <div className="flex-shrink-0">
                <div className="action-buttons-mobile">
                  {actions}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={noPadding ? '' : 'container-mobile'}>
        {children}
      </div>
    </div>
  );
}

/**
 * Mobile-optimized card component
 */
export function MobileCard({ children, className = '', noPadding = false }) {
  return (
    <div className={`card-mobile ${noPadding ? 'p-0' : ''} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Mobile-optimized stat card
 */
export function MobileStatCard({ label, value, icon: Icon, trend, color = 'blue', onClick }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  };

  return (
    <div 
      className={`stat-card-mobile ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="stat-label mb-1">{label}</p>
          <p className="stat-value">{value}</p>
          {trend && (
            <p className={`text-xs sm:text-sm mt-1 ${trend.positive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.value}
            </p>
          )}
        </div>
        {Icon && (
          <div className={`p-2 sm:p-3 rounded-lg ${colorClasses[color]}`}>
            <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Mobile-optimized grid container
 */
export function MobileGrid({ children, cols = 2, className = '' }) {
  const colClasses = {
    1: 'grid-responsive-1',
    2: 'grid-responsive-2',
    3: 'grid-responsive-3',
    4: 'grid-responsive-4',
  };

  return (
    <div className={`${colClasses[cols]} gap-responsive ${className}`}>
      {children}
    </div>
  );
}

/**
 * Mobile-optimized section
 */
export function MobileSection({ title, children, className = '', action }) {
  return (
    <div className={`mb-6 sm:mb-8 ${className}`}>
      {title && (
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Mobile-optimized empty state
 */
export function MobileEmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action,
  actionText,
  onAction 
}) {
  return (
    <div className="text-center py-8 sm:py-12">
      {Icon && (
        <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gray-100 mb-4">
          <Icon className="w-8 h-8 sm:w-10 sm:h-10 text-gray-400" />
        </div>
      )}
      <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">{title}</h3>
      {description && <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6 max-w-sm mx-auto">{description}</p>}
      {(action || onAction) && (
        <div className="flex justify-center">
          {action || (
            <button
              onClick={onAction}
              className="btn-mobile bg-blue-600 text-white hover:bg-blue-700"
            >
              {actionText || 'Take Action'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Mobile-optimized loading state
 */
export function MobileLoader({ fullScreen = false, text }) {
  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-white z-50">
        <Loader size="lg" />
        {text && <p className="mt-4 text-sm text-gray-600">{text}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 sm:py-12">
      <Loader size="md" />
      {text && <p className="mt-4 text-sm text-gray-600">{text}</p>}
    </div>
  );
}

/**
 * Mobile-optimized table wrapper with card view fallback
 */
export function MobileTable({ headers, children, cardView }) {
  if (cardView) {
    return (
      <>
        <div className="table-card-mobile">{cardView}</div>
        <div className="table-desktop">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {headers.map((header, idx) => (
                    <th
                      key={idx}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {children}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="overflow-x-auto table-mobile">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {headers.map((header, idx) => (
              <th
                key={idx}
                className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mobile-optimized modal
 */
export function MobileModal({ isOpen, onClose, title, children, footer }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-mobile-modal overflow-y-auto">
      <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 backdrop-mobile transition-opacity"
          onClick={onClose}
        />

        {/* Modal Content */}
        <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl transform transition-all w-full sm:max-w-lg sm:w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          {title && (
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 pb-safe-bottom">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
