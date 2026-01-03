'use client'

import { useCallback } from 'react'
import { useAILoading } from '@/contexts/AILoadingContext'

/**
 * Hook for AI API calls with automatic loading animation
 * 
 * Usage:
 * const { callAI } = useAICall()
 * const result = await callAI(
 *   () => fetch('/api/ai/generate', {...}),
 *   'MIRA is generating your content...'
 * )
 */
export function useAICall() {
  const { withAILoading, startAILoading, stopAILoading } = useAILoading()

  /**
   * Execute an AI call with loading animation
   * @param {Function} asyncFn - The async function to execute
   * @param {string} message - Loading message to display
   * @returns {Promise<any>}
   */
  const callAI = useCallback(async (asyncFn, message = 'MIRA is thinking...') => {
    return withAILoading(asyncFn, message)
  }, [withAILoading])

  /**
   * Manual control for complex scenarios
   */
  const manualControl = {
    start: startAILoading,
    stop: stopAILoading
  }

  return {
    callAI,
    manualControl,
    // Direct access to context methods
    startAILoading,
    stopAILoading,
    withAILoading
  }
}

export default useAICall
