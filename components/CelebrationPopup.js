'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import useAuthedSWR from '@/hooks/useAuthedSWR'

// ── Confetti Launchers ──

function fireBirthdayConfetti() {
  const duration = 3500
  const end = Date.now() + duration
  const colors = ['#FF6B9D', '#C084FC', '#FDE047', '#67E8F9', '#FB923C', '#34D399']

  ;(function frame() {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.65 },
      colors,
      zIndex: 2147483647,
    })
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.65 },
      colors,
      zIndex: 2147483647,
    })
    if (Date.now() < end) requestAnimationFrame(frame)
  })()

  setTimeout(() => {
    confetti({
      particleCount: 120,
      spread: 100,
      origin: { x: 0.5, y: 0.4 },
      colors,
      zIndex: 2147483647,
      scalar: 1.2,
    })
  }, 300)
}

function fireAnniversaryConfetti() {
  const colors = ['#6366F1', '#A855F7', '#F59E0B', '#10B981', '#3B82F6', '#EC4899']
  const duration = 3500
  const end = Date.now() + duration

  ;(function frame() {
    confetti({
      particleCount: 2,
      angle: 60,
      spread: 80,
      origin: { x: 0, y: 0.5 },
      colors,
      shapes: ['star'],
      zIndex: 2147483647,
    })
    confetti({
      particleCount: 2,
      angle: 120,
      spread: 80,
      origin: { x: 1, y: 0.5 },
      colors,
      shapes: ['star'],
      zIndex: 2147483647,
    })
    if (Date.now() < end) requestAnimationFrame(frame)
  })()

  setTimeout(() => {
    confetti({
      particleCount: 80,
      spread: 120,
      origin: { x: 0.5, y: 0.45 },
      colors,
      shapes: ['star', 'circle'],
      zIndex: 2147483647,
      scalar: 1.3,
    })
  }, 400)
}

// ── Subtle sparkle dots (replaces old FloatingParticles) ──

function SparkleField({ type }) {
  const isBirthday = type === 'birthday'
  const count = 12

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className={`absolute w-1 h-1 rounded-full ${
            isBirthday ? 'bg-pink-300 dark:bg-pink-400' : 'bg-indigo-300 dark:bg-indigo-400'
          }`}
          style={{
            left: `${8 + ((i * 17) % 84)}%`,
            top: `${10 + ((i * 23) % 75)}%`,
          }}
          animate={{
            opacity: [0, 0.8, 0],
            scale: [0.5, 1.4, 0.5],
          }}
          transition={{
            duration: 2.5 + (i % 3) * 0.6,
            delay: i * 0.25,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}



// ── Person Card ──

function PersonCard({ person, type, index }) {
  const isBirthday = type === 'birthday'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.1 + index * 0.12, type: 'spring', stiffness: 200 }}
      className="flex flex-col items-center gap-2.5"
    >
      {/* Avatar with animated glow ring */}
      <motion.div
        className={`relative rounded-full p-[3px] ${
          isBirthday
            ? 'bg-gradient-to-br from-pink-400 via-rose-400 to-purple-500'
            : 'bg-gradient-to-br from-indigo-400 via-purple-400 to-blue-500'
        }`}
        animate={{
          boxShadow: isBirthday
            ? [
                '0 0 16px rgba(236,72,153,0.3), 0 0 32px rgba(168,85,247,0.15)',
                '0 0 24px rgba(236,72,153,0.5), 0 0 48px rgba(168,85,247,0.25)',
                '0 0 16px rgba(236,72,153,0.3), 0 0 32px rgba(168,85,247,0.15)',
              ]
            : [
                '0 0 16px rgba(99,102,241,0.3), 0 0 32px rgba(99,102,241,0.15)',
                '0 0 24px rgba(99,102,241,0.5), 0 0 48px rgba(99,102,241,0.25)',
                '0 0 16px rgba(99,102,241,0.3), 0 0 32px rgba(99,102,241,0.15)',
              ],
        }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-800 overflow-hidden ring-2 ring-white/50 dark:ring-slate-700/50">
          {person.profilePicture ? (
            <img
              src={person.profilePicture}
              alt={`${person.firstName} ${person.lastName}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-2xl font-bold ${
              isBirthday
                ? 'bg-gradient-to-br from-pink-100 to-purple-100 text-pink-600 dark:from-pink-900/30 dark:to-purple-900/30 dark:text-pink-300'
                : 'bg-gradient-to-br from-indigo-100 to-blue-100 text-indigo-600 dark:from-indigo-900/30 dark:to-blue-900/30 dark:text-indigo-300'
            }`}>
              {person.firstName?.[0]}{person.lastName?.[0]}
            </div>
          )}
        </div>
      </motion.div>

      <div className="text-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
          {person.firstName} {person.lastName}
        </h3>
        {person.department && (
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{person.department}</p>
        )}
        {type === 'anniversary' && person.years && (
          <motion.p
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            🎯 {person.years} {person.years === 1 ? 'Year' : 'Years'}!
          </motion.p>
        )}
      </div>
    </motion.div>
  )
}



