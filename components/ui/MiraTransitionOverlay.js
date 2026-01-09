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
      
      const miraContainer = document.querySelector('[data-mira-sphere]')
      if (miraContainer) {
        miraContainer.style.opacity = '0'
        miraContainer.style.transition = 'opacity 0.1s'
      }
    } else if (!isAILoading && phaseRef.current === PHASE.HANDOFF) {
      // AI loading ended while we were in HANDOFF - start REVERSE animation
      isReversingRef.current = true
      setShouldTriggerBlur(false)
      phaseRef.current = PHASE.REVERSE_SPIN
      phaseStartRef.current = Date.now()
      setIsVisible(true) // Make sure we're visible for reverse animation
      
      // Keep header sphere hidden during reverse animation
      const miraContainer = document.querySelector('[data-mira-sphere]')
      if (miraContainer) {
        miraContainer.style.opacity = '0'
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

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
    
    // Match GlobalAILoadingOverlay particle count
    const PARTICLE_COUNT = 1500
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
        startX,
        startY,
        startZ,
        // Current position (animated)
        x: startX,
        y: startY,
        z: startZ,
        // Scatter position (final scattered location)
        scatterX,
        scatterY,
        scatterZ,
        // Final center sphere position
        targetX, targetY, targetZ,
        // Match GlobalAILoadingOverlay particle sizes EXACTLY
        size: Math.random() * 1 + 0.8,
        hueOffset: Math.random() * 60 - 30,
        phaseOffset: Math.random() * Math.PI * 2,
        oscillateSpeed: 1 + Math.random() * 2,
        oscillateAmount: CENTER_SPHERE_RADIUS * 0.15,
        oscillatePhase: Math.random() * Math.PI * 2,
        // Random delay for staggered emergence (0 to 0.4 of phase duration)
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
        const miraContainer = document.querySelector('[data-mira-sphere]')
        if (miraContainer) {
          miraContainer.style.opacity = '1'
          miraContainer.style.transition = 'opacity 0.2s'
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

      // Easing functions
      const easeOutQuad = t => 1 - (1 - t) * (1 - t)
      const easeInQuad = t => t * t
      const easeInOutQuad = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      // Smoother easing for reverse animation - very smooth deceleration
      const easeOutCubic = t => 1 - Math.pow(1 - t, 3)
      const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2
      const easeOutQuart = t => 1 - Math.pow(1 - t, 4)

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
          // EMERGE: Particles slowly emerge from header sphere toward scatter positions
          // Each particle has a random delay for staggered effect
          // Use ease-in-out for slow start, accelerate in middle, slow at end
          const adjustedProgress = Math.max(0, (phaseProgress - p.emergeDelay) / (1 - p.emergeDelay))
          const t = easeInOutQuad(adjustedProgress)
          
          // Interpolate from start to scatter position
          drawX = p.startX + (p.scatterX - p.startX) * t
          drawY = p.startY + (p.scatterY - p.startY) * t
          drawZ = p.startZ + (p.scatterZ - p.startZ) * t
          
          // Update actual position for seamless transition to SCATTER
          p.x = drawX
          p.y = drawY
          p.z = drawZ
          
        } else if (currentPhase === PHASE.SCATTER) {
          // SCATTER: Particles oscillate at their scattered positions
          const osc = Math.sin(time * p.oscillateSpeed + p.oscillatePhase) * p.oscillateAmount
          drawX = p.scatterX + osc * 0.5
          drawY = p.scatterY + Math.cos(time * p.oscillateSpeed * 0.7 + p.oscillatePhase) * p.oscillateAmount * 0.3
          drawZ = p.scatterZ
          
          // Update position for convergence
          p.x = drawX
          p.y = drawY
          p.z = drawZ
          
        } else if (currentPhase === PHASE.CONVERGE) {
          // CONVERGE: Particles fly to center sphere while both spheres spin at same speed
          const t = easeInOutCubic(phaseProgress)
          // Apply rotation to target position - sphere is already spinning
          const rotatedTargetX = p.targetX * cosR - p.targetZ * sinR
          const rotatedTargetZ = p.targetX * sinR + p.targetZ * cosR
          
          drawX = p.x + (centerX + rotatedTargetX - p.x) * t
          drawY = p.y + (centerY + p.targetY - p.y) * t
          drawZ = p.z + (rotatedTargetZ - p.z) * t
          
        } else if (currentPhase === PHASE.SPIN_BLEND || currentPhase === PHASE.HANDOFF || currentPhase === PHASE.REVERSE_SPIN) {
          // SPIN_BLEND, HANDOFF & REVERSE_SPIN: Sphere rotates at center
          const rotatedX = p.targetX * cosR - p.targetZ * sinR
          const rotatedZ = p.targetX * sinR + p.targetZ * cosR
          drawX = centerX + rotatedX
          drawY = centerY + p.targetY
          drawZ = rotatedZ
          
        } else if (currentPhase === PHASE.REVERSE_SCATTER) {
          // REVERSE_SCATTER: Particles fly from center sphere back to scattered positions
          // Use easeOutCubic for smooth deceleration as particles spread out
          const t = easeOutCubic(phaseProgress)
          
          // Start from rotating center sphere (capture rotation at start of scatter)
          // Use fixed rotation to avoid spinning while scattering
          const scatterStartRotation = rotation - (phaseProgress * REVERSE_SCATTER_DURATION * 0.001 * BASE_ROTATION_SPEED)
          const cosStart = Math.cos(scatterStartRotation)
          const sinStart = Math.sin(scatterStartRotation)
          const rotatedX = p.targetX * cosStart - p.targetZ * sinStart
          const rotatedZ = p.targetX * sinStart + p.targetZ * cosStart
          const sphereX = centerX + rotatedX
          const sphereY = centerY + p.targetY
          const sphereZ = rotatedZ
          
          // Interpolate to scatter position with smooth curve
          drawX = sphereX + (p.scatterX - sphereX) * t
          drawY = sphereY + (p.scatterY - sphereY) * t
          drawZ = sphereZ + (p.scatterZ - sphereZ) * t
          
          // Update position for next phase
          p.x = drawX
          p.y = drawY
          p.z = drawZ
          
        } else if (currentPhase === PHASE.REVERSE_CONVERGE) {
          // REVERSE_CONVERGE: Particles fly from scattered positions back to header sphere
          // Use easeInOutSine for very smooth convergence without jitter
          // NO staggered delay on reverse - all particles move together smoothly
          const t = easeInOutSine(phaseProgress)
          
          // Interpolate from current scatter position to header start position
          // Use stored scatter positions for consistency
          drawX = p.scatterX + (p.startX - p.scatterX) * t
          drawY = p.scatterY + (p.startY - p.scatterY) * t
          drawZ = p.scatterZ + (p.startZ - p.scatterZ) * t
          
          p.x = drawX
          p.y = drawY
          p.z = drawZ
          
        } else if (currentPhase === PHASE.REVERSE_FADE) {
          // REVERSE_FADE: Particles are at header position, fading out
          drawX = p.startX
          drawY = p.startY
          drawZ = p.startZ
          
        } else {
          // Fallback - shouldn't reach here
          drawX = p.x
          drawY = p.y
          drawZ = p.z
        }

        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + drawZ)
        if (scale > 0) {
          let screenX, screenY
          if (currentPhase === PHASE.EMERGE || currentPhase === PHASE.SCATTER || 
              currentPhase === PHASE.REVERSE_SCATTER || currentPhase === PHASE.REVERSE_CONVERGE ||
              currentPhase === PHASE.REVERSE_FADE) {
            // No perspective projection during scatter phases - particles are in 2D screen space
            screenX = drawX
            screenY = drawY
          } else {
            screenX = centerX + (drawX - centerX) * scale
            screenY = centerY + (drawY - centerY) * scale
          }
          
          projected.push({
            x: screenX, y: screenY, z: drawZ, scale,
            size: p.size, hueOffset: p.hueOffset, phaseOffset: p.phaseOffset,
            phase: currentPhase, phaseProgress
          })
        }
      })

      // Sort only every 3 frames for performance
      const frameCount = Math.floor(time * 60) % 3
      if (frameCount === 0) {
        projected.sort((a, b) => b.z - a.z)
      }

      // Draw with theme colors - batch by color for performance
      const PI2 = Math.PI * 2
      const colorBuckets = new Map()
      
      projected.forEach(p => {
        const colorPhase = (Math.sin(time * 2 + p.phaseOffset) * 0.5 + 0.5)
        // Quantize colors to reduce unique colors for batching
        const r = Math.floor((colors.dark.r + colorPhase * (colors.light.r - colors.dark.r) + p.hueOffset * 0.15) / 16) * 16
        const g = Math.floor((colors.dark.g + colorPhase * (colors.light.g - colors.dark.g) + p.hueOffset * 0.2) / 16) * 16
        const b = Math.floor((colors.dark.b + colorPhase * (colors.light.b - colors.dark.b) + p.hueOffset * 0.15) / 16) * 16
        
        let alpha = 0.65 + p.scale * 0.35
        
        // Fade out during HANDOFF (forward animation ending)
        if (p.phase === PHASE.HANDOFF) {
          alpha *= (1 - p.phaseProgress)
        }
        // Fade in during REVERSE_SPIN (reverse animation starting)
        if (p.phase === PHASE.REVERSE_SPIN) {
          alpha *= p.phaseProgress
        }
        // Fade out during REVERSE_FADE (reverse animation ending)
        if (p.phase === PHASE.REVERSE_FADE) {
          alpha *= (1 - p.phaseProgress)
        }
        
        // Quantize alpha for batching
        const alphaQ = Math.round(alpha * 10) / 10
        const colorKey = `${Math.min(255, Math.max(0, r))},${Math.min(255, Math.max(0, g))},${Math.min(255, Math.max(0, b))},${alphaQ}`
        
        if (!colorBuckets.has(colorKey)) {
          colorBuckets.set(colorKey, [])
        }
        colorBuckets.get(colorKey).push({
          x: p.x,
          y: p.y,
          r: Math.max(0.2, p.size * p.scale)
        })
      })

      // Draw batched particles - much fewer fillStyle changes
      for (const [colorKey, circles] of colorBuckets) {
        ctx.fillStyle = `rgba(${colorKey})`
        ctx.beginPath()
        for (let i = 0; i < circles.length; i++) {
          const c = circles[i]
          ctx.moveTo(c.x + c.r, c.y)
          ctx.arc(c.x, c.y, c.r, 0, PI2)
        }
        ctx.fill()
      }

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
