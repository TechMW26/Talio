'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAILoading } from '@/contexts/AILoadingContext'
import { useTheme } from '@/contexts/ThemeContext'
import { textToParticles, AI_MESSAGES, CHAR_WIDTH } from './particleFont'

/**
 * Global AI Loading Animation Overlay
 * 
 * Features:
 * - Animated mesh gradient background (magenta, blue, black, red)
 * - Pulsating backdrop blur (1px - 20px) - ONLY after transition completes
 * - Morphing 3D shapes (sphere → cube → pyramid → star → back)
 * - Particles disintegrate and reintegrate showing "thinking"
 * - Text messages formed by particles
 * 
 * NOTE: The blur effect only starts AFTER MiraTransitionOverlay completes
 * its particle-from-header animation. This is coordinated via transitionComplete.
 */

// 3D Shape definitions
const SHAPES = {
  sphere: (i, total, radius) => {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = radius * (0.9 + Math.random() * 0.2)
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi)
    }
  },
  cube: (i, total, radius) => {
    const side = radius * 1.4
    const face = Math.floor(Math.random() * 6)
    let x, y, z
    const u = (Math.random() - 0.5) * side
    const v = (Math.random() - 0.5) * side
    switch(face) {
      case 0: x = side/2; y = u; z = v; break
      case 1: x = -side/2; y = u; z = v; break
      case 2: x = u; y = side/2; z = v; break
      case 3: x = u; y = -side/2; z = v; break
      case 4: x = u; y = v; z = side/2; break
      default: x = u; y = v; z = -side/2; break
    }
    return { x, y, z }
  },
  pyramid: (i, total, radius) => {
    // Tetrahedron-like pyramid with 4 triangular faces
    const h = radius * 1.3
    const base = radius * 1.1
    const rand = Math.random()
    
    if (rand < 0.25) {
      // Apex
      return { x: 0, y: -h * 0.5, z: 0 }
    } else {
      // Triangular base edges
      const edge = Math.floor(Math.random() * 3)
      const t = Math.random()
      const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
      const a1 = angles[edge]
      const a2 = angles[(edge + 1) % 3]
      
      if (Math.random() < 0.5) {
        // Base edge
        const x = base * (Math.cos(a1) * (1 - t) + Math.cos(a2) * t)
        const z = base * (Math.sin(a1) * (1 - t) + Math.sin(a2) * t)
        return { x, y: h * 0.5, z }
      } else {
        // Side edge to apex
        const x = base * Math.cos(a1) * (1 - t)
        const z = base * Math.sin(a1) * (1 - t)
        const y = h * 0.5 - t * h
        return { x, y, z }
      }
    }
  },
  torus: (i, total, radius) => {
    const R = radius * 0.75 // Major radius (ring)
    const r = radius * 0.3 // Minor radius (tube thickness)
    const u = Math.random() * Math.PI * 2
    const v = Math.random() * Math.PI * 2
    return {
      x: (R + r * Math.cos(v)) * Math.cos(u),
      y: r * Math.sin(v),
      z: (R + r * Math.cos(v)) * Math.sin(u)
    }
  },
  hexagon: (i, total, radius) => {
    // 3D Hexagonal prism
    const h = radius * 1.0 // Height
    const r = radius * 0.9 // Hexagon radius
    const sides = 6
    const rand = Math.random()
    
    if (rand < 0.3) {
      // Top or bottom hexagon face
      const onTop = Math.random() < 0.5
      const y = onTop ? -h/2 : h/2
      const corner = Math.floor(Math.random() * sides)
      const t = Math.random()
      const a1 = (corner / sides) * Math.PI * 2
      const a2 = ((corner + 1) / sides) * Math.PI * 2
      // Random point on edge or interior
      if (Math.random() < 0.5) {
        const x = r * (Math.cos(a1) * (1 - t) + Math.cos(a2) * t)
        const z = r * (Math.sin(a1) * (1 - t) + Math.sin(a2) * t)
        return { x, y, z }
      } else {
        const scale = Math.random()
        const angle = Math.random() * Math.PI * 2
        return { x: r * scale * Math.cos(angle), y, z: r * scale * Math.sin(angle) }
      }
    } else {
      // Side faces
      const face = Math.floor(Math.random() * sides)
      const a1 = (face / sides) * Math.PI * 2
      const a2 = ((face + 1) / sides) * Math.PI * 2
      const t = Math.random()
      const yPos = (Math.random() - 0.5) * h
      const x = r * (Math.cos(a1) * (1 - t) + Math.cos(a2) * t)
      const z = r * (Math.sin(a1) * (1 - t) + Math.sin(a2) * t)
      return { x, y: yPos, z }
    }
  },
  octahedron: (i, total, radius) => {
    // 8-faced diamond shape
    const h = radius * 1.2
    const w = radius * 0.9
    const rand = Math.random()
    
    // Pick a face (8 triangular faces)
    const face = Math.floor(rand * 8)
    const isTop = face < 4
    const quadrant = face % 4
    
    const angles = [0, Math.PI/2, Math.PI, 3*Math.PI/2]
    const a1 = angles[quadrant]
    const a2 = angles[(quadrant + 1) % 4]
    
    const t1 = Math.random()
    const t2 = Math.random() * (1 - t1)
    
    // Barycentric interpolation on triangle
    const apex = { x: 0, y: isTop ? -h/2 : h/2, z: 0 }
    const p1 = { x: w * Math.cos(a1), y: 0, z: w * Math.sin(a1) }
    const p2 = { x: w * Math.cos(a2), y: 0, z: w * Math.sin(a2) }
    
    return {
      x: apex.x * t1 + p1.x * t2 + p2.x * (1 - t1 - t2),
      y: apex.y * t1 + p1.y * t2 + p2.y * (1 - t1 - t2),
      z: apex.z * t1 + p1.z * t2 + p2.z * (1 - t1 - t2)
    }
  },
  star: (i, total, radius) => {
    // 3D star burst with spikes
    const points = 8
    const angle = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const spike = Math.floor(Math.random() * points)
    const spikeAngle = (spike / points) * Math.PI * 2
    const angularDist = Math.min(
      Math.abs(angle - spikeAngle),
      Math.abs(angle - spikeAngle + Math.PI * 2),
      Math.abs(angle - spikeAngle - Math.PI * 2)
    )
    const isSpikeArea = angularDist < 0.25
    const r = isSpikeArea ? radius * (1.3 + Math.random() * 0.7) : radius * (0.4 + Math.random() * 0.4)
    return {
      x: r * Math.sin(phi) * Math.cos(angle),
      y: r * Math.sin(phi) * Math.sin(angle),
      z: r * Math.cos(phi)
    }
  },
  scatter: (i, total, radius) => {
    // Scattered/disintegrated state - particles spread out
    const r = radius * (1.8 + Math.random() * 1.5)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi)
    }
  }
}

