'use client'

import { Button, Spinner } from '@heroui/react'
import { cn } from '@/utils/cn'

/**
 * LoadingButton - Universal button with built-in loading state
 * 
 * Features:
 * - Disables immediately on click
 * - Shows spinner inside button
 * - Changes label to loadingText during processing
 * - Prevents double submission
 * - Re-enables on completion
 * - Supports all HeroUI Button props
 * 
 * @param {Object} props
 * @param {boolean} props.isLoading - Whether the button is in loading state
 * @param {string} props.loadingText - Text to show during loading (default: 'Processing...')
 * @param {React.ReactNode} props.children - Button content
 * @param {function} props.onPress - Click handler (HeroUI convention)
 * @param {function} props.onClick - Click handler (standard convention)
 * @param {string} props.variant - Button variant
 * @param {string} props.color - Button color
 * @param {string} props.size - Button size
 * @param {boolean} props.fullWidth - Full width button
 * @param {string} props.className - Additional classes
 * @param {React.ReactNode} props.startContent - Content before label
 * @param {React.ReactNode} props.endContent - Content after label
 */
export default function LoadingButton({
  children,
  isLoading = false,
  loadingText = 'Processing...',
  onPress,
  onClick,
  variant = 'solid',
  color = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  startContent,
  endContent,
  disabled,
  isDisabled,
  type = 'button',
  ...props
}) {
  const isButtonDisabled = isLoading || disabled || isDisabled

  const handlePress = (e) => {
    if (isLoading) return
    onPress?.(e)
    onClick?.(e)
  }

  return (
    <Button
      type={type}
      variant={variant}
      color={color}
      size={size}
      fullWidth={fullWidth}
      isDisabled={isButtonDisabled}
      onPress={handlePress}
      className={cn(
        'font-medium transition-all duration-200 relative',
        isLoading && 'cursor-not-allowed opacity-80',
        className
      )}
      startContent={isLoading ? <Spinner size="sm" color="current" /> : startContent}
      endContent={!isLoading ? endContent : undefined}
      {...props}
    >
      {isLoading ? loadingText : children}
    </Button>
  )
}

/**
 * SubmitButton - LoadingButton specifically for form submissions
 * Automatically handles form submit behavior
 */
export function SubmitButton({
  children = 'Save',
  loadingText = 'Saving...',
  isLoading = false,
  ...props
}) {
  return (
    <LoadingButton
      type="submit"
      isLoading={isLoading}
      loadingText={loadingText}
      color="primary"
      {...props}
    >
      {children}
    </LoadingButton>
  )
}

/**
 * DeleteButton - LoadingButton styled for delete actions
 */
export function DeleteButton({
  children = 'Delete',
  loadingText = 'Deleting...',
  isLoading = false,
  ...props
}) {
  return (
    <LoadingButton
      isLoading={isLoading}
      loadingText={loadingText}
      color="danger"
      variant="flat"
      {...props}
    >
      {children}
    </LoadingButton>
  )
}

/**
 * ApproveButton - LoadingButton for approve actions
 */
export function ApproveButton({
  children = 'Approve',
  loadingText = 'Approving...',
  isLoading = false,
  ...props
}) {
  return (
    <LoadingButton
      isLoading={isLoading}
      loadingText={loadingText}
      color="success"
      {...props}
    >
      {children}
    </LoadingButton>
  )
}

/**
 * RejectButton - LoadingButton for reject actions
 */
export function RejectButton({
  children = 'Reject',
  loadingText = 'Rejecting...',
  isLoading = false,
  ...props
}) {
  return (
    <LoadingButton
      isLoading={isLoading}
      loadingText={loadingText}
      color="danger"
      {...props}
    >
      {children}
    </LoadingButton>
  )
}
