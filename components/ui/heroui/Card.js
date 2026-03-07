'use client'

import { Card as HeroCard, CardHeader as HeroCardHeader, CardBody as HeroCardBody, CardFooter as HeroCardFooter } from '@heroui/react'
import { cn } from '@/utils/cn'

/**
 * HRMS Card Component
 * A styled card component for consistent UI across the application
 */
export function HRMSCard({ 
  children, 
  className, 
  variant = 'elevated',
  isPressable = false,
  isHoverable = true,
  ...props 
}) {
  const variantStyles = {
    elevated: 'shadow-md hover:shadow-lg',
    flat: 'shadow-none border border-default-200',
    bordered: 'shadow-sm border-2 border-default-100',
    gradient: 'bg-white dark:bg-default-100',
  }

  return (
    <HeroCard
      className={cn(
        'bg-content1 transition-all duration-200',
        variantStyles[variant],
        className
      )}
      isPressable={isPressable}
      isHoverable={isHoverable}
      {...props}
    >
      {children}
    </HeroCard>
  )
}

/**
 * HRMS Card Header
 */
export function HRMSCardHeader({ children, className, ...props }) {
  return (
    <HeroCardHeader
      className={cn('flex items-center gap-3 px-4 py-3', className)}
      {...props}
    >
      {children}
    </HeroCardHeader>
  )
}

/**
 * HRMS Card Body
 */
export function HRMSCardBody({ children, className, ...props }) {
  return (
    <HeroCardBody
      className={cn('px-4 py-3', className)}
      {...props}
    >
      {children}
    </HeroCardBody>
  )
}

/**
 * HRMS Card Footer
 */
export function HRMSCardFooter({ children, className, ...props }) {
  return (
    <HeroCardFooter
      className={cn('px-4 py-3 bg-default-50', className)}
      {...props}
    >
      {children}
    </HeroCardFooter>
  )
}

/**
 * HRMS KPI Card
 * Specialized card for displaying KPI metrics
 * @param {React.ComponentType|React.ReactNode} icon - Either a component reference (FaIcon) or JSX element (<FaIcon />)
 */
export function KPICard({ 
  title, 
  value, 
  subtitle,
  icon,
  trend,
  trendValue,
  color = 'primary',
  className,
  onClick,
  ...props 
}) {
  const colorStyles = {
    primary: 'from-primary-500 to-primary-600',
    secondary: 'from-secondary-500 to-secondary-600',
    success: 'from-success-500 to-success-600',
    warning: 'from-warning-500 to-warning-600',
    danger: 'from-danger-500 to-danger-600',
  }

  const iconBgStyles = {
    primary: 'bg-primary-100 text-primary-600',
    secondary: 'bg-secondary-100 text-secondary-600',
    success: 'bg-success-100 text-success-600',
    warning: 'bg-warning-100 text-warning-600',
    danger: 'bg-danger-100 text-danger-600',
  }

  // Render icon - handles both component references and JSX elements
  const renderIcon = () => {
    if (!icon) return null
    
    // Check if icon is a React element (JSX)
    if (typeof icon === 'object' && icon.$$typeof) {
      return icon
    }
    
    // Otherwise, treat as a component reference
    const IconComponent = icon
    return <IconComponent className="w-6 h-6" />
  }

  return (
    <HRMSCard 
      className={cn('overflow-hidden', className)} 
      isPressable={!!onClick}
      onClick={onClick}
      {...props}
    >
      <HRMSCardBody className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-default-500 mb-1">
              {title}
            </p>
            <p className="text-2xl font-bold text-default-900">
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-default-400 mt-1">
                {subtitle}
              </p>
            )}
            {trend && (
              <div className={cn(
                'flex items-center gap-1 mt-2 text-xs font-medium',
                trend === 'up' ? 'text-success-600' : 'text-danger-600'
              )}>
                <span>{trend === 'up' ? '↑' : '↓'}</span>
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          {icon && (
            <div className={cn(
              'p-3 rounded-xl',
              iconBgStyles[color]
            )}>
              {renderIcon()}
            </div>
          )}
        </div>
      </HRMSCardBody>
    </HRMSCard>
  )
}

/**
 * HRMS Widget Card
 * Card with header title and optional actions
 */
export function WidgetCard({ 
  title, 
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  isLoading = false,
  isEmpty = false,
  emptyMessage = 'No data available',
  ...props 
}) {
  return (
    <HRMSCard className={cn('h-full', className)} {...props}>
      <HRMSCardHeader className="border-b border-default-100">
        <div className="flex items-center gap-3 flex-1">
          {Icon && (
            <div className="p-2 rounded-lg bg-primary-100">
              <Icon className="w-5 h-5 text-primary-600" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-default-900">
              {title}
            </h3>
            {subtitle && (
              <p className="text-sm text-default-500">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </HRMSCardHeader>
      <HRMSCardBody className={cn('p-4', bodyClassName)}>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center mb-3">
              <svg className="w-8 h-8 text-default-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-default-500 text-sm">{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </HRMSCardBody>
    </HRMSCard>
  )
}

export default {
  HRMSCard,
  HRMSCardHeader,
  HRMSCardBody,
  HRMSCardFooter,
  KPICard,
  WidgetCard,
}
