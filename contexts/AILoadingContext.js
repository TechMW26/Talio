'use client'

import { createContext, useContext, useState, useCallback } from 'react'

const AILoadingContext = createContext()

/**
 * Global AI Loading State Provider
 * 
 * Use this context to trigger a beautiful full-screen AI animation
 * whenever AI APIs are being called throughout the application.
 */
export function AILoadingProvider({ children }) {
  const [isAILoading, setIsAILoading] = useState(false)
  const [aiMessage, setAIMessage] = useState('MIRA is thinking...')

  /**
   * Start AI loading animation
   * @param {string} message - Custom message to display (optional)
   */
  const startAILoading = useCallback((message = 'MIRA is thinking...') => {
    setAIMessage(message)
    setIsAILoading(true)
  }, [])

  /**
   * Stop AI loading animation
   */
  const stopAILoading = useCallback(() => {
    setIsAILoading(false)
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
      withAILoading
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
