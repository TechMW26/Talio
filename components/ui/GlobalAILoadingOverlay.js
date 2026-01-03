'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAILoading } from '@/contexts/AILoadingContext'

/**
 * Global AI Loading Animation Overlay
 * 
 * Features:
 * - Animated mesh gradient background (magenta, blue, black, red)
 * - Pulsating backdrop blur (1px - 20px)
 * - Morphing 3D shapes (sphere → cube → pyramid → star → back)
 * - Particles disintegrate and reintegrate showing "thinking"
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

// Shape order: sphere → scatter → cube → scatter → torus → scatter → hexagon → scatter → pyramid → scatter → octahedron → scatter → star → scatter
const SHAPE_ORDER = ['sphere', 'scatter', 'cube', 'scatter', 'torus', 'scatter', 'hexagon', 'scatter', 'pyramid', 'scatter', 'octahedron', 'scatter', 'star', 'scatter']

// Preload audio on module load (client-side only)
let aiAnalysisAudio = null
if (typeof window !== 'undefined') {
  aiAnalysisAudio = new Audio('/sounds/ai-analysis.mp3')
  aiAnalysisAudio.preload = 'auto'
  aiAnalysisAudio.loop = true
  aiAnalysisAudio.volume = 0.5
}

export default function GlobalAILoadingOverlay() {
  const { isAILoading } = useAILoading()
  const canvasRef = useRef(null)
  const gradientCanvasRef = useRef(null)
  const animationRef = useRef(null)
  const gradientAnimRef = useRef(null)
  const particlesRef = useRef([])
  const shapeIndexRef = useRef(0)
  const morphProgressRef = useRef(0)
  const audioRef = useRef(aiAnalysisAudio)
  const [mounted, setMounted] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [blurAmount, setBlurAmount] = useState(1)

  // Play/stop audio based on visibility
  useEffect(() => {
    if (!audioRef.current) return
    
    if (isVisible && !isAnimatingOut) {
      // Reset and play audio
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(err => {
        // Autoplay may be blocked by browser policy, ignore silently
        console.log('[AI Loading] Audio autoplay blocked:', err.message)
      })
    } else {
      // Fade out and stop audio
      const fadeOut = () => {
        if (audioRef.current.volume > 0.05) {
          audioRef.current.volume = Math.max(0, audioRef.current.volume - 0.05)
          requestAnimationFrame(fadeOut)
        } else {
          audioRef.current.pause()
          audioRef.current.volume = 0.5 // Reset volume for next play
        }
      }
      fadeOut()
    }
  }, [isVisible, isAnimatingOut])

  // Pulsating blur effect (1px - 20px)
  useEffect(() => {
    if (!isVisible) return
    
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
  }, [isVisible])

  // Animated mesh gradient background - reactive to AI thinking
  useEffect(() => {
    if (!isVisible || !gradientCanvasRef.current || !mounted) return

    const canvas = gradientCanvasRef.current
    const ctx = canvas.getContext('2d')
    
    // Gradient blob positions - will react to "thinking" intensity
    const blobs = [
      { x: 0.2, y: 0.3, vx: 0.0006, vy: 0.0008, color: [255, 0, 100, 0.3], radius: 0.5, baseSpeed: 1 },   // Magenta
      { x: 0.8, y: 0.2, vx: -0.0008, vy: 0.0006, color: [0, 100, 255, 0.3], radius: 0.55, baseSpeed: 1.2 },  // Blue
      { x: 0.5, y: 0.8, vx: 0.0004, vy: -0.0006, color: [180, 0, 255, 0.3], radius: 0.5, baseSpeed: 0.9 }, // Purple
      { x: 0.3, y: 0.6, vx: -0.0006, vy: -0.0004, color: [255, 50, 50, 0.3], radius: 0.45, baseSpeed: 1.1 }, // Red
      { x: 0.7, y: 0.5, vx: 0.0007, vy: 0.0005, color: [0, 150, 180, 0.3], radius: 0.5, baseSpeed: 1 },    // Cyan
      { x: 0.1, y: 0.9, vx: 0.0005, vy: -0.0007, color: [10, 10, 30, 0.3], radius: 0.65, baseSpeed: 0.8 }, // Near black, semi-transparent
    ]
    
    let thinkingIntensity = 0
    let targetIntensity = 1

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }
    
    resize()

    const animateGradient = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const time = Date.now() * 0.001
      
      // Animate thinking intensity with pulsing
      targetIntensity = 0.7 + Math.sin(time * 2) * 0.3
      thinkingIntensity += (targetIntensity - thinkingIntensity) * 0.05
      
      // Clear canvas and set 10% opacity dark base background
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(5, 5, 15, 0.1)'
      ctx.fillRect(0, 0, w, h)
      
      // Update and draw blobs with lighter composite for color mixing
      ctx.globalCompositeOperation = 'lighter'
      
      blobs.forEach((blob, idx) => {
        // Reactive movement - speed increases with thinking intensity
        const speedMultiplier = 1 + thinkingIntensity * 2
        const pulsePhase = time * 3 + idx * 0.5
        const pulse = 1 + Math.sin(pulsePhase) * 0.3 * thinkingIntensity
        
        // Move blob with reactive speed
        blob.x += blob.vx * speedMultiplier * blob.baseSpeed
        blob.y += blob.vy * speedMultiplier * blob.baseSpeed
        
        // Add some swirling motion based on thinking
        blob.x += Math.sin(time * 2 + idx) * 0.001 * thinkingIntensity
        blob.y += Math.cos(time * 2 + idx * 0.7) * 0.001 * thinkingIntensity
        
        // Bounce off edges with energy
        if (blob.x < 0 || blob.x > 1) {
          blob.vx *= -1
          blob.vx += (Math.random() - 0.5) * 0.0004 * thinkingIntensity
        }
        if (blob.y < 0 || blob.y > 1) {
          blob.vy *= -1
          blob.vy += (Math.random() - 0.5) * 0.0004 * thinkingIntensity
        }
        
        // Clamp positions
        blob.x = Math.max(0, Math.min(1, blob.x))
        blob.y = Math.max(0, Math.min(1, blob.y))
        
        // Draw gradient blob with pulsing radius
        const currentRadius = blob.radius * pulse
        const gradient = ctx.createRadialGradient(
          blob.x * w, blob.y * h, 0,
          blob.x * w, blob.y * h, currentRadius * Math.max(w, h)
        )
        
        // Color intensity at 30% max transparency
        const baseAlpha = 0.3 // 30% max transparency
        const colorIntensity = baseAlpha * (0.6 + thinkingIntensity * 0.4)
        gradient.addColorStop(0, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${colorIntensity})`)
        gradient.addColorStop(0.4, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${colorIntensity * 0.5})`)
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
        
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
      })
      
      ctx.globalCompositeOperation = 'source-over'
      
      gradientAnimRef.current = requestAnimationFrame(animateGradient)
    }
    
    animateGradient()
    window.addEventListener('resize', resize)
    
    return () => {
      if (gradientAnimRef.current) cancelAnimationFrame(gradientAnimRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [isVisible, mounted])

  // Handle visibility transitions
  useEffect(() => {
    if (isAILoading) {
      setIsVisible(true)
      setIsAnimatingOut(false)
    } else if (isVisible) {
      setIsAnimatingOut(true)
      const timer = setTimeout(() => {
        setIsVisible(false)
        setIsAnimatingOut(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isAILoading, isVisible])

  useEffect(() => {
    setMounted(true)
  }, [])

  // Morphing 3D Shape Animation
  useEffect(() => {
    if (!isVisible || !canvasRef.current || !mounted) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    
    const getBaseRadius = () => {
      const minDim = Math.min(window.innerWidth, window.innerHeight)
      return Math.min(180, Math.max(100, minDim * 0.18))
    }
    
    let baseRadius = getBaseRadius()
    const PARTICLE_COUNT = 6000 // Increased for denser shapes
    const LERP_SPEED = 0.12 // Direct interpolation speed (no spring)
    const Z_PERSPECTIVE = 500
    const MORPH_DURATION = 1000 // ms per shape transition
    const HOLD_DURATION = 1500 // ms to hold each shape

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
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
      const shapeFn = SHAPES[SHAPE_ORDER[0]]
      
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pos = shapeFn(i, PARTICLE_COUNT, baseRadius)
        particlesRef.current.push({
          x: pos.x, y: pos.y, z: pos.z,
          targetX: pos.x, targetY: pos.y, targetZ: pos.z,
          size: Math.random() * 0.8 + 0.3, // Smaller dots (was 2.2 + 0.4)
          hueOffset: Math.random() * 60 - 30,
          phaseOffset: Math.random() * Math.PI * 2
        })
      }
    }

    // Update particle targets for new shape
    const setNewShapeTargets = (shapeIndex) => {
      const shapeName = SHAPE_ORDER[shapeIndex % SHAPE_ORDER.length]
      const shapeFn = SHAPES[shapeName]
      
      particlesRef.current.forEach((p, i) => {
        const newPos = shapeFn(i, PARTICLE_COUNT, baseRadius)
        p.targetX = newPos.x
        p.targetY = newPos.y
        p.targetZ = newPos.z
      })
    }

    let lastShapeChange = Date.now()
    let isHolding = true
    
    const animate = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const cx = width / 2
      const cy = height / 2
      const time = Date.now() * 0.001
      
      ctx.clearRect(0, 0, width, height)
      
      // Check if we need to transition to next shape
      const elapsed = Date.now() - lastShapeChange
      if (isHolding && elapsed > HOLD_DURATION) {
        isHolding = false
        shapeIndexRef.current = (shapeIndexRef.current + 1) % SHAPE_ORDER.length
        setNewShapeTargets(shapeIndexRef.current)
        lastShapeChange = Date.now()
      } else if (!isHolding && elapsed > MORPH_DURATION) {
        isHolding = true
        lastShapeChange = Date.now()
      }
      
      // Rotation
      const autoRotX = Math.sin(time * 0.5) * 0.25
      const autoRotY = time * 0.4
      const autoRotZ = Math.sin(time * 0.3) * 0.15

      // Sort by Z for depth
      const sorted = [...particlesRef.current].sort((a, b) => b.z - a.z)

      sorted.forEach(p => {
        // Move directly towards target (linear interpolation, no spring)
        p.x += (p.targetX - p.x) * LERP_SPEED
        p.y += (p.targetY - p.y) * LERP_SPEED
        p.z += (p.targetZ - p.z) * LERP_SPEED

        // Apply rotation for display
        let rx = p.x, ry = p.y, rz = p.z
        
        // Y rotation
        let nx = rx * Math.cos(autoRotY) - rz * Math.sin(autoRotY)
        let nz = rx * Math.sin(autoRotY) + rz * Math.cos(autoRotY)
        rx = nx; rz = nz
        
        // X rotation
        let ny = ry * Math.cos(autoRotX) - rz * Math.sin(autoRotX)
        nz = ry * Math.sin(autoRotX) + rz * Math.cos(autoRotX)
        ry = ny; rz = nz
        
        // Z rotation
        nx = rx * Math.cos(autoRotZ) - ry * Math.sin(autoRotZ)
        ny = rx * Math.sin(autoRotZ) + ry * Math.cos(autoRotZ)
        rx = nx; ry = ny

        // Project to 2D
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + rz)
        if (rz > -Z_PERSPECTIVE + 10 && scale > 0) {
          // Color: cyan to magenta based on position - fully opaque
          const colorPhase = (Math.sin(time + p.phaseOffset) * 0.5 + 0.5)
          const r = Math.floor(80 + colorPhase * 150 + p.hueOffset)
          const g = Math.floor(180 - colorPhase * 80 + p.hueOffset * 0.3)
          const b = 255
          
          ctx.beginPath()
          ctx.arc(cx + rx * scale, cy + ry * scale, Math.max(0.2, p.size * scale), 0, Math.PI * 2)
          ctx.fillStyle = `rgb(${Math.min(255, Math.max(0, r))},${Math.min(255, Math.max(0, g))},${b})`
          ctx.fill()
        }
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }

    resize()
    initParticles()
    animate()

    window.addEventListener('resize', resize)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [isVisible, mounted])

  if (!isVisible || !mounted) return null

  return (
    <>
      {/* Backdrop blur layer - blurs content behind overlay */}
      <div 
        className={`fixed inset-0 z-[999998] ${
          isAnimatingOut ? 'ai-loading-exit' : 'ai-loading-enter'
        }`}
        style={{
          backdropFilter: `blur(${blurAmount}px)`,
          WebkitBackdropFilter: `blur(${blurAmount}px)`,
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
        }}
      />
      
      {/* Main overlay container */}
      <div 
        className={`fixed inset-0 z-[999999] pointer-events-auto ${
          isAnimatingOut ? 'ai-loading-exit' : 'ai-loading-enter'
        }`}
      >
        {/* Animated mesh gradient background */}
        <canvas 
          ref={gradientCanvasRef}
          className="absolute inset-0 w-full h-full"
        />

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
