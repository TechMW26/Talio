'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import MemberAvatar from '@/components/chat/MemberAvatar'
import { sendCelebrationWishes } from '@/lib/client/celebrationWishes'

// ── Person Card ──

function PersonCard({ person, type, index }) {
  const isBirthday = type === 'birthday'

  return (
    <div
      className="flex flex-col items-center gap-2.5"
    >
      {/* Avatar with static glow ring */}
      <div
        className={`relative rounded-full p-[3px] ${
          isBirthday
            ? 'bg-gradient-to-br from-pink-400 via-rose-400 to-purple-500'
            : 'bg-gradient-to-br from-indigo-400 via-purple-400 to-blue-500'
        }`}
      >
        <MemberAvatar
          member={person}
          className="w-24 h-24 ring-2 ring-white/50 dark:ring-zinc-700/50"
          textClassName="text-2xl"
          background={isBirthday
            ? 'linear-gradient(135deg, #9d174d, #7e22ce)'
            : 'linear-gradient(135deg, #4338ca, #2563eb)'}
        />
      </div>

      <div className="text-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
          {person.firstName} {person.lastName}
        </h3>
        {person.department && (
          <p className="text-sm text-slate-500 dark:text-zinc-400 font-medium">{person.department}</p>
        )}
        {type === 'anniversary' && person.years && (
          <p
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5"
          >
            🎯 {person.years} {person.years === 1 ? 'Year' : 'Years'}!
          </p>
        )}
      </div>
    </div>
  )
}



// ── Main Popup ──