// ── Main Popup ──

export default function CelebrationPopup() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [celebrations, setCelebrations] = useState([])
  const confettiFired = useRef(false)

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

  // Fire confetti when popup becomes visible
  useEffect(() => {
    if (celebrations.length === 0 || dismissed || confettiFired.current) return
    confettiFired.current = true

    const timer = setTimeout(() => {
      if (celebrations[0]?.type === 'birthday') {
        fireBirthdayConfetti()
      } else {
        fireAnniversaryConfetti()
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [celebrations, dismissed])

  const handleDismiss = useCallback(() => {
    const dismissKey = `celebrations-dismissed-${new Date().toDateString()}`
    sessionStorage.setItem(dismissKey, 'true')
    setDismissed(true)
  }, [])

  const handleNext = useCallback(() => {
    if (currentIndex < celebrations.length - 1) {
      setCurrentIndex(prev => prev + 1)
      confettiFired.current = false
    } else {
      handleDismiss()
    }
  }, [currentIndex, celebrations.length, handleDismiss])

  // Fire confetti on index change (for subsequent cards)
  useEffect(() => {
    if (celebrations.length === 0 || dismissed || currentIndex === 0) return
    const current = celebrations[currentIndex]
    if (current?.type === 'birthday') {
      fireBirthdayConfetti()
    } else {
      fireAnniversaryConfetti()
    }
  }, [currentIndex, celebrations, dismissed])

  const isVisible = celebrations.length > 0 && !dismissed
  const current = celebrations[currentIndex]

  return (
    <AnimatePresence>
      {isVisible && current && (
        <motion.div
          key="celebration-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleDismiss() }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Card — slides up from bottom */}
          <motion.div
            key={currentIndex}
            className="relative z-10"
            initial={{ opacity: 0, y: '100vh' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 170, damping: 22 }}
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

                <SparkleField type={current.type} />

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
                  <motion.div
                    className="flex justify-center items-center gap-5 mb-5"
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                  >
                    {current.type === 'birthday' ? (
                      <>
                        <motion.span
                          className="text-4xl"
                          animate={{ rotate: [0, -8, 8, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                        >🎁</motion.span>
                        <motion.span
                          className="text-5xl"
                          animate={{ scale: [1, 1.08, 1] }}
                          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                        >🎂</motion.span>
                        <motion.span
                          className="text-4xl"
                          animate={{ rotate: [0, 8, -8, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                        >🎁</motion.span>
                      </>
                    ) : (
                      <>
                        <motion.span
                          className="text-4xl"
                          animate={{ rotate: [0, -8, 8, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                        >🌟</motion.span>
                        <motion.span
                          className="text-5xl"
                          animate={{ scale: [1, 1.08, 1] }}
                          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                        >🏆</motion.span>
                        <motion.span
                          className="text-4xl"
                          animate={{ rotate: [0, 8, -8, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                        >🌟</motion.span>
                      </>
                    )}
                  </motion.div>

                  {/* Title */}
                  <motion.div
                    className="text-center mb-7"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.5 }}
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
                  </motion.div>

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
                  <motion.div
                    className="flex justify-center mt-7"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <motion.button
                      onClick={handleNext}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
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
                        {currentIndex < celebrations.length - 1
                          ? '🎉 Send Wishes & Next'
                          : '🎉 Send Wishes'
                        }
                      </span>
                    </motion.button>
                  </motion.div>

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
