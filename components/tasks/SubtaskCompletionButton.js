import { FaCheck, FaClock, FaSpinner } from 'react-icons/fa'

export default function SubtaskCompletionButton({
  completed = false,
  pendingAcceptance = false,
  disabled = false,
  loading = false,
  onClick,
  actionLabel = 'Mark as Complete',
  completedLabel = 'Completed',
  pendingLabel = 'Pending Review',
  disabledLabel = 'Accept task first',
  className = '',
  size = 'sm'
}) {
  const paddingClass = size === 'xs'
    ? 'px-2.5 py-1 text-xs'
    : 'px-3.5 py-1.5 text-xs sm:text-sm'

  const baseClassName = `inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors ${paddingClass}`

  if (loading) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClassName} border border-emerald-200 bg-emerald-50 text-emerald-700 ${className}`}
      >
        <FaSpinner className="animate-spin" />
        <span>Updating...</span>
      </button>
    )
  }

  if (pendingAcceptance) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClassName} border border-amber-200 bg-amber-100 text-amber-700 ${className}`}
      >
        <FaClock className="text-xs" />
        <span>{pendingLabel}</span>
      </button>
    )
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClassName} border border-gray-200 bg-gray-100 text-gray-400 ${className}`}
      >
        <FaCheck className="text-xs opacity-60" />
        <span>{disabledLabel}</span>
      </button>
    )
  }

  const isCompleted = completed
  const buttonClassName = isCompleted
    ? 'border border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
    : 'bg-emerald-600 text-white hover:bg-emerald-700'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClassName} ${buttonClassName} ${className}`}
      title={isCompleted ? 'Click to reopen subtask' : actionLabel}
    >
      <FaCheck className="text-xs" />
      <span>{isCompleted ? completedLabel : actionLabel}</span>
    </button>
  )
}