export default function CelebrationPopup() {
  const reducedMotion = useReducedMotion()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [celebrations, setCelebrations] = useState([])
  const sendingRef = useRef(false)
  const sentRecipients = useRef(new Set())
  const [wishStatus, setWishStatus] = useState('idle')
  const [wishError, setWishError] = useState('')

  const { data } = useAuthedSWR('/api/celebrations/today')

  useEffect(() => {
    if (!data?.success) return

    const items = []
    if (data.birthdays?.length > 0) {
      items.push({ type: 'birthday', people: data.birthdays })
    }
    if (data.anniversaries?.length > 0) {
      items.push({ type: 'anniversary', people: data.anniversaries })
    }

    const dismissKey = `celebrations-dismissed-${new Date().toDateString()}`
    if (sessionStorage.getItem(dismissKey)) {
      setDismissed(true)
      return
    }

    setCelebrations(items)
  }, [data])

  const handleDismiss = useCallback(() => {
    if (sendingRef.current) return
    const dismissKey = `celebrations-dismissed-${new Date().toDateString()}`
    sessionStorage.setItem(dismissKey, 'true')
    setDismissed(true)
  }, [])

  const handleNext = useCallback(() => {
    setWishStatus('idle')
    setWishError('')
    if (currentIndex < celebrations.length - 1) {
      setCurrentIndex(prev => prev + 1)
    } else {
      handleDismiss()
    }
  }, [currentIndex, celebrations.length, handleDismiss])

  const isVisible = celebrations.length > 0 && !dismissed
  const current = celebrations[currentIndex]
  const hasRecipients = current?.people.some(person => String(person._id) !== data?.currentEmployeeId)

  const handleSendWishes = async () => {
    if (sendingRef.current) return
    if (wishStatus === 'sent' || !hasRecipients) return handleNext()
    sendingRef.current = true
    setWishStatus('sending')
    setWishError('')
    try {
      await sendCelebrationWishes({
        people: current.people,
        type: current.type,
        employeeId: data?.currentEmployeeId,
        token: localStorage.getItem('token'),
        sent: sentRecipients.current,
      })
      setWishStatus('sent')
    } catch (error) {
      setWishStatus('error')
      setWishError(error.message || 'Could not send wishes. Please try again.')
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <AnimatePresence>
      {isVisible && current && (
        <motion.div
          key="celebration-overlay"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.12 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleDismiss() }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Lightweight scale-and-fade pop. */}
          <motion.div
            key={currentIndex}
            className="relative z-10"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
          >
              {/* ── Birthday / Anniversary Card ── */}
              <div
                className={`relative w-full max-w-md rounded-3xl overflow-hidden ${
                  current.type === 'birthday'
                    ? 'shadow-[0_0_60px_rgba(236,72,153,0.2),0_20px_60px_rgba(0,0,0,0.3)]'
                    : 'shadow-[0_0_60px_rgba(99,102,241,0.2),0_20px_60px_rgba(0,0,0,0.3)]'
                }`}
              >
                {/* Card background */}
                <div className={`absolute inset-0 ${
                  current.type === 'birthday'
                    ? 'bg-gradient-to-b from-[#1a0a1e] via-[#1e1030] to-[#150820]'
                    : 'bg-gradient-to-b from-[#0a0e1e] via-[#101830] to-[#080e20]'
                }`} />

                {/* Subtle radial glow behind content */}
                <div className={`absolute inset-0 ${
                  current.type === 'birthday'
                    ? 'bg-[radial-gradient(ellipse_at_center,rgba(236,72,153,0.08)_0%,transparent_70%)]'
                    : 'bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.08)_0%,transparent_70%)]'
                }`} />

                {/* Top decorative gradient bar */}
                <div className={`h-1 w-full ${
                  current.type === 'birthday'
                    ? 'bg-gradient-to-r from-pink-500 via-rose-400 to-purple-500'
                    : 'bg-gradient-to-r from-indigo-500 via-purple-400 to-blue-500'
                }`} />

                {/* Close button */}
                <button
                  onClick={handleDismiss}
                  className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Content */}
                <div className="relative px-8 pt-8 pb-7">
                  {/* Decorative emoji row */}
                  <div
                    className="flex justify-center items-center gap-5 mb-5"
                  >
                    {current.type === 'birthday' ? (
                      <>
                        <span
                          className="text-4xl"
                        >🎁</span>
                        <span
                          className="text-5xl"
                        >🎂</span>
                        <span
                          className="text-4xl"
                        >🎁</span>
                      </>
                    ) : (
                      <>
                        <span
                          className="text-4xl"
                        >🌟</span>
                        <span
                          className="text-5xl"
                        >🏆</span>
                        <span
                          className="text-4xl"
                        >🌟</span>
                      </>
                    )}
                  </div>

                  {/* Title */}
                  <div
                    className="text-center mb-7"
                  >
                    <h2 className={`text-3xl font-extrabold mb-2 tracking-tight ${
                      current.type === 'birthday'
                        ? 'bg-gradient-to-r from-pink-400 via-rose-300 to-purple-400 bg-clip-text text-transparent'
                        : 'bg-gradient-to-r from-indigo-400 via-blue-300 to-purple-400 bg-clip-text text-transparent'
                    }`}>
                      {current.type === 'birthday'
                        ? (current.people.length === 1 ? 'Happy Birthday! 🎉' : 'Happy Birthday to All! 🎉')
                        : (current.people.length === 1 ? 'Work Anniversary! 🎊' : 'Work Anniversaries! 🎊')
                      }
                    </h2>
                    <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                      {current.type === 'birthday'
                        ? 'Wishing a wonderful year ahead filled with joy and success!'
                        : 'Thank you for your dedication and incredible contributions!'
                      }
                    </p>
                  </div>

                  {/* Subtle separator */}
                  <div className={`mx-auto w-16 h-px mb-6 ${
                    current.type === 'birthday'
                      ? 'bg-gradient-to-r from-transparent via-pink-500/40 to-transparent'
                      : 'bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent'
                  }`} />

                  {/* People */}
                  <div className={`flex flex-wrap justify-center ${current.people.length > 2 ? 'gap-3' : 'gap-6'}`}>
                    {current.people.map((person, i) => (
                      <PersonCard
                        key={person._id}
                        person={person}
                        type={current.type}
                        index={i}
                      />
                    ))}
                  </div>

                  {/* Action button */}
                  <div
                    className="flex justify-center mt-7"
                  >
                    <button
                      onClick={handleSendWishes}
                      disabled={wishStatus === 'sending'}
                      aria-busy={wishStatus === 'sending'}
                      className={`relative px-8 py-3 rounded-full text-white font-semibold text-sm tracking-wide overflow-hidden transition-shadow ${
                        current.type === 'birthday'
                          ? 'bg-gradient-to-r from-pink-500 via-rose-500 to-purple-500 shadow-lg shadow-pink-500/25 hover:shadow-xl hover:shadow-pink-500/30'
                          : 'bg-gradient-to-r from-indigo-500 via-blue-500 to-purple-500 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30'
                      }`}
                    >
                      {/* Shimmer effect */}
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5 }}
                      />
                      <span className="relative">
                        {wishStatus === 'sending' ? 'Sending wishes…'
                          : wishStatus === 'sent' || !hasRecipients
                            ? (currentIndex < celebrations.length - 1 ? 'Next celebration' : 'Done')
                            : wishStatus === 'error' ? 'Retry remaining wishes' : '🎉 Send Wishes'}
                      </span>
                    </button>
                  </div>
                  <p className="mt-3 text-center text-sm text-slate-300" role={wishError ? 'alert' : 'status'} aria-live="polite">
                    {wishError || (wishStatus === 'sent'
                      ? 'Wishes sent in private chat!'
                      : hasRecipients ? 'Sends a personal greeting to each person in Talio chat.' : '')}
                  </p>

                  {/* Page indicator */}
                  {celebrations.length > 1 && (
                    <div className="flex justify-center gap-2 mt-5">
                      {celebrations.map((_, i) => (
                        <motion.div
                          key={i}
                          className={`h-1.5 rounded-full transition-all ${
                            i === currentIndex
                              ? `w-6 ${current.type === 'birthday' ? 'bg-pink-400' : 'bg-indigo-400'}`
                              : 'w-1.5 bg-slate-600'
                          }`}
                          layout
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
