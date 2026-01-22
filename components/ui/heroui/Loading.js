'use client'

import { Spinner, Skeleton, Progress, CircularProgress } from '@heroui/react'
import { cn } from '@/utils/cn'

/**
 * Full Page Loader
 * Centered loading spinner for page transitions
 */
export function PageLoader({ message = 'Loading...', className }) {
  return (
    <div className={cn(
      'fixed inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-50',
      className
    )}>
      <Spinner size="lg" color="primary" />
      {message && (
        <p className="mt-4 text-default-600 text-sm font-medium animate-pulse">
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * Section Loader
 * Loading state for sections/cards
 */
export function SectionLoader({ className }) {
  return (
    <div className={cn(
      'flex items-center justify-center py-12',
      className
    )}>
      <Spinner size="md" color="primary" />
    </div>
  )
}

/**
 * Inline Loader
 * Small loading indicator
 */
export function InlineLoader({ size = 'sm', className }) {
  return (
    <Spinner size={size} color="primary" className={className} />
  )
}

/**
 * Button Loader
 * Loading state for buttons
 */
export function ButtonLoader({ size = 'sm' }) {
  return <Spinner size={size} color="current" />
}

/**
 * Card Skeleton
 * Loading placeholder for cards
 */
export function CardSkeleton({ className }) {
  return (
    <div className={cn(
      'bg-content1 rounded-xl shadow-md p-4 space-y-3',
      className
    )}>
      <Skeleton className="h-4 w-3/4 rounded-lg" />
      <Skeleton className="h-4 w-1/2 rounded-lg" />
      <div className="pt-2">
        <Skeleton className="h-20 rounded-lg" />
      </div>
    </div>
  )
}

/**
 * Table Skeleton
 * Loading placeholder for tables
 */
export function TableSkeleton({ rows = 5, columns = 4, className }) {
  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex gap-4 p-4 bg-default-50 rounded-t-xl">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1 rounded-lg" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 p-4 border-b border-default-100">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton 
              key={colIndex} 
              className="h-4 flex-1 rounded-lg" 
              style={{ opacity: 1 - (rowIndex * 0.1) }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * KPI Card Skeleton
 * Loading placeholder for KPI cards
 */
export function KPISkeleton({ className }) {
  return (
    <div className={cn(
      'bg-content1 rounded-xl shadow-md p-4',
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-3 w-16 rounded-lg" />
        </div>
        <Skeleton className="h-12 w-12 rounded-xl" />
      </div>
    </div>
  )
}

/**
 * Dashboard Skeleton
 * Full dashboard loading placeholder
 */
export function DashboardSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KPISkeleton key={i} />
        ))}
      </div>

      {/* Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  )
}

/**
 * List Skeleton
 * Loading placeholder for lists
 */
export function ListSkeleton({ items = 4, className }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4 rounded-lg" />
            <Skeleton className="h-3 w-1/2 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Form Skeleton
 * Loading placeholder for forms
 */
export function FormSkeleton({ fields = 4, className }) {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24 rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <div className="flex gap-3 pt-4">
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
    </div>
  )
}

/**
 * Progress Bar
 */
export function ProgressBar({
  value,
  maxValue = 100,
  color = 'primary',
  size = 'md',
  showValueLabel = false,
  label,
  className,
  ...props
}) {
  return (
    <Progress
      value={value}
      maxValue={maxValue}
      color={color}
      size={size}
      showValueLabel={showValueLabel}
      label={label}
      className={className}
      classNames={{
        track: 'bg-default-100',
        label: 'text-sm font-medium text-default-700',
        value: 'text-sm text-default-500',
      }}
      {...props}
    />
  )
}

/**
 * Circular Progress
 */
export function CircularProgressBar({
  value,
  maxValue = 100,
  color = 'primary',
  size = 'md',
  showValueLabel = true,
  label,
  className,
  ...props
}) {
  return (
    <CircularProgress
      value={value}
      maxValue={maxValue}
      color={color}
      size={size}
      showValueLabel={showValueLabel}
      label={label}
      className={className}
      classNames={{
        svg: 'w-full h-full',
        indicator: 'stroke-primary',
        track: 'stroke-default-100',
        value: 'text-lg font-semibold text-default-900',
        label: 'text-sm text-default-500',
      }}
      {...props}
    />
  )
}

export default {
  PageLoader,
  SectionLoader,
  InlineLoader,
  ButtonLoader,
  CardSkeleton,
  TableSkeleton,
  KPISkeleton,
  DashboardSkeleton,
  ListSkeleton,
  FormSkeleton,
  ProgressBar,
  CircularProgressBar,
}
