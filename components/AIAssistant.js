'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Spinner,
  Chip,
  Divider,
} from '@heroui/react'
import { FaPaperPlane, FaLightbulb, FaRobot, FaTimesCircle, FaInfoCircle, FaRedoAlt } from 'react-icons/fa'
import { useAIAssistant } from '@/contexts/AIAssistantContext'

const CATEGORY_META = {
  auth: { label: 'Login Issue', color: 'danger', icon: '🔐' },
  session: { label: 'Session Issue', color: 'warning', icon: '⏱️' },
  permission: { label: 'Access Issue', color: 'warning', icon: '🚫' },
  network: { label: 'Connection Issue', color: 'default', icon: '🌐' },
  location: { label: 'Location Issue', color: 'secondary', icon: '📍' },
  attendance: { label: 'Attendance Issue', color: 'primary', icon: '📋' },
  leave: { label: 'Leave Issue', color: 'success', icon: '🏖️' },
  upload: { label: 'Upload Issue', color: 'warning', icon: '📁' },
  navigation: { label: 'Page Not Found', color: 'default', icon: '🔍' },
  server: { label: 'Server Issue', color: 'danger', icon: '🖥️' },
  account: { label: 'Account Issue', color: 'danger', icon: '👤' },
}

export default function AIAssistant() {
  const {
    isOpen,
    errorContext,
    classification,
    aiResponse,
    isAiLoading,
    conversationHistory,
    askQuestion,
    closeAssistant,
  } = useAIAssistant()

  const [userInput, setUserInput] = useState('')
  const chatEndRef = useRef(null)
  const inputRef = useRef(null)

  // Scroll to bottom when new messages appear
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [aiResponse, conversationHistory, isAiLoading])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    } else {
      setUserInput('')
    }
  }, [isOpen])

  const handleSend = () => {
    if (!userInput.trim() || isAiLoading) return
    askQuestion(userInput)
    setUserInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const meta = classification ? CATEGORY_META[classification.category] || {} : {}

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeAssistant}
      placement="center"
      backdrop="blur"
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        base: 'border border-gray-200 dark:border-slate-600 max-h-[85vh] bg-white dark:bg-[#1a1f2e]',
        header: 'border-b border-gray-200 dark:border-slate-600 pb-3',
        footer: 'border-t border-gray-200 dark:border-slate-600 pt-3',
        body: 'py-4',
        closeButton: 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700',
      }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader>
              <div className="flex items-center gap-3 w-full">
                <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/40 dark:to-primary-800/40 rounded-xl">
                  <FaRobot className="text-primary-600 dark:text-primary-400 text-lg" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">MIRA Assistant</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">AI-powered help for Talio</p>
                </div>
                {classification && (
                  <Chip
                    color={meta.color || 'default'}
                    variant="flat"
                    size="sm"
                    startContent={<span className="text-sm ml-1">{meta.icon}</span>}
                  >
                    {meta.label}
                  </Chip>
                )}
              </div>
            </ModalHeader>

            <ModalBody>
              {/* Error Context Banner */}
              {errorContext && (
                <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700/50 rounded-xl p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <FaTimesCircle className="text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0 text-lg" />
                    <div>
                      <p className="text-sm font-bold text-red-700 dark:text-red-300">Error Detected</p>
                      <p className="text-sm font-medium text-red-600 dark:text-red-200 mt-1">
                        {errorContext.message}
                      </p>
                      {errorContext.page && (
                        <p className="text-xs text-red-500 dark:text-red-400/70 mt-1">
                          Page: {errorContext.page}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Tips */}
              {classification && classification.tips.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/15 border border-amber-300 dark:border-amber-700/40 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <FaLightbulb className="text-amber-500 dark:text-amber-400" />
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-300">Quick Tips</span>
                  </div>
                  <ul className="space-y-1.5">
                    {classification.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
                        <span className="text-amber-500 dark:text-amber-400 mt-0.5">•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Divider className="my-2" />

              {/* AI Response / Conversation */}
              <div className="space-y-4 min-h-[100px]">
                {/* Show conversation history */}
                {conversationHistory.length > 0 ? (
                  conversationHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-4 py-3 ${
                          msg.role === 'user'
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-100 dark:bg-slate-700/80 text-gray-800 dark:text-gray-100'
                        }`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <FaRobot className="text-primary-500 dark:text-primary-400 text-xs" />
                            <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">MIRA</span>
                          </div>
                        )}
                        <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    </div>
                  ))
                ) : aiResponse ? (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl px-4 py-3 bg-gray-100 dark:bg-slate-700/80 text-gray-800 dark:text-gray-100">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <FaRobot className="text-primary-500 dark:text-primary-400 text-xs" />
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">MIRA</span>
                      </div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{aiResponse}</div>
                    </div>
                  </div>
                ) : null}

                {/* Loading indicator */}
                {isAiLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-xl px-4 py-3 bg-gray-100 dark:bg-slate-700/80">
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" color="primary" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">MIRA is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Scope disclaimer */}
              <div className="flex items-center gap-2 mt-3 px-1">
                <FaInfoCircle className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0" />
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  MIRA can only help with Talio-related questions and features.
                </p>
              </div>
            </ModalBody>

            <ModalFooter>
              <div className="flex w-full gap-2">
                <Input
                  ref={inputRef}
                  placeholder="Ask MIRA anything about Talio..."
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  variant="bordered"
                  radius="lg"
                  size="md"
                  isDisabled={isAiLoading}
                  classNames={{
                    inputWrapper: 'bg-gray-50 dark:bg-slate-700/60 border-gray-300 dark:border-slate-600',
                    input: 'text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  }}
                  startContent={<FaRobot className="text-gray-400 dark:text-gray-500 text-sm" />}
                />
                <Button
                  color="primary"
                  radius="lg"
                  isIconOnly
                  isDisabled={!userInput.trim() || isAiLoading}
                  onPress={handleSend}
                  className="min-w-[44px]"
                >
                  <FaPaperPlane className="text-sm" />
                </Button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
