'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAILoading } from '@/contexts/AILoadingContext'
import { getThemeColors } from './MiraSphere'

/**
 * MIRA Transition Overlay
 * 
 * FORWARD Animation sequence (when AI loading starts):
 * 1. EMERGE: Particles slowly emerge from header MiraSphere
 * 2. SCATTER: Particles spread across screen + oscillate
 * 3. CONVERGE: Particles fly to center, forming the loading sphere
 * 4. SPIN_BLEND: Brief spin to match GlobalAILoadingOverlay
 * 5. HANDOFF: Fade out, let GlobalAILoadingOverlay take over
 * 
 * REVERSE Animation sequence (when AI loading ends):
 * 1. REVERSE_SPIN: Sphere spins at center (taking over from GlobalAILoadingOverlay)
 * 2. REVERSE_SCATTER: Particles scatter back out across screen
 * 3. REVERSE_CONVERGE: Particles fly back to header sphere position
 * 4. REVERSE_FADE: Particles fade, header MiraSphere becomes visible
 * 
 * Uses SAME theme colors as MiraSphere and GlobalAILoadingOverlay
 */

const PHASE = {
  IDLE: 'idle',
  // Forward phases
  EMERGE: 'emerge',
  SCATTER: 'scatter',
  CONVERGE: 'converge',
  SPIN_BLEND: 'spin_blend',
  HANDOFF: 'handoff',
  // Reverse phases (when loading ends)
  REVERSE_SPIN: 'reverse_spin',
  REVERSE_SCATTER: 'reverse_scatter',
  REVERSE_CONVERGE: 'reverse_converge',
  REVERSE_FADE: 'reverse_fade',
}

// Forward animation timing
const EMERGE_DURATION = 800
const SCATTER_DURATION = 900
const CONVERGE_DURATION = 600
const SPIN_BLEND_DURATION = 400
const HANDOFF_DELAY = 200

// Reverse animation timing - longer for smoother transitions
const REVERSE_SPIN_DURATION = 400
const REVERSE_SCATTER_DURATION = 900
const REVERSE_CONVERGE_DURATION = 800
const REVERSE_FADE_DURATION = 350

// Rotation speed - MUST MATCH GlobalAILoadingOverlay's time * 0.4
const BASE_ROTATION_SPEED = 0.4  // radians per second

