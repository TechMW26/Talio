'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import useAuthedSWR from '@/hooks/useAuthedSWR'

// ── Confetti Launchers ──

function fireBirthdayConfetti() {
  const duration = 3000
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

  // Big center burst after a short delay
  setTimeout(() => {
    confetti({
      particleCount: 100,
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
  const duration = 3000
  const end = Date.now() + duration

  // Star-shaped confetti effect
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

// ── Floating Emoji Particles ──

function FloatingParticles({ type }) {
  const emojis = type === 'birthday'
    ? ['🎂', '🎈', '🎁', '🎉', '🎊', '🍰', '🧁', '🎀']
    : ['🏆', '⭐', '🎯', '🎉', '💼', '🚀', '🌟', '🎊']

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {emojis.map((emoji, i) => (
        <motion.span
          key={i}
          className="absolute text-2xl"
          initial={{
            x: `${10 + (i * 12) % 80}%`,
            y: '110%',
            opacity: 0,
            rotate: 0,
          }}
          animate={{
            y: '-10%',
            opacity: [0, 1, 1, 0],
            rotate: [0, (i % 2 === 0 ? 1 : -1) * 360],
          }}
          transition={{
            duration: 4 + (i * 0.5),
            delay: i * 0.3,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        >
          {emoji}
        </motion.span>
      ))}
    </div>
  )
}

// ── Gift Box Animation ──

function GiftBox({ delay = 0 }) {
  return (
    <motion.div
      className="relative inline-block"
      initial={{ scale: 0, rotate: -10 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 15, delay }}
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="text-5xl"
      >
        🎁
      </motion.div>
      {/* Sparkle */}
      <motion.span
        className="absolute -top-1 -right-1 text-lg"
        animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        ✨
      </motion.span>
    </motion.div>
  )
}

// ── Person Card ──

function PersonCard({ person, type, index }) {
  const isBirthday = type === 'birthday'

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.2 + index * 0.15, type: 'spring', stiffness: 200 }}
      className="flex flex-col items-center gap-3 p-4"
    >
      {/* Avatar with glow ring */}
      <motion.div
        className={`relative rounded-full p-1 ${
          isBirthday
            ? 'bg-gradient-to-br from-pink-400 via-purple-400 to-yellow-400'
            : 'bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-500'
        }`}
        animate={{
          boxShadow: isBirthday
            ? ['0 0 20px rgba(236,72,153,0.4)', '0 0 40px rgba(168,85,247,0.5)', '0 0 20px rgba(236,72,153,0.4)']
            : ['0 0 20px rgba(99,102,241,0.4)', '0 0 40px rgba(99,102,241,0.5)', '0 0 20px rgba(99,102,241,0.4)'],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="w-20 h-20 rounded-full bg-white dark:bg-slate-800 overflow-hidden">
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

      {/* Name */}
      <div className="text-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {person.firstName} {person.lastName}
        </h3>
        {person.department && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{person.department}</p>
        )}
        {type === 'anniversary' && person.years && (
          <motion.p
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mt-1"
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

  // Build a flat list of celebrations: [{type, people: [...]}]
  useEffect(() => {
    if (!data?.success) return

    const items = []
    if (data.birthdays?.length > 0) {
      items.push({ type: 'birthday', people: data.birthdays })
    }
    if (data.anniversaries?.length > 0) {
      items.push({ type: 'anniversary', people: data.anniversaries })
    }

    // Check sessionStorage for dismissal
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

  // Fire confetti on index change
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
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Popup Card */}
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, scale: 0.8, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            transition={{ type: 'spring', stiffness: 250, damping: 20 }}
            className={`relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl ${
              current.type === 'birthday'
                ? 'bg-gradient-to-b from-pink-50 via-white to-purple-50 dark:from-pink-950/40 dark:via-slate-900 dark:to-purple-950/40'
                : 'bg-gradient-to-b from-indigo-50 via-white to-blue-50 dark:from-indigo-950/40 dark:via-slate-900 dark:to-blue-950/40'
            }`}
          >
            <FloatingParticles type={current.type} />

            {/* Top decorative bar */}
            <div className={`h-1.5 w-full ${
              current.type === 'birthday'
                ? 'bg-gradient-to-r from-pink-400 via-purple-400 to-yellow-400'
                : 'bg-gradient-to-r from-indigo-400 via-purple-400 to-blue-400'
            }`} />

            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/80 dark:bg-slate-800/80 backdrop-blur flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Content */}
            <div className="relative px-6 pt-8 pb-6">
              {/* Icon header */}
              <motion.div
                className="flex justify-center gap-4 mb-4"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <GiftBox delay={0.1} />
                <motion.span
                  className="text-5xl"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.2 }}
                >
                  {current.type === 'birthday' ? '🎂' : '🏆'}
                </motion.span>
                <GiftBox delay={0.3} />
              </motion.div>

              {/* Title */}
              <motion.div
                className="text-center mb-6"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h2 className={`text-2xl font-extrabold mb-1 ${
                  current.type === 'birthday'
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent'
                    : 'bg-gradient-to-r from-indigo-500 to-blue-600 bg-clip-text text-transparent'
                }`}>
                  {current.type === 'birthday'
                    ? (current.people.length === 1 ? 'Happy Birthday! 🎉' : 'Happy Birthday to All! 🎉')
                    : (current.people.length === 1 ? 'Work Anniversary! 🎊' : 'Work Anniversaries! 🎊')
                  }
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {current.type === 'birthday'
                    ? 'Wishing a wonderful year ahead filled with joy and success!'
                    : 'Thank you for your dedication and incredible contributions!'
                  }
                </p>
              </motion.div>

              {/* People */}
              <div className={`flex flex-wrap justify-center ${current.people.length > 2 ? 'gap-2' : 'gap-4'}`}>
                {current.people.map((person, i) => (
                  <PersonCard
                    key={person._id}
                    person={person}
                    type={current.type}
                    index={i}
                  />
                ))}
              </div>

              {/* Action buttons */}
              <motion.div
                className="flex justify-center gap-3 mt-6"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <button
                  onClick={handleNext}
                  className={`px-6 py-2.5 rounded-full text-white font-semibold text-sm shadow-lg transition-all hover:scale-105 active:scale-95 ${
                    current.type === 'birthday'
                      ? 'bg-gradient-to-r from-pink-500 to-purple-500 hover:shadow-pink-500/30'
                      : 'bg-gradient-to-r from-indigo-500 to-blue-500 hover:shadow-indigo-500/30'
                  }`}
                >
                  {currentIndex < celebrations.length - 1
                    ? '🎉 Send Wishes & Next'
                    : '🎉 Send Wishes'
                  }
                </button>
              </motion.div>

              {/* Page indicator */}
              {celebrations.length > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  {celebrations.map((_, i) => (
                    <motion.div
                      key={i}
                      className={`h-1.5 rounded-full transition-all ${
                        i === currentIndex
                          ? `w-6 ${current.type === 'birthday' ? 'bg-pink-400' : 'bg-indigo-400'}`
                          : 'w-1.5 bg-slate-300 dark:bg-slate-600'
                      }`}
                      layout
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
