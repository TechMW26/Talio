'use client'

import { 
  Input as HeroInput, 
  Textarea as HeroTextarea,
  Select as HeroSelect,
  SelectItem as HeroSelectItem,
  Checkbox as HeroCheckbox,
  Switch as HeroSwitch,
  Radio as HeroRadio,
  RadioGroup as HeroRadioGroup,
} from '@heroui/react'
import { cn } from '@/utils/cn'

/**
 * HRMS Input Component
 * Standardized text input with consistent styling
 */
export function HRMSInput({ 
  className,
  variant = 'bordered',
  size = 'md',
  labelPlacement = 'outside',
  ...props 
}) {
  return (
    <HeroInput
      className={cn('w-full', className)}
      variant={variant}
      size={size}
      labelPlacement={labelPlacement}
      classNames={{
        label: 'text-default-600 font-medium text-sm',
        input: 'text-default-900',
        inputWrapper: [
          'bg-default-50',
          'hover:bg-default-100',
          'group-data-[focused=true]:bg-default-50',
          'border-default-200',
          'hover:border-primary-300',
        ],
        description: 'text-default-400 text-xs',
        errorMessage: 'text-danger-500 text-xs',
      }}
      {...props}
    />
  )
}

/**
 * HRMS Textarea Component
 */
export function HRMSTextarea({ 
  className,
  variant = 'bordered',
  labelPlacement = 'outside',
  minRows = 3,
  ...props 
}) {
  return (
    <HeroTextarea
      className={cn('w-full', className)}
      variant={variant}
      labelPlacement={labelPlacement}
      minRows={minRows}
      classNames={{
        label: 'text-default-600 font-medium text-sm',
        input: 'text-default-900',
        inputWrapper: [
          'bg-default-50',
          'hover:bg-default-100',
          'border-default-200',
        ],
      }}
      {...props}
    />
  )
}

/**
 * HRMS Select Component
 */
export function HRMSSelect({ 
  children,
  className,
  variant = 'bordered',
  labelPlacement = 'outside',
  ...props 
}) {
  return (
    <HeroSelect
      className={cn('w-full', className)}
      variant={variant}
      labelPlacement={labelPlacement}
      classNames={{
        label: 'text-default-600 font-medium text-sm',
        trigger: [
          'bg-default-50',
          'hover:bg-default-100',
          'border-default-200',
        ],
        value: 'text-default-900',
      }}
      {...props}
    >
      {children}
    </HeroSelect>
  )
}

/**
 * Re-export SelectItem for convenience
 */
export const HRMSSelectItem = HeroSelectItem

/**
 * HRMS Checkbox Component
 */
export function HRMSCheckbox({ 
  children,
  className,
  ...props 
}) {
  return (
    <HeroCheckbox
      className={cn('', className)}
      classNames={{
        label: 'text-default-700 text-sm',
        wrapper: 'before:border-default-300',
      }}
      {...props}
    >
      {children}
    </HeroCheckbox>
  )
}

/**
 * HRMS Switch Component
 */
export function HRMSSwitch({ 
  children,
  className,
  ...props 
}) {
  return (
    <HeroSwitch
      className={cn('', className)}
      classNames={{
        label: 'text-default-700 text-sm',
      }}
      {...props}
    >
      {children}
    </HeroSwitch>
  )
}

/**
 * HRMS Radio Component
 */
export function HRMSRadio({ 
  children,
  className,
  ...props 
}) {
  return (
    <HeroRadio
      className={cn('', className)}
      classNames={{
        label: 'text-default-700 text-sm',
      }}
      {...props}
    >
      {children}
    </HeroRadio>
  )
}

/**
 * HRMS Radio Group Component
 */
export function HRMSRadioGroup({ 
  children,
  className,
  ...props 
}) {
  return (
    <HeroRadioGroup
      className={cn('', className)}
      classNames={{
        label: 'text-default-600 font-medium text-sm',
      }}
      {...props}
    >
      {children}
    </HeroRadioGroup>
  )
}

/**
 * Search Input with icon
 */
export function SearchInput({ 
  className,
  placeholder = 'Search...',
  ...props 
}) {
  return (
    <HRMSInput
      className={className}
      placeholder={placeholder}
      type="search"
      startContent={
        <svg 
          className="w-4 h-4 text-default-400" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
          />
        </svg>
      }
      {...props}
    />
  )
}

export default {
  HRMSInput,
  HRMSTextarea,
  HRMSSelect,
  HRMSSelectItem,
  HRMSCheckbox,
  HRMSSwitch,
  HRMSRadio,
  HRMSRadioGroup,
  SearchInput,
}
