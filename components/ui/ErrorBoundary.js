'use client'

import { Component } from 'react'
import { Button } from '@heroui/react'

/**
 * ErrorBoundaryWithRetry - Catches errors and offers retry
 * 
 * Wraps components to catch rendering errors and display
 * a user-friendly error state with retry capability.
 * 
 * Usage:
 *   <ErrorBoundaryWithRetry>
 *     <YourComponent />
 *   </ErrorBoundaryWithRetry>
 */
export class ErrorBoundaryWithRetry extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, retry: this.handleRetry })
      }

      return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-default-900 mb-1">Something went wrong</h3>
          <p className="text-sm text-default-500 text-center max-w-sm mb-4">
            {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <Button color="primary" variant="flat" onPress={this.handleRetry}>
            Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * DataErrorState - Display error state for failed data fetches
 * Use this inline within components when data loading fails.
 * 
 * @param {Object} props
 * @param {string} props.message - Error message
 * @param {function} props.onRetry - Retry handler
 * @param {string} props.title - Error title
 * @param {string} props.className - Additional classes
 */
export function DataErrorState({
  message = 'Failed to load data',
  onRetry,
  title = 'Error loading data',
  className = '',
}) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}>
      <div className="w-14 h-14 rounded-full bg-danger-50 flex items-center justify-center mb-3">
        <svg className="w-7 h-7 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-default-800 mb-1">{title}</h3>
      <p className="text-sm text-default-500 text-center max-w-xs mb-4">{message}</p>
      {onRetry && (
        <Button size="sm" color="primary" variant="flat" onPress={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

/**
 * NetworkErrorState - Display error for network-level failures
 */
export function NetworkErrorState({ onRetry, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}>
      <div className="w-14 h-14 rounded-full bg-warning-50 flex items-center justify-center mb-3">
        <svg className="w-7 h-7 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728m12.728 0L5.636 18.364M12 9v4m0 4h.01" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-default-800 mb-1">Connection Error</h3>
      <p className="text-sm text-default-500 text-center max-w-xs mb-4">
        Unable to connect to the server. Please check your internet connection and try again.
      </p>
      {onRetry && (
        <Button size="sm" color="primary" variant="flat" onPress={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export default ErrorBoundaryWithRetry
