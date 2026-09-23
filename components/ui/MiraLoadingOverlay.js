'use client'

import MiraPet from '@/components/ui/MiraPet'

export default function MiraLoadingOverlay({
  isLoading, message = 'MIRA is thinking...', className = '', fullScreen = false, size = 'medium'
}) {
  if (!isLoading) return null
  const sizes = { small: 48, medium: 72, large: 96 }
  return (
    <div role="status" className={fullScreen
      ? 'fixed inset-0 z-50 flex flex-col items-center justify-center modal-overlay-dark'
      : `absolute inset-0 z-10 flex flex-col items-center justify-center modal-overlay-bg ${className}`}>
      <div className="p-6"><MiraPet size={sizes[size] || 72} isThinking /></div>
      {message && <p className="text-sm font-medium text-foreground">{message}</p>}
    </div>
  )
}
