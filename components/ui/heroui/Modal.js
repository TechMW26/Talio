'use client'

import {
  Modal as HeroModal,
  ModalContent as HeroModalContent,
  ModalHeader as HeroModalHeader,
  ModalBody as HeroModalBody,
  ModalFooter as HeroModalFooter,
  useDisclosure,
} from '@heroui/react'
import { cn } from '@/utils/cn'
import { PrimaryButton, SecondaryButton, DangerButton } from './Button'

/**
 * HRMS Modal Component
 * Standardized modal with consistent styling
 */
export function HRMSModal({
  isOpen,
  onClose,
  onOpenChange,
  title,
  children,
  size = 'md',
  scrollBehavior = 'inside',
  isDismissable = true,
  hideCloseButton = false,
  className,
  ...props
}) {
  return (
    <HeroModal
      isOpen={isOpen}
      onClose={onClose}
      onOpenChange={onOpenChange}
      size={size}
      scrollBehavior={scrollBehavior}
      isDismissable={isDismissable}
      hideCloseButton={hideCloseButton}
      classNames={{
        backdrop: 'bg-black/50 backdrop-blur-sm',
        base: 'bg-content1 shadow-xl',
        header: 'border-b border-default-100',
        body: 'py-4',
        footer: 'border-t border-default-100',
        closeButton: 'hover:bg-default-100 active:bg-default-200',
      }}
      className={className}
      {...props}
    >
      {children}
    </HeroModal>
  )
}

/**
 * Modal Content wrapper
 */
export function HRMSModalContent({ children, className }) {
  return (
    <HeroModalContent className={className}>
      {(onClose) => (
        typeof children === 'function' ? children(onClose) : children
      )}
    </HeroModalContent>
  )
}

/**
 * Modal Header
 */
export function HRMSModalHeader({ children, className }) {
  return (
    <HeroModalHeader className={cn('flex items-center gap-2 text-lg font-semibold', className)}>
      {children}
    </HeroModalHeader>
  )
}

/**
 * Modal Body
 */
export function HRMSModalBody({ children, className }) {
  return (
    <HeroModalBody className={cn('', className)}>
      {children}
    </HeroModalBody>
  )
}

/**
 * Modal Footer
 */
export function HRMSModalFooter({ children, className }) {
  return (
    <HeroModalFooter className={cn('flex justify-end gap-2', className)}>
      {children}
    </HeroModalFooter>
  )
}

/**
 * Confirmation Modal
 * Pre-built modal for confirmations
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger', // 'danger' | 'warning' | 'primary'
  isLoading = false,
}) {
  const ButtonComponent = variant === 'danger' ? DangerButton : PrimaryButton

  return (
    <HRMSModal isOpen={isOpen} onClose={onClose} size="sm">
      <HRMSModalContent>
        {(onClose) => (
          <>
            <HRMSModalHeader>
              {variant === 'danger' && (
                <div className="p-2 rounded-full bg-danger-100 mr-2">
                  <svg className="w-5 h-5 text-danger-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              )}
              {title}
            </HRMSModalHeader>
            <HRMSModalBody>
              <p className="text-default-600">{message}</p>
            </HRMSModalBody>
            <HRMSModalFooter>
              <SecondaryButton onPress={onClose} isDisabled={isLoading}>
                {cancelText}
              </SecondaryButton>
              <ButtonComponent onPress={onConfirm} isLoading={isLoading}>
                {confirmText}
              </ButtonComponent>
            </HRMSModalFooter>
          </>
        )}
      </HRMSModalContent>
    </HRMSModal>
  )
}

/**
 * Alert Modal
 * Pre-built modal for alerts/info
 */
export function AlertModal({
  isOpen,
  onClose,
  title = 'Alert',
  message,
  buttonText = 'OK',
  variant = 'info', // 'info' | 'success' | 'warning' | 'error'
}) {
  const variantStyles = {
    info: { bg: 'bg-primary-100', text: 'text-primary-600' },
    success: { bg: 'bg-success-100', text: 'text-success-600' },
    warning: { bg: 'bg-warning-100', text: 'text-warning-600' },
    error: { bg: 'bg-danger-100', text: 'text-danger-600' },
  }

  const icons = {
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }

  return (
    <HRMSModal isOpen={isOpen} onClose={onClose} size="sm">
      <HRMSModalContent>
        {(onClose) => (
          <>
            <HRMSModalHeader>
              <div className={cn('p-2 rounded-full mr-2', variantStyles[variant].bg)}>
                <span className={variantStyles[variant].text}>
                  {icons[variant]}
                </span>
              </div>
              {title}
            </HRMSModalHeader>
            <HRMSModalBody>
              <p className="text-default-600">{message}</p>
            </HRMSModalBody>
            <HRMSModalFooter>
              <PrimaryButton onPress={onClose}>
                {buttonText}
              </PrimaryButton>
            </HRMSModalFooter>
          </>
        )}
      </HRMSModalContent>
    </HRMSModal>
  )
}

// Export the useDisclosure hook for convenience
export { useDisclosure }

export default {
  HRMSModal,
  HRMSModalContent,
  HRMSModalHeader,
  HRMSModalBody,
  HRMSModalFooter,
  ConfirmModal,
  AlertModal,
  useDisclosure,
}
