'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
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
} from '@heroui/react'
import { FaPaperPlane, FaRobot, FaInfoCircle, FaCheckCircle, FaHeadset } from 'react-icons/fa'
import { useAIAssistant } from '@/contexts/AIAssistantContext'
import { useRouter } from 'next/navigation'

const CATEGORY_META = {
  auth: { label: 'Login Help', color: 'primary', icon: '🔐' },
  session: { label: 'Session Help', color: 'warning', icon: '⏱️' },
  permission: { label: 'Access Help', color: 'secondary', icon: '🛡️' },
  network: { label: 'Connectivity', color: 'default', icon: '🌐' },
  location: { label: 'Location Setup', color: 'secondary', icon: '📍' },
  attendance: { label: 'Attendance Help', color: 'primary', icon: '📋' },
  leave: { label: 'Leave Guide', color: 'success', icon: '🏖️' },
  upload: { label: 'Upload Guide', color: 'warning', icon: '📁' },
  navigation: { label: 'Navigation', color: 'default', icon: '🔍' },
  server: { label: 'Service Status', color: 'warning', icon: '🖥️' },
  account: { label: 'Account Help', color: 'primary', icon: '👤' },
}

// Render formatted AI response with bold, numbered lists, etc.
function FormattedMessage({ content }) {
  const parts = useMemo(() => {
    if (!content) return []
    return content.split('\n').map((line, i) => {
      // Bold text: **text**
      const boldParsed = line.split(/\*\*(.*?)\*\*/g).map((segment, j) =>
        j % 2 === 1 ? <strong key={j}>{segment}</strong> : segment
      )
      // Numbered list
      const numberedMatch = line.match(/^(\d+)\.\s+(.*)/)
      if (numberedMatch) {
        return (
          <div key={i} className="flex items-start gap-2.5 py-1">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-[11px] font-bold text-primary-600 dark:text-primary-400 mt-0.5">
              {numberedMatch[1]}
            </span>
            <span className="flex-1">{boldParsed}</span>
          </div>
        )
      }
      // Bullet list
      if (line.match(/^[-•]\s+/)) {
        return (
          <div key={i} className="flex items-start gap-2 py-0.5 pl-1">
            <span className="text-primary-400 mt-1.5 text-[6px]">●</span>
            <span className="flex-1">{boldParsed}</span>
          </div>
        )
      }
      if (line.trim() === '') return <div key={i} className="h-2" />
      return <p key={i} className="py-0.5">{boldParsed}</p>
    })
  }, [content])

  return <div className="text-sm leading-relaxed">{parts}</div>
}

export default function AIAssistant() {
  const {
    isOpen,
    errorContext,
    classification,
    aiResponse,
    isAiLoading,
    conversationHistory,
    isSolutionProvided,
    askQuestion,
    closeAssistant,
  } = useAIAssistant()

  const router = useRouter()
  const [userInput, setUserInput] = useState('')
  const chatEndRef = useRef(null)
  const inputRef = useRef(null)

  const chatDisabled = isSolutionProvided || isAiLoading

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
    if (!userInput.trim() || chatDisabled) return
    askQuestion(userInput)
    setUserInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleContactSupport = () => {
    closeAssistant()
    router.push('/dashboard/helpdesk')
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
        base: 'border border-gray-200 dark:border-slate-600 max-h-[85vh] bg-white dark:bg-[#1a1f2e] rounded-2xl overflow-hidden',
        header: 'border-b border-gray-200 dark:border-slate-600 pb-3 rounded-t-2xl',
        footer: 'border-t border-gray-200 dark:border-slate-600 pt-3',
        body: 'py-4',
        closeButton: 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 top-3 right-3',
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
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">MIRA Assistant</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">AI-powered help for Talio</p>
                </div>
                {classification && (
                  <Chip
                    color={meta.color || 'default'}
                    variant="flat"
                    size="sm"
                    startContent={<span className="text-sm ml-1">{meta.icon}</span>}
                    className="flex-shrink-0"
                  >
                    {meta.label}
                  </Chip>
                )}
              </div>
            </ModalHeader>

            <ModalBody>
              {/* Guidance Context Banner - friendly, non-alarming */}
              {errorContext && (
                <div className="bg-primary-50 dark:bg-primary-900/15 border border-primary-200 dark:border-primary-700/40 rounded-xl p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <FaInfoCircle className="text-primary-500 dark:text-primary-400 mt-0.5 flex-shrink-0 text-base" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                        MIRA noticed something that needs your attention
                      </p>
                      <p className="text-sm text-primary-600/80 dark:text-primary-200/80 mt-1">
                        {errorContext.message}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actionable Steps */}
              {classification && classification.tips.length > 0 && (
                <div className="bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700/60 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FaCheckCircle className="text-primary-500 dark:text-primary-400 text-sm" />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Try these steps</span>
                  </div>
                  <div className="space-y-2">
                    {classification.tips.map((tip, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-[11px] font-bold text-primary-600 dark:text-primary-400 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-gray-700 dark:text-gray-300">{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Response / Conversation */}
              <div className="space-y-3 min-h-[80px]">
                {/* Show conversation history */}
                {conversationHistory.length > 0 ? (
                  conversationHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-3 ${
                          msg.role === 'user'
                            ? 'bg-primary-500 text-white rounded-2xl rounded-br-md'
                            : 'bg-gray-100 dark:bg-slate-700/80 text-gray-800 dark:text-gray-100 rounded-2xl rounded-bl-md'
                        }`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1.5 mb-2">
                            <FaRobot className="text-primary-500 dark:text-primary-400 text-xs" />
                            <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">MIRA</span>
                          </div>
                        )}
                        {msg.role === 'assistant' ? (
                          <FormattedMessage content={msg.content} />
                        ) : (
                          <div className="text-sm leading-relaxed">{msg.content}</div>
                        )}
                      </div>
                    </div>
                  ))
                ) : aiResponse ? (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 bg-gray-100 dark:bg-slate-700/80 text-gray-800 dark:text-gray-100">
                      <div className="flex items-center gap-1.5 mb-2">
                        <FaRobot className="text-primary-500 dark:text-primary-400 text-xs" />
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">MIRA</span>
                      </div>
                      <FormattedMessage content={aiResponse} />
                    </div>
                  </div>
                ) : null}

                {/* Loading indicator */}
                {isAiLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-gray-100 dark:bg-slate-700/80">
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" color="primary" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">MIRA is looking into this...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </ModalBody>

            <ModalFooter>
              {isSolutionProvided ? (
                <div className="flex flex-col w-full gap-2.5">
                  <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                    Hope that helped! If you still need assistance:
                  </p>
                  <Button
                    color="primary"
                    variant="flat"
                    radius="lg"
                    fullWidth
                    onPress={handleContactSupport}
                    startContent={<FaHeadset className="text-sm" />}
                    className="font-medium"
                  >
                    Contact Support
                  </Button>
                </div>
              ) : (
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
                    isDisabled={chatDisabled}
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
                    isDisabled={!userInput.trim() || chatDisabled}
                    onPress={handleSend}
                    className="min-w-[44px]"
                  >
                    <FaPaperPlane className="text-sm" />
                  </Button>
                </div>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
