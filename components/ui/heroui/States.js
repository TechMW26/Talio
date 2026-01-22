'use client'

import { cn } from '@/utils/cn'
import { PrimaryButton, SecondaryButton } from './Button'

/**
 * Empty State Component
 * For displaying when there's no data
 */
export function EmptyState({
  icon,
  title = 'No data found',
  description,
  action,
  actionLabel,
  onAction,
  variant = 'default', // 'default' | 'compact' | 'large'
  className,
}) {
  const sizeStyles = {
    compact: 'py-6',
    default: 'py-12',
    large: 'py-20',
  }

  const iconSizes = {
    compact: 'w-12 h-12',
    default: 'w-16 h-16',
    large: 'w-24 h-24',
  }

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      sizeStyles[variant],
      className
    )}>
      {icon ? (
        <div className={cn(
          'rounded-full bg-default-100 flex items-center justify-center mb-4',
          iconSizes[variant]
        )}>
          {typeof icon === 'function' ? (
            <icon className="w-1/2 h-1/2 text-default-400" />
          ) : (
            icon
          )}
        </div>
      ) : (
        <div className={cn(
          'rounded-full bg-default-100 flex items-center justify-center mb-4',
          iconSizes[variant]
        )}>
          <svg 
            className="w-1/2 h-1/2 text-default-400" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" 
            />
          </svg>
        </div>
      )}
      <h3 className="text-lg font-semibold text-default-900 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-default-500 max-w-sm mb-4">
          {description}
        </p>
      )}
      {(action || onAction) && (
        <PrimaryButton size="sm" onPress={onAction}>
          {actionLabel || action}
        </PrimaryButton>
      )}
    </div>
  )
}

/**
 * No Results State
 * For search with no results
 */
export function NoResults({
  query,
  onClear,
  className,
}) {
  return (
    <EmptyState
      className={className}
      icon={
        <svg className="w-8 h-8 text-default-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      }
      title="No results found"
      description={query 
        ? `We couldn't find any results for "${query}". Try adjusting your search.`
        : 'Try adjusting your filters or search terms.'
      }
      actionLabel="Clear search"
      onAction={onClear}
    />
  )
}

/**
 * Error State Component
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We encountered an error. Please try again.',
  onRetry,
  retryLabel = 'Try again',
  variant = 'default', // 'default' | 'compact' | 'large'
  className,
}) {
  const sizeStyles = {
    compact: 'py-6',
    default: 'py-12',
    large: 'py-20',
  }

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      sizeStyles[variant],
      className
    )}>
      <div className="w-16 h-16 rounded-full bg-danger-100 flex items-center justify-center mb-4">
        <svg 
          className="w-8 h-8 text-danger-600" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-default-900 mb-1">
        {title}
      </h3>
      <p className="text-sm text-default-500 max-w-sm mb-4">
        {description}
      </p>
      {onRetry && (
        <PrimaryButton size="sm" onPress={onRetry}>
          {retryLabel}
        </PrimaryButton>
      )}
    </div>
  )
}

/**
 * Network Error State
 */
export function NetworkError({ onRetry, className }) {
  return (
    <ErrorState
      className={className}
      title="Connection Error"
      description="Unable to connect to the server. Please check your internet connection and try again."
      onRetry={onRetry}
    />
  )
}

/**
 * Permission Denied State
 */
export function PermissionDenied({ 
  description = "You don't have permission to access this resource.",
  className,
}) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center py-12',
      className
    )}>
      <div className="w-16 h-16 rounded-full bg-warning-100 flex items-center justify-center mb-4">
        <svg 
          className="w-8 h-8 text-warning-600" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-default-900 mb-1">
        Access Denied
      </h3>
      <p className="text-sm text-default-500 max-w-sm">
        {description}
      </p>
    </div>
  )
}

/**
 * Coming Soon State
 */
export function ComingSoon({ 
  feature,
  className,
}) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center py-12',
      className
    )}>
      <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center mb-4">
        <svg 
          className="w-8 h-8 text-primary-600" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" 
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-default-900 mb-1">
        Coming Soon
      </h3>
      <p className="text-sm text-default-500 max-w-sm">
        {feature 
          ? `${feature} is currently under development. Check back soon!`
          : 'This feature is currently under development. Check back soon!'
        }
      </p>
    </div>
  )
}

export default {
  EmptyState,
  NoResults,
  ErrorState,
  NetworkError,
  PermissionDenied,
  ComingSoon,
}
