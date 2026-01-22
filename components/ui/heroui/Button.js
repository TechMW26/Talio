'use client'

import { Button as HeroButton } from '@heroui/react'
import { cn } from '@/utils/cn'

/**
 * HRMS Button Component
 * Standardized button with consistent styling
 */
export function HRMSButton({ 
  children, 
  className,
  variant = 'solid',
  color = 'primary',
  size = 'md',
  isLoading = false,
  startContent,
  endContent,
  ...props 
}) {
  return (
    <HeroButton
      className={cn(
        'font-medium transition-all duration-200',
        className
      )}
      variant={variant}
      color={color}
      size={size}
      isLoading={isLoading}
      startContent={startContent}
      endContent={endContent}
      {...props}
    >
      {children}
    </HeroButton>
  )
}

/**
 * Primary Action Button
 */
export function PrimaryButton({ children, className, ...props }) {
  return (
    <HRMSButton
      variant="solid"
      color="primary"
      className={cn('shadow-md hover:shadow-lg', className)}
      {...props}
    >
      {children}
    </HRMSButton>
  )
}

/**
 * Secondary Button
 */
export function SecondaryButton({ children, className, ...props }) {
  return (
    <HRMSButton
      variant="flat"
      color="default"
      className={className}
      {...props}
    >
      {children}
    </HRMSButton>
  )
}

/**
 * Danger/Delete Button
 */
export function DangerButton({ children, className, ...props }) {
  return (
    <HRMSButton
      variant="solid"
      color="danger"
      className={className}
      {...props}
    >
      {children}
    </HRMSButton>
  )
}

/**
 * Success Button
 */
export function SuccessButton({ children, className, ...props }) {
  return (
    <HRMSButton
      variant="solid"
      color="success"
      className={className}
      {...props}
    >
      {children}
    </HRMSButton>
  )
}

/**
 * Ghost/Text Button
 */
export function GhostButton({ children, className, ...props }) {
  return (
    <HRMSButton
      variant="light"
      color="default"
      className={className}
      {...props}
    >
      {children}
    </HRMSButton>
  )
}

/**
 * Icon Button
 */
export function IconButton({ icon: Icon, className, size = 'sm', children, ...props }) {
  return (
    <HRMSButton
      isIconOnly
      variant="light"
      size={size}
      className={cn('min-w-unit-8 w-8 h-8', className)}
      {...props}
    >
      {Icon ? <Icon className="w-4 h-4" /> : children}
    </HRMSButton>
  )
}

export default {
  HRMSButton,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  SuccessButton,
  GhostButton,
  IconButton,
}
