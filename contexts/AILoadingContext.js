'use client'

import { createContext, useContext, useState, useCallback } from 'react'

const AILoadingContext = createContext()

/**
 * Global AI Loading State Provider
 * 
 * Use this context to trigger a beautiful full-screen AI animation
 * whenever AI APIs are being called throughout the application.
 * 
 * The animation flow:
 * 1. isAILoading becomes true
 * 2. MiraTransitionOverlay captures particles from header MiraSphere
 * 3. Particles scatter across page, oscillate, then converge to center
 * 4. transitionComplete becomes true - blur starts
 * 5. GlobalAILoadingOverlay takes over with shape morphing animation
 */
export function AILoadingProvider({ children }) {
  const [isAILoading, setIsAILoading] = useState(false)
  const [aiMessage, setAIMessage] = useState('MIRA is thinking...')
  const [transitionComplete, setTransitionComplete] = useState(false)

  /**
   * Start AI loading animation
   * @param {string} message - Custom message to display (optional)
   */
  const startAILoading = useCallback((message = 'MIRA is thinking...') => {
    setAIMessage(message)
    setTransitionComplete(false) // Reset transition state
    setIsAILoading(true)
  }, [])

  /**
   * Stop AI loading animation
   */
  const stopAILoading = useCallback(() => {
    setIsAILoading(false)
    setTransitionComplete(false)
    setAIMessage('MIRA is thinking...')
  }, [])

  /**
   * Wrapper for async functions that shows AI loading animation
   * @param {Function} asyncFn - Async function to execute
   * @param {string} message - Loading message to display
   * @returns {Promise<any>} - Result of the async function
   */
  const withAILoading = useCallback(async (asyncFn, message = 'MIRA is thinking...') => {
    try {
      startAILoading(message)
      const result = await asyncFn()
      return result
    } finally {
      stopAILoading()
    }
  }, [startAILoading, stopAILoading])

  return (
    <AILoadingContext.Provider value={{
      isAILoading,
      aiMessage,
      startAILoading,
      stopAILoading,
      withAILoading,
      // Transition coordination
      transitionComplete,
      _setTransitionComplete: setTransitionComplete // Internal use by MiraTransitionOverlay
    }}>
      {children}
    </AILoadingContext.Provider>
  )
}

export function useAILoading() {
  const context = useContext(AILoadingContext)
  if (!context) {
    throw new Error('useAILoading must be used within an AILoadingProvider')
  }
  return context
}

// Export for direct imports
export default AILoadingContext
