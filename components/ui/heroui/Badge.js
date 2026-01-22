'use client'

import { Badge as HeroBadge, Chip as HeroChip, Avatar as HeroAvatar } from '@heroui/react'
import { cn } from '@/utils/cn'

/**
 * HRMS Status Badge
 * For indicating status of items (active, pending, etc.)
 */
export function StatusBadge({ 
  status, 
  variant = 'flat',
  size = 'sm',
  className,
  children,
  ...props 
}) {
  const statusStyles = {
    active: { color: 'success', label: 'Active' },
    inactive: { color: 'default', label: 'Inactive' },
    pending: { color: 'warning', label: 'Pending' },
    approved: { color: 'success', label: 'Approved' },
    rejected: { color: 'danger', label: 'Rejected' },
    completed: { color: 'success', label: 'Completed' },
    inProgress: { color: 'primary', label: 'In Progress' },
    'in-progress': { color: 'primary', label: 'In Progress' },
    cancelled: { color: 'default', label: 'Cancelled' },
    overdue: { color: 'danger', label: 'Overdue' },
    draft: { color: 'default', label: 'Draft' },
    published: { color: 'success', label: 'Published' },
    present: { color: 'success', label: 'Present' },
    absent: { color: 'danger', label: 'Absent' },
    late: { color: 'warning', label: 'Late' },
    'half-day': { color: 'warning', label: 'Half Day' },
    leave: { color: 'secondary', label: 'On Leave' },
  }

  const config = statusStyles[status?.toLowerCase()] || { color: 'default', label: status }

  return (
    <HeroChip
      variant={variant}
      color={config.color}
      size={size}
      className={cn('capitalize', className)}
      {...props}
    >
      {children || config.label}
    </HeroChip>
  )
}

/**
 * HRMS Chip
 * Generic chip component
 */
export function HRMSChip({
  children,
  variant = 'flat',
  color = 'default',
  size = 'sm',
  onClose,
  startContent,
  endContent,
  avatar,
  className,
  ...props
}) {
  return (
    <HeroChip
      variant={variant}
      color={color}
      size={size}
      onClose={onClose}
      startContent={startContent}
      endContent={endContent}
      avatar={avatar}
      className={className}
      {...props}
    >
      {children}
    </HeroChip>
  )
}

/**
 * Count Badge
 * For notification counts, etc.
 */
export function CountBadge({
  count,
  color = 'danger',
  size = 'sm',
  className,
  children,
  ...props
}) {
  if (!count || count <= 0) return children || null

  const displayCount = count > 99 ? '99+' : count

  return (
    <HeroBadge
      content={displayCount}
      color={color}
      size={size}
      className={className}
      {...props}
    >
      {children}
    </HeroBadge>
  )
}

/**
 * Priority Badge
 * For task/project priority
 */
export function PriorityBadge({ priority, className }) {
  const priorityStyles = {
    low: { color: 'success', label: 'Low' },
    medium: { color: 'warning', label: 'Medium' },
    high: { color: 'danger', label: 'High' },
    urgent: { color: 'danger', label: 'Urgent' },
    critical: { color: 'danger', label: 'Critical' },
  }

  const config = priorityStyles[priority?.toLowerCase()] || { color: 'default', label: priority }

  return (
    <HeroChip
      variant="dot"
      color={config.color}
      size="sm"
      className={cn('capitalize', className)}
    >
      {config.label}
    </HeroChip>
  )
}

/**
 * Role Badge
 * For displaying user roles
 */
export function RoleBadge({ role, className }) {
  const roleStyles = {
    admin: { color: 'danger', label: 'Admin' },
    hr: { color: 'secondary', label: 'HR' },
    manager: { color: 'primary', label: 'Manager' },
    department_head: { color: 'warning', label: 'Dept Head' },
    employee: { color: 'default', label: 'Employee' },
  }

  const config = roleStyles[role?.toLowerCase()] || { color: 'default', label: role }

  return (
    <HeroChip
      variant="flat"
      color={config.color}
      size="sm"
      className={cn('capitalize', className)}
    >
      {config.label}
    </HeroChip>
  )
}

/**
 * HRMS Avatar
 */
export function HRMSAvatar({
  src,
  name,
  size = 'md',
  color = 'primary',
  isBordered = false,
  showFallback = true,
  className,
  ...props
}) {
  const getInitials = (name) => {
    if (!name) return '?'
    const parts = name.split(' ')
    return parts.length > 1
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name[0].toUpperCase()
  }

  return (
    <HeroAvatar
      src={src}
      name={name}
      size={size}
      color={color}
      isBordered={isBordered}
      showFallback={showFallback}
      fallback={
        <span className="text-sm font-medium">
          {getInitials(name)}
        </span>
      }
      className={className}
      {...props}
    />
  )
}

export default {
  StatusBadge,
  HRMSChip,
  CountBadge,
  PriorityBadge,
  RoleBadge,
  HRMSAvatar,
}