export default function MiraTransitionOverlay() {
  const { isAILoading, _setTransitionComplete } = useAILoading()
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const particlesRef = useRef([])
  const phaseRef = useRef(PHASE.IDLE)
  const phaseStartRef = useRef(0)
  const rotationRef = useRef(0)
  const colorsRef = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const [shouldTriggerBlur, setShouldTriggerBlur] = useState(false)
  const sourcePositionRef = useRef({ x: 0, y: 0 })

  const getMiraSpherePosition = useCallback(() => {
    const miraContainer = document.querySelector('[data-mira-sphere]')
    if (miraContainer) {
      const rect = miraContainer.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height
      }
    }
    return { x: window.innerWidth - 200, y: 40, width: 55, height: 55 }
  }, [])

  // Track if we're in forward or reverse animation
  const isReversingRef = useRef(false)

  useEffect(() => {
    if (isAILoading && phaseRef.current === PHASE.IDLE) {
      // Start FORWARD animation
      isReversingRef.current = false
      setIsVisible(true)
      setShouldTriggerBlur(false)
      phaseRef.current = PHASE.EMERGE
      phaseStartRef.current = Date.now()
      rotationRef.current = 0
      colorsRef.current = getThemeColors()
      sourcePositionRef.current = getMiraSpherePosition()
      
      const miraCanvas = document.querySelector('[data-mira-sphere] canvas')
      if (miraCanvas) {
        miraCanvas.style.opacity = '0'
        miraCanvas.style.transition = 'opacity 0.1s'
      }
    } else if (!isAILoading && phaseRef.current === PHASE.HANDOFF) {
      // AI loading ended while we were in HANDOFF - start REVERSE animation
      isReversingRef.current = true
      setShouldTriggerBlur(false)
      phaseRef.current = PHASE.REVERSE_SPIN
      phaseStartRef.current = Date.now()
      setIsVisible(true) // Make sure we're visible for reverse animation
      
      // Keep header sphere canvas hidden during reverse animation
      const miraCanvas = document.querySelector('[data-mira-sphere] canvas')
      if (miraCanvas) {
        miraCanvas.style.opacity = '0'
      }
    } else if (!isAILoading && phaseRef.current === PHASE.IDLE) {
      // Already idle, nothing to do
    } else if (!isAILoading && !isReversingRef.current) {
      // AI loading ended during forward animation - skip to reverse
      isReversingRef.current = true
      phaseRef.current = PHASE.REVERSE_SPIN
      phaseStartRef.current = Date.now()
    }
  }, [isAILoading, getMiraSpherePosition])

  useEffect(() => {
    if (!isVisible || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { alpha: true })
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }

    resize()

    const width = window.innerWidth
    const height = window.innerHeight
    const centerX = width / 2
    const centerY = height / 2
    const sourcePos = sourcePositionRef.current
    
    // Match GlobalAILoadingOverlay particle count - reduced for performance
    const PARTICLE_COUNT = 400
    const CENTER_SPHERE_RADIUS = Math.min(160, Math.max(90, Math.min(width, height) * 0.14))
    const sourceRadius = sourcePos.width * 0.30
    const Z_PERSPECTIVE = 400

    // Initialize particles - use same structure as GlobalAILoadingOverlay
    particlesRef.current = []
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Start from header sphere
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = sourceRadius * (0.85 + Math.random() * 0.3)

      const startX = sourcePos.x + r * Math.sin(phi) * Math.cos(theta)
      const startY = sourcePos.y + r * Math.sin(phi) * Math.sin(theta)
      const startZ = r * Math.cos(phi)

      // Scatter targets - use same spherical scatter as GlobalAILoadingOverlay
      // but scaled to viewport size
      const scatterRadius = Math.min(width, height) * 0.5 * (1.8 + Math.random() * 1.5)
      const scatterTheta = Math.random() * Math.PI * 2
      const scatterPhi = Math.acos(2 * Math.random() - 1)
      const scatterX = centerX + scatterRadius * Math.sin(scatterPhi) * Math.cos(scatterTheta)
      const scatterY = centerY + scatterRadius * Math.sin(scatterPhi) * Math.sin(scatterTheta)
      const scatterZ = scatterRadius * Math.cos(scatterPhi) * 0.3

      // Target in center sphere for convergence
      const targetTheta = Math.random() * Math.PI * 2
      const targetPhi = Math.acos(2 * Math.random() - 1)
      const targetR = CENTER_SPHERE_RADIUS * (0.85 + Math.random() * 0.3)
      const targetX = targetR * Math.sin(targetPhi) * Math.cos(targetTheta)
      const targetY = targetR * Math.sin(targetPhi) * Math.sin(targetTheta)
      const targetZ = targetR * Math.cos(targetPhi)

      particlesRef.current.push({
        // Starting position (header sphere)
        startX, startY, startZ,
        // Current position (animated)
        x: startX, y: startY, z: startZ,
        // Scatter position
        scatterX, scatterY, scatterZ,
        // Final center sphere position
        targetX, targetY, targetZ,
        // Match GlobalAILoadingOverlay particle size EXACTLY: Math.random() * 0.8 + 0.5
        size: Math.random() * 0.8 + 0.5,
        oscillatePhase: Math.random() * 6.28,
        emergeDelay: Math.random() * 0.4
      })
    }

    let lastTime = performance.now()

    const animate = (currentTime) => {
      const dt = Math.min((currentTime - lastTime) / 16.67, 2)
      lastTime = currentTime
      
      const now = Date.now()
      const elapsed = now - phaseStartRef.current
      const phase = phaseRef.current

      // If we're IDLE, stop the animation loop
      if (phase === PHASE.IDLE) {
        return
      }

      ctx.clearRect(0, 0, width, height)

      // FORWARD Phase transitions
      if (phase === PHASE.EMERGE && elapsed > EMERGE_DURATION) {
        phaseRef.current = PHASE.SCATTER
        phaseStartRef.current = now
      } else if (phase === PHASE.SCATTER && elapsed > SCATTER_DURATION) {
        phaseRef.current = PHASE.CONVERGE
        phaseStartRef.current = now
      } else if (phase === PHASE.CONVERGE && elapsed > CONVERGE_DURATION) {
        phaseRef.current = PHASE.SPIN_BLEND
        phaseStartRef.current = now
      } else if (phase === PHASE.SPIN_BLEND && elapsed > SPIN_BLEND_DURATION) {
        phaseRef.current = PHASE.HANDOFF
        phaseStartRef.current = now
        setShouldTriggerBlur(true)
      }
      // HANDOFF phase: Keep animating, waiting for reverse trigger from useEffect
      
      // REVERSE Phase transitions
      if (phase === PHASE.REVERSE_SPIN && elapsed > REVERSE_SPIN_DURATION) {
        phaseRef.current = PHASE.REVERSE_SCATTER
        phaseStartRef.current = now
      } else if (phase === PHASE.REVERSE_SCATTER && elapsed > REVERSE_SCATTER_DURATION) {
        phaseRef.current = PHASE.REVERSE_CONVERGE
        phaseStartRef.current = now
      } else if (phase === PHASE.REVERSE_CONVERGE && elapsed > REVERSE_CONVERGE_DURATION) {
        phaseRef.current = PHASE.REVERSE_FADE
        phaseStartRef.current = now
      } else if (phase === PHASE.REVERSE_FADE && elapsed > REVERSE_FADE_DURATION) {
        // Animation complete - show header sphere and hide overlay
        setIsVisible(false)
        phaseRef.current = PHASE.IDLE
        isReversingRef.current = false
        const miraCanvas = document.querySelector('[data-mira-sphere] canvas')
        if (miraCanvas) {
          miraCanvas.style.opacity = '1'
          miraCanvas.style.transition = 'opacity 0.2s'
        }
        return
      }

      const time = currentTime * 0.001
      const currentPhase = phaseRef.current
      const phaseDuration = 
        currentPhase === PHASE.EMERGE ? EMERGE_DURATION :
        currentPhase === PHASE.SCATTER ? SCATTER_DURATION :
        currentPhase === PHASE.CONVERGE ? CONVERGE_DURATION :
        currentPhase === PHASE.SPIN_BLEND ? SPIN_BLEND_DURATION :
        currentPhase === PHASE.HANDOFF ? HANDOFF_DELAY :
        currentPhase === PHASE.REVERSE_SPIN ? REVERSE_SPIN_DURATION :
        currentPhase === PHASE.REVERSE_SCATTER ? REVERSE_SCATTER_DURATION :
        currentPhase === PHASE.REVERSE_CONVERGE ? REVERSE_CONVERGE_DURATION :
        REVERSE_FADE_DURATION
      
      const phaseProgress = Math.min(1, elapsed / phaseDuration)

      // Pre-computed easing - simple quadratic for performance
      const easeOut = 1 - (1 - phaseProgress) * (1 - phaseProgress)
      const easeInOut = phaseProgress < 0.5 ? 2 * phaseProgress * phaseProgress : 1 - Math.pow(-2 * phaseProgress + 2, 2) / 2

      // Rotation - use SAME speed as GlobalAILoadingOverlay (time * 0.4)
      // This ensures both spheres spin at identical velocity during handoff
      const rotation = time * BASE_ROTATION_SPEED
      const cosR = Math.cos(rotation)
      const sinR = Math.sin(rotation)

      const colors = colorsRef.current || { light: { r: 129, g: 193, b: 181 }, dark: { r: 47, g: 109, b: 123 } }
      const projected = []

      particlesRef.current.forEach(p => {
        let drawX, drawY, drawZ

        if (currentPhase === PHASE.EMERGE) {
          // EMERGE: Particles emerge from header sphere toward scatter positions
          const adjustedProgress = Math.max(0, (phaseProgress - p.emergeDelay) / (1 - p.emergeDelay))
          const t = adjustedProgress * adjustedProgress // Simple ease-in
          
          drawX = p.startX + (p.scatterX - p.startX) * t
          drawY = p.startY + (p.scatterY - p.startY) * t
          drawZ = p.startZ + (p.scatterZ - p.startZ) * t
          p.x = drawX; p.y = drawY; p.z = drawZ
          
        } else if (currentPhase === PHASE.SCATTER) {
          // SCATTER: Simple oscillation at scattered positions
          const osc = Math.sin(time * 2 + p.oscillatePhase) * 8
          drawX = p.scatterX + osc
          drawY = p.scatterY + osc * 0.5
          drawZ = p.scatterZ
          p.x = drawX; p.y = drawY; p.z = drawZ
          
        } else if (currentPhase === PHASE.CONVERGE) {
          // CONVERGE: Particles fly to center sphere
          const rotatedTargetX = p.targetX * cosR - p.targetZ * sinR
          const rotatedTargetZ = p.targetX * sinR + p.targetZ * cosR
          
          drawX = p.x + (centerX + rotatedTargetX - p.x) * easeInOut
          drawY = p.y + (centerY + p.targetY - p.y) * easeInOut
          drawZ = p.z + (rotatedTargetZ - p.z) * easeInOut
          
        } else if (currentPhase === PHASE.SPIN_BLEND || currentPhase === PHASE.HANDOFF || currentPhase === PHASE.REVERSE_SPIN) {
          // Sphere rotates at center
          const rotatedX = p.targetX * cosR - p.targetZ * sinR
          const rotatedZ = p.targetX * sinR + p.targetZ * cosR
          drawX = centerX + rotatedX
          drawY = centerY + p.targetY
          drawZ = rotatedZ
          
        } else if (currentPhase === PHASE.REVERSE_SCATTER) {
          // REVERSE_SCATTER: Particles fly from center back to scattered positions
          const sphereX = centerX + p.targetX * cosR - p.targetZ * sinR
          const sphereY = centerY + p.targetY
          const sphereZ = p.targetX * sinR + p.targetZ * cosR
          
          drawX = sphereX + (p.scatterX - sphereX) * easeOut
          drawY = sphereY + (p.scatterY - sphereY) * easeOut
          drawZ = sphereZ + (p.scatterZ - sphereZ) * easeOut
          p.x = drawX; p.y = drawY; p.z = drawZ
          
        } else if (currentPhase === PHASE.REVERSE_CONVERGE) {
          // REVERSE_CONVERGE: Particles fly back to header sphere
          drawX = p.scatterX + (p.startX - p.scatterX) * easeInOut
          drawY = p.scatterY + (p.startY - p.scatterY) * easeInOut
          drawZ = p.scatterZ + (p.startZ - p.scatterZ) * easeInOut
          p.x = drawX; p.y = drawY; p.z = drawZ
          
        } else if (currentPhase === PHASE.REVERSE_FADE) {
          drawX = p.startX; drawY = p.startY; drawZ = p.startZ
        } else {
          drawX = p.x; drawY = p.y; drawZ = p.z
        }

        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + drawZ)
        const particleRadius = p.size * scale
        // Skip particles that are too small
        if (scale > 0 && particleRadius > 0.3) {
          let screenX, screenY
          if (currentPhase === PHASE.EMERGE || currentPhase === PHASE.SCATTER || 
              currentPhase === PHASE.REVERSE_SCATTER || currentPhase === PHASE.REVERSE_CONVERGE ||
              currentPhase === PHASE.REVERSE_FADE) {
            screenX = drawX
            screenY = drawY
          } else {
            screenX = centerX + (drawX - centerX) * scale
            screenY = centerY + (drawY - centerY) * scale
          }
          
          projected.push({ x: screenX, y: screenY, size: p.size, scale })
        }
      })

      // Skip sorting for performance - not critical for this effect
      
      // Draw with simplified color - single color for all particles
      const PI2 = Math.PI * 2
      const baseAlpha = currentPhase === PHASE.HANDOFF ? (1 - phaseProgress) :
                        currentPhase === PHASE.REVERSE_SPIN ? phaseProgress :
                        currentPhase === PHASE.REVERSE_FADE ? (1 - phaseProgress) : 0.85
      
      // Use single color for all particles - much faster
      const avgColor = {
        r: Math.floor((colors.light.r + colors.dark.r) / 2),
        g: Math.floor((colors.light.g + colors.dark.g) / 2),
        b: Math.floor((colors.light.b + colors.dark.b) / 2)
      }
      
      ctx.fillStyle = `rgba(${avgColor.r},${avgColor.g},${avgColor.b},${baseAlpha})`
      ctx.beginPath()
      
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i]
        const r = p.size * p.scale
        if (r > 0.3) {
          ctx.moveTo(p.x + r, p.y)
          ctx.arc(p.x, p.y, r, 0, PI2)
        }
      }
      ctx.fill()

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)
    window.addEventListener('resize', resize)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [isVisible])

  useEffect(() => {
    if (shouldTriggerBlur && typeof _setTransitionComplete === 'function') {
      const timer = setTimeout(() => _setTransitionComplete(true), 100)
      return () => clearTimeout(timer)
    }
  }, [shouldTriggerBlur, _setTransitionComplete])

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-[999997] pointer-events-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: 'transparent' }}
      />
    </div>
  )
}