// Shape order: sphere → cube → torus → hexagon → pyramid → octahedron → star (text interspersed)
// The animation will automatically scatter between each formation
const BASE_SHAPES = ['sphere', 'cube', 'torus', 'hexagon', 'pyramid', 'octahedron', 'star']

// Animation phases: HOLDING (showing shape) → SCATTERING (dispersing) → MORPHING (forming new shape)
const PHASE = {
  HOLDING: 'holding',      // Particles are stationary showing shape/text
  SCATTERING: 'scattering', // Particles dispersing outward
  MORPHING: 'morphing'      // Particles forming new shape
}

export default function GlobalAILoadingOverlay() {
  const { isAILoading, transitionComplete } = useAILoading()
  const { theme } = useTheme()
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const particlesRef = useRef([])
  const morphProgressRef = useRef(0)
  const [mounted, setMounted] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [blurAmount, setBlurAmount] = useState(1)
  const [showBlur, setShowBlur] = useState(false) // Control blur visibility
  
  // Get theme colors for particles - use primary 500 (lighter) and 800 (darker)
  const themeColorsRef = useRef({
    light: { r: 129, g: 193, b: 181 }, // fallback #81C1B5
    dark: { r: 47, g: 109, b: 123 }    // fallback #2F6D7B
  })
  
  // Update theme colors when theme changes
  useEffect(() => {
    if (theme?.primary) {
      // Parse hex colors from theme
      const parseHex = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
        } : null
      }
      
      const lightColor = parseHex(theme.primary[400]) || parseHex(theme.primary[500])
      const darkColor = parseHex(theme.primary[700]) || parseHex(theme.primary[800])
      
      if (lightColor && darkColor) {
        themeColorsRef.current = { light: lightColor, dark: darkColor }
      }
    }
  }, [theme])

  // Pulsating blur effect (1px - 20px) - only after transition completes
  useEffect(() => {
    if (!isVisible || !showBlur) return
    
    let startTime = Date.now()
    let blurAnimFrame = null
    
    const animateBlur = () => {
      const elapsed = (Date.now() - startTime) * 0.001
      const blur = 1 + (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * 19
      setBlurAmount(blur)
      blurAnimFrame = requestAnimationFrame(animateBlur)
    }
    
    animateBlur()
    
    return () => {
      if (blurAnimFrame) cancelAnimationFrame(blurAnimFrame)
    }
  }, [isVisible, showBlur])

  // Start blur when transition completes - with additional delay for smoother transition
  useEffect(() => {
    if (transitionComplete && isAILoading) {
      // Add extra delay for the blur to fade in smoothly after particle sphere forms
      const timer = setTimeout(() => {
        setShowBlur(true)
      }, 400) // 400ms delay after transition completes
      return () => clearTimeout(timer)
    } else if (!isAILoading) {
      setShowBlur(false)
    }
  }, [transitionComplete, isAILoading])

  // Handle visibility transitions - wait for transition to complete before showing
  useEffect(() => {
    if (isAILoading && transitionComplete) {
      setIsVisible(true)
      setIsAnimatingOut(false)
    } else if (!isAILoading && isVisible) {
      setIsAnimatingOut(true)
      const timer = setTimeout(() => {
        setIsVisible(false)
        setIsAnimatingOut(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isAILoading, transitionComplete, isVisible])

  useEffect(() => {
    setMounted(true)
  }, [])

  // Morphing 3D Shape Animation
  useEffect(() => {
    if (!isVisible || !canvasRef.current || !mounted) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { alpha: true })
    
    const getBaseRadius = () => {
      const minDim = Math.min(window.innerWidth, window.innerHeight)
      return Math.min(160, Math.max(90, minDim * 0.14))
    }
    
    let baseRadius = getBaseRadius()
    // Increased particles for denser text formations while maintaining performance
    const PARTICLE_COUNT = 1500
    const LERP_SPEED = 0.16
    const SCATTER_LERP_SPEED = 0.20
    const Z_PERSPECTIVE = 400
    const HOLD_DURATION = 1400
    const TEXT_HOLD_DURATION = 3200
    const SCATTER_DURATION = 1500
    const MORPH_DURATION = 450
    
    // Initial spin blending - start fast to match MiraTransitionOverlay handoff
    const INITIAL_SPIN_DURATION = 600
    let animationStartTime = Date.now()
    let initialSpinOffset = 0
    
    // Track current state
    let currentShapeIndex = 0
    let currentMessageIndex = Math.floor(Math.random() * AI_MESSAGES.length)
    let showTextNext = true
    let currentPhase = PHASE.HOLDING
    let phaseStartTime = Date.now()
    let lastFrameTime = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) // Cap DPR for performance
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      baseRadius = getBaseRadius()
    }

    // Initialize particles with targets
    const initParticles = () => {
      particlesRef.current = []
      const shapeFn = SHAPES.sphere
      
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pos = shapeFn(i, PARTICLE_COUNT, baseRadius)
        particlesRef.current.push({
          x: pos.x, y: pos.y, z: pos.z,
          targetX: pos.x, targetY: pos.y, targetZ: pos.z,
          baseTargetX: pos.x, baseTargetY: pos.y, baseTargetZ: pos.z, // Store base position for oscillation
          size: Math.random() * 1 + 0.8,
          hueOffset: Math.random() * 60 - 30,
          phaseOffset: Math.random() * Math.PI * 2,
          // Oscillation properties
          oscillate: false,
          oscillateSpeed: 1 + Math.random() * 2,
          oscillateAmount: 3 + Math.random() * 5,
          oscillatePhase: Math.random() * Math.PI * 2,
          // Store scatter target for each particle
          scatterX: 0, scatterY: 0, scatterZ: 0
        })
      }
    }

    // Set scatter targets - particles fly outward
    const setScatterTargets = () => {
      particlesRef.current.forEach((p) => {
        const scatterPos = SHAPES.scatter(0, PARTICLE_COUNT, baseRadius)
        p.scatterX = scatterPos.x
        p.scatterY = scatterPos.y
        p.scatterZ = scatterPos.z
        p.targetX = p.scatterX
        p.targetY = p.scatterY
        p.targetZ = p.scatterZ
        p.oscillate = false // No oscillation during scatter
      })
    }

    // Update particle targets for new shape or text
    const setNewShapeTargets = (isText) => {
      if (isText) {
        // Get next message (cycle through)
        currentMessageIndex = (currentMessageIndex + 1) % AI_MESSAGES.length
        const message = AI_MESSAGES[currentMessageIndex]
        
        // Calculate scale based on screen width - bezier font uses different scaling
        const maxWidth = window.innerWidth * 0.65
        const minDim = Math.min(window.innerWidth, window.innerHeight)
        // Scale factor for bezier curves (larger numbers = bigger text)
        const scale = Math.min(Math.max(minDim * 0.045, 28), 50)
        
        // Get particle positions for text
        const textParticles = textToParticles(message, scale, 0, 0)
        
        // Assign text positions to particles
        particlesRef.current.forEach((p, i) => {
          if (textParticles.length > 0) {
            const tp = textParticles[i % textParticles.length]
            const baseX = tp.x
            const baseY = tp.y
            const baseZ = tp.z || (Math.random() - 0.5) * 8
            
            p.targetX = baseX
            p.targetY = baseY
            p.targetZ = baseZ
            p.baseTargetX = baseX
            p.baseTargetY = baseY
            p.baseTargetZ = baseZ
            
            // Transfer oscillation properties from text particle
            p.oscillate = tp.oscillate || false
            p.oscillateSpeed = tp.oscillateSpeed || (1 + Math.random() * 2)
            p.oscillateAmount = tp.oscillateAmount || (scale * 0.4)
            p.oscillatePhase = Math.random() * Math.PI * 2
          }
        })
      } else {
        // Regular 3D shape - no oscillation
        const shapeName = BASE_SHAPES[currentShapeIndex % BASE_SHAPES.length]
        const shapeFn = SHAPES[shapeName]
        particlesRef.current.forEach((p, i) => {
          const newPos = shapeFn(i, PARTICLE_COUNT, baseRadius)
          p.targetX = newPos.x
          p.targetY = newPos.y
          p.targetZ = newPos.z
          p.baseTargetX = newPos.x
          p.baseTargetY = newPos.y
          p.baseTargetZ = newPos.z
          p.oscillate = false
        })
      }
    }

    let isTextMode = false // Track if currently showing text
    
    const animate = (currentTime) => {
      // Delta time for consistent animation across frame rates
      const dt = Math.min((currentTime - lastFrameTime) / 16.67, 2)
      lastFrameTime = currentTime
      
      const width = window.innerWidth
      const height = window.innerHeight
      const cx = width / 2
      const cy = height / 2
      const time = currentTime * 0.001
      
      ctx.clearRect(0, 0, width, height)
      
      // Phase state machine
      const elapsed = Date.now() - phaseStartTime
      
      if (currentPhase === PHASE.HOLDING) {
        // After holding, start scattering
        const holdTime = isTextMode ? TEXT_HOLD_DURATION : HOLD_DURATION
        if (elapsed > holdTime) {
          currentPhase = PHASE.SCATTERING
          phaseStartTime = Date.now()
          setScatterTargets()
        }
        
        // Apply oscillation to particles during text mode holding (optimized loop)
        if (isTextMode) {
          const particles = particlesRef.current
          for (let i = 0; i < particles.length; i++) {
            const p = particles[i]
            if (p.oscillate) {
              const oscTime = time * p.oscillateSpeed + p.oscillatePhase
              const osc = Math.sin(oscTime) * p.oscillateAmount
              p.targetX = p.baseTargetX + osc * 0.5
              p.targetY = p.baseTargetY + Math.cos(oscTime * 0.7) * p.oscillateAmount * 0.3
            }
          }
        }
      } else if (currentPhase === PHASE.SCATTERING) {
        // After scattering, start morphing into new shape
        if (elapsed > SCATTER_DURATION) {
          currentPhase = PHASE.MORPHING
          phaseStartTime = Date.now()
          
          // Decide next formation: alternate between shapes and text
          if (showTextNext) {
            isTextMode = true
            setNewShapeTargets(true) // Show text
          } else {
            isTextMode = false
            currentShapeIndex = (currentShapeIndex + 1) % BASE_SHAPES.length
            setNewShapeTargets(false) // Show shape
          }
          showTextNext = !showTextNext
        }
      } else if (currentPhase === PHASE.MORPHING) {
        // After morphing complete, start holding
        if (elapsed > MORPH_DURATION) {
          currentPhase = PHASE.HOLDING
          phaseStartTime = Date.now()
        }
      }
      
      // Determine lerp speed based on phase - scale by delta time
      const baseLerpSpeed = currentPhase === PHASE.SCATTERING ? SCATTER_LERP_SPEED : LERP_SPEED
      const currentLerpSpeed = 1 - Math.pow(1 - baseLerpSpeed, dt)
      
      // Calculate initial spin offset (fast spin that slows down to blend with transition)
      const timeSinceStart = Date.now() - animationStartTime
      if (timeSinceStart < INITIAL_SPIN_DURATION) {
        const spinProgress = timeSinceStart / INITIAL_SPIN_DURATION
        const easeOutQuad = 1 - (1 - spinProgress) * (1 - spinProgress)
        // Start fast (0.2) to match MiraTransitionOverlay handoff, decay to normal
        const extraSpeed = 0.2 * (1 - easeOutQuad) * dt
        initialSpinOffset += extraSpeed
      }
      
      // Rotation - reduce for text mode to keep readable
      const rotationScale = isTextMode ? 0.1 : 1
      const autoRotX = Math.sin(time * 0.5) * 0.25 * rotationScale
      const autoRotY = isTextMode ? 0 : (time * 0.4 + initialSpinOffset)
      const autoRotZ = Math.sin(time * 0.3) * 0.15 * rotationScale

      // Pre-compute rotation matrices for performance
      const cosRotY = Math.cos(autoRotY), sinRotY = Math.sin(autoRotY)
      const cosRotX = Math.cos(autoRotX), sinRotX = Math.sin(autoRotX)
      const cosRotZ = Math.cos(autoRotZ), sinRotZ = Math.sin(autoRotZ)

      // Build projection array without sorting every frame (sort every 3rd frame)
      const frameCount = Math.floor(time * 60) % 3
      const particles = particlesRef.current

      // Update positions first (always)
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        // Move towards target with delta-time adjusted speed
        p.x += (p.targetX - p.x) * currentLerpSpeed
        p.y += (p.targetY - p.y) * currentLerpSpeed
        p.z += (p.targetZ - p.z) * currentLerpSpeed
      }

      // Only sort occasionally for depth ordering (reduces sort overhead by 66%)
      if (frameCount === 0) {
        particles.sort((a, b) => b.z - a.z)
      }

      // Batch draw setup
      const { light, dark } = themeColorsRef.current
      const PI2 = Math.PI * 2

      // Draw all particles - optimized with single path per color batch
      // Group by approximate color to reduce fillStyle changes
      const colorBuckets = new Map()

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        // Apply rotation for display (optimized with pre-computed trig)
        let rx = p.x, ry = p.y, rz = p.z
        
        // Y rotation
        let nx = rx * cosRotY - rz * sinRotY
        let nz = rx * sinRotY + rz * cosRotY
        rx = nx; rz = nz
        
        // X rotation
        let ny = ry * cosRotX - rz * sinRotX
        nz = ry * sinRotX + rz * cosRotX
        ry = ny; rz = nz
        
        // Z rotation
        nx = rx * cosRotZ - ry * sinRotZ
        ny = rx * sinRotZ + ry * cosRotZ
        rx = nx; ry = ny

        // Project to 2D
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + rz)
        if (rz > -Z_PERSPECTIVE + 10 && scale > 0) {
          // Color: interpolate between theme colors (quantize to reduce unique colors)
          const colorPhase = (Math.sin(time + p.phaseOffset) * 0.5 + 0.5)
          // Quantize to 16 color levels for batching
          const r = Math.floor((dark.r + colorPhase * (light.r - dark.r) + p.hueOffset * 0.2) / 16) * 16
          const g = Math.floor((dark.g + colorPhase * (light.g - dark.g) + p.hueOffset * 0.3) / 16) * 16
          const b = Math.floor((dark.b + colorPhase * (light.b - dark.b) + p.hueOffset * 0.2) / 16) * 16
          
          const colorKey = `${Math.min(255, Math.max(0, r))},${Math.min(255, Math.max(0, g))},${Math.min(255, Math.max(0, b))}`
          
          if (!colorBuckets.has(colorKey)) {
            colorBuckets.set(colorKey, [])
          }
          colorBuckets.get(colorKey).push({
            x: cx + rx * scale,
            y: cy + ry * scale,
            r: Math.max(0.2, p.size * scale)
          })
        }
      }

      // Draw batched by color - significantly reduces ctx state changes
      for (const [colorKey, circles] of colorBuckets) {
        ctx.fillStyle = `rgb(${colorKey})`
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

    resize()
    initParticles()
    animationRef.current = requestAnimationFrame(animate)

    window.addEventListener('resize', resize)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [isVisible, mounted])

  if (!isVisible || !mounted) return null

  return (
    <>
      {/* Backdrop blur layer - blurs content behind overlay - only after transition */}
      {showBlur && (
        <div 
          className={`fixed inset-0 z-[999998] ${
            isAnimatingOut ? 'ai-loading-exit' : 'ai-blur-enter'
          }`}
          style={{
            backdropFilter: `blur(${blurAmount}px)`,
            WebkitBackdropFilter: `blur(${blurAmount}px)`,
            backgroundColor: 'rgba(0, 0, 0, 0.08)',
          }}
        />
      )}
      
      {/* Main overlay container */}
      <div 
        className={`fixed inset-0 z-[999999] pointer-events-auto ${
          isAnimatingOut ? 'ai-loading-exit' : 'ai-loading-enter'
        }`}
      >
        {/* Morphing 3D shape particles */}
        <canvas 
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ background: 'transparent' }}
        />
      </div>

      <style jsx global>{`
        .ai-loading-enter {
          animation: aiLoadingEnter 0.4s ease-out forwards;
        }

        @keyframes aiLoadingEnter {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        .ai-blur-enter {
          animation: aiBlurEnter 0.8s ease-out forwards;
        }

        @keyframes aiBlurEnter {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        .ai-loading-exit {
          animation: aiLoadingExit 0.4s ease-in forwards;
        }

        @keyframes aiLoadingExit {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  )
}
