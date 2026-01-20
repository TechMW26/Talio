'use client'

import { useEffect, useRef, memo } from 'react'

/**
 * MiraSphere - Optimized animated particle sphere for the MIRA button
 * Uses the same visual style as GlobalAILoadingOverlay
 * 
 * FEATURES:
 * - Mouse proximity detection (reacts when mouse is near)
 * - Random periodic pulses (random reactivity)
 * - Hover state animation
 * - Delta time for consistent animation across frame rates
 */

// Get theme colors from CSS variables or use defaults
function getThemeColors() {
  if (typeof window === 'undefined') {
    return {
      light: { r: 129, g: 193, b: 181 },
      dark: { r: 47, g: 109, b: 123 }
    }
  }
  
  const style = getComputedStyle(document.documentElement)
  const primary = style.getPropertyValue('--color-primary-500')?.trim()
  const primaryDark = style.getPropertyValue('--color-primary-700')?.trim()
  
  const parseHex = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null
  }
  
  return {
    light: parseHex(primary) || { r: 129, g: 193, b: 181 },
    dark: parseHex(primaryDark) || { r: 47, g: 109, b: 123 }
  }
}

// Generate sphere particles with Fibonacci distribution
function generateSphereParticles(count, radius) {
  const particles = []
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / count)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    
    const x = radius * Math.sin(phi) * Math.cos(theta)
    const y = radius * Math.sin(phi) * Math.sin(theta)
    const z = radius * Math.cos(phi)
    
    particles.push({
      baseX: x, baseY: y, baseZ: z,
      x, y, z,
      vx: 0, vy: 0, vz: 0,
      size: Math.random() * 0.5 + 0.6,
      hueOffset: Math.random() * 60 - 30,
      phaseOffset: Math.random() * Math.PI * 2,
      randX: (Math.random() - 0.5) * 2,
      randY: (Math.random() - 0.5) * 2,
      randZ: (Math.random() - 0.5) * 2,
    })
  }
  return particles
}

const MiraSphere = memo(function MiraSphere({ 
  size = 55, 
  isHovered = false, 
  className = '',
  particleCount = 150,
  enableProximity = true,
  enableRandomPulse = true,
  proximityRadius = 150,
  isThinking = false // Aggressive thinking animation mode
}) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const particlesRef = useRef([])
  const isHoveredRef = useRef(false)
  const isThinkingRef = useRef(false)
  const colorsRef = useRef(null)
  const mouseProximityRef = useRef(0) // 0 to 1, how close mouse is
  const randomPulseRef = useRef(0) // 0 to 1, random pulse intensity
  const nextPulseTimeRef = useRef(0)
  const canvasBoundsRef = useRef(null)
  const thinkingPhaseRef = useRef(0) // Tracks thinking animation phase
  
  useEffect(() => {
    isHoveredRef.current = isHovered
  }, [isHovered])

  useEffect(() => {
    isThinkingRef.current = isThinking
  }, [isThinking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const baseRadius = size * 0.30 * dpr
    const Z_PERSPECTIVE = size * 3
    const MAX_DISTANCE = size * 0.45 * dpr

    const SPRING_TENSION = 0.07
    const SPRING_DAMPING = 0.86
    const DISINTEGRATE_FORCE = 0.28
    const VIBRATE_STRENGTH = 1.3

    particlesRef.current = generateSphereParticles(particleCount, baseRadius)
    colorsRef.current = getThemeColors()

    // Mouse proximity tracking
    const handleMouseMove = (e) => {
      if (!enableProximity) return
      
      const rect = canvas.getBoundingClientRect()
      canvasBoundsRef.current = rect
      
      const canvasCenterX = rect.left + rect.width / 2
      const canvasCenterY = rect.top + rect.height / 2
      
      const dx = e.clientX - canvasCenterX
      const dy = e.clientY - canvasCenterY
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // Calculate proximity (1 = very close, 0 = far away)
      const proximity = Math.max(0, 1 - distance / proximityRadius)
      mouseProximityRef.current = proximity * proximity // Quadratic falloff for smoother feel
    }

    if (enableProximity) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true })
    }

    // Schedule first random pulse
    if (enableRandomPulse) {
      nextPulseTimeRef.current = performance.now() + 2000 + Math.random() * 4000
    }

    let rotationAngle = 0
    let lastTime = performance.now()

    const animate = (currentTime) => {
      const dt = Math.min((currentTime - lastTime) / 16.67, 2)
      lastTime = currentTime
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const time = currentTime * 0.001
      const hovered = isHoveredRef.current
      const mouseProximity = mouseProximityRef.current
      const thinking = isThinkingRef.current
      
      // Handle random pulses (only when not in thinking mode)
      if (enableRandomPulse && !thinking) {
        if (currentTime >= nextPulseTimeRef.current && randomPulseRef.current === 0) {
          // Start a new pulse
          randomPulseRef.current = 1
          // Schedule next pulse (random interval between 3-8 seconds)
          nextPulseTimeRef.current = currentTime + 3000 + Math.random() * 5000
        }
        
        // Decay the pulse
        if (randomPulseRef.current > 0) {
          randomPulseRef.current = Math.max(0, randomPulseRef.current - 0.02 * dt)
        }
      }
      
      const randomPulse = randomPulseRef.current
      
      // THINKING MODE: Aggressive, oscillating, chaotic animations
      let thinkingIntensity = 0
      let thinkingOscillation = 0
      let thinkingChaos = 0
      
      if (thinking) {
        thinkingPhaseRef.current += dt * 0.08
        const phase = thinkingPhaseRef.current
        
        // Multi-layered oscillation for aggressive effect
        thinkingOscillation = Math.sin(phase * 3) * 0.3 + Math.sin(phase * 7) * 0.2 + Math.sin(phase * 13) * 0.1
        thinkingIntensity = 0.6 + thinkingOscillation * 0.4 // Oscillates between 0.2 and 1.0
        thinkingChaos = Math.sin(phase * 5) * 0.5 + 0.5 // Chaos factor for randomization
      }
      
      // Combined reactivity: thinking mode takes priority, then hover OR mouse proximity OR random pulse
      const reactivity = thinking ? thinkingIntensity : Math.max(
        hovered ? 1 : 0,
        mouseProximity * 0.7, // Proximity is slightly less intense
        randomPulse * 0.5 // Random pulses are gentler
      )
      
      // Faster, more erratic rotation when thinking
      const rotationSpeed = thinking 
        ? 0.015 + thinkingOscillation * 0.02 + Math.sin(time * 8) * 0.005
        : 0.006 + reactivity * 0.012
      rotationAngle += rotationSpeed * dt
      const cosR = Math.cos(rotationAngle)
      const sinR = Math.sin(rotationAngle)
      
      const { light, dark } = colorsRef.current
      
      particlesRef.current.forEach((p, pIndex) => {
        if (reactivity > 0.05) {
          // Reactive state - particles disperse/vibrate
          const intensity = reactivity
          
          // THINKING MODE: More aggressive, chaotic, randomized movements
          let vibMultiplier = 1
          let forceMultiplier = 1
          let randomFactor = 0
          
          if (thinking) {
            // Add per-particle randomization for chaotic effect
            const particlePhase = thinkingPhaseRef.current + pIndex * 0.1
            vibMultiplier = 1.5 + Math.sin(particlePhase * 11) * 0.5
            forceMultiplier = 1.2 + thinkingChaos * 0.8
            randomFactor = Math.sin(particlePhase * 17 + p.phaseOffset) * 0.1
            
            // Occasionally give particles sudden bursts (less intense)
            if (Math.sin(particlePhase * 23 + pIndex) > 0.95) {
              forceMultiplier *= 1.8
            }
          }
          
          const vibSpeed = thinking ? 15 + thinkingOscillation * 10 : 10
          const vibX = Math.sin(time * vibSpeed + p.phaseOffset) * VIBRATE_STRENGTH * intensity * vibMultiplier
          const vibY = Math.cos(time * vibSpeed + p.phaseOffset * 1.3) * VIBRATE_STRENGTH * intensity * vibMultiplier
          const vibZ = Math.sin(time * vibSpeed + p.phaseOffset * 0.7) * VIBRATE_STRENGTH * intensity * vibMultiplier
          
          p.vx += (p.randX * DISINTEGRATE_FORCE * intensity * forceMultiplier + vibX * 0.05 + randomFactor) * dt
          p.vy += (p.randY * DISINTEGRATE_FORCE * intensity * forceMultiplier + vibY * 0.05 + randomFactor) * dt
          p.vz += (p.randZ * DISINTEGRATE_FORCE * intensity * forceMultiplier + vibZ * 0.05 + randomFactor) * dt
          
          // Less dampening in thinking mode for more sustained chaos
          const baseDamp = thinking ? 0.90 : 0.91
          const dampening = Math.pow(baseDamp, dt)
          p.vx *= dampening
          p.vy *= dampening
          p.vz *= dampening
          
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
          
          // Contain particles - slightly larger spread in thinking mode but not too much
          const distMultiplier = thinking ? 1.15 + thinkingOscillation * 0.15 : 1
          const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
          const maxDist = MAX_DISTANCE * (1 + intensity * 0.2) * distMultiplier
          if (dist > maxDist) {
            const scale = maxDist / dist
            p.x *= scale
            p.y *= scale
            p.z *= scale
            p.vx *= -0.3
            p.vy *= -0.3
            p.vz *= -0.3
          }
        } else {
          // Return to sphere formation
          const dx = p.baseX - p.x
          const dy = p.baseY - p.y
          const dz = p.baseZ - p.z
          
          p.vx += dx * SPRING_TENSION * dt
          p.vy += dy * SPRING_TENSION * dt
          p.vz += dz * SPRING_TENSION * dt
          
          p.vx *= Math.pow(SPRING_DAMPING, dt)
          p.vy *= Math.pow(SPRING_DAMPING, dt)
          p.vz *= Math.pow(SPRING_DAMPING, dt)
          
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
        }
        
        // Rotate for display
        let rx = p.x * cosR - p.z * sinR
        let rz = p.x * sinR + p.z * cosR
        let ry = p.y
        
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + rz)
        if (scale > 0 && rz > -Z_PERSPECTIVE + 10) {
          const sx = cx + rx * scale
          const sy = cy + ry * scale
          
          // Larger, more varied particles in thinking mode
          const sizeBoost = thinking ? 1 + thinkingOscillation * 0.4 : 1
          const particleSize = Math.max(0.5, p.size * scale * dpr * (1 + reactivity * 0.2) * sizeBoost)
          
          // Faster, more dramatic color cycling in thinking mode
          const colorSpeed = thinking ? 5 + thinkingOscillation * 3 : 2
          const colorPhase = (Math.sin(time * colorSpeed + p.phaseOffset) * 0.5 + 0.5)
          
          // More vibrant, pulsing colors when thinking
          const brightnessBoost = thinking 
            ? 50 + thinkingOscillation * 40 // Pulsing brightness
            : reactivity * 30
          
          // Add purple/magenta tint when thinking for more dramatic effect
          const thinkingTintR = thinking ? 30 + thinkingOscillation * 20 : 0
          const thinkingTintB = thinking ? 50 + thinkingOscillation * 30 : 0
          
          const r = Math.floor(dark.r + colorPhase * (light.r - dark.r) + p.hueOffset * 0.15 + brightnessBoost + thinkingTintR)
          const g = Math.floor(dark.g + colorPhase * (light.g - dark.g) + p.hueOffset * 0.2 + brightnessBoost * 0.7)
          const b = Math.floor(dark.b + colorPhase * (light.b - dark.b) + p.hueOffset * 0.15 + brightnessBoost + thinkingTintB)
          const alpha = thinking 
            ? 0.7 + (rz / (baseRadius * 2)) * 0.3 + thinkingOscillation * 0.2
            : 0.65 + (rz / (baseRadius * 2)) * 0.35 + reactivity * 0.15
          
          ctx.beginPath()
          ctx.arc(sx, sy, particleSize, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${Math.min(255, Math.max(0, r))},${Math.min(255, Math.max(0, g))},${Math.min(255, Math.max(0, b))},${Math.min(1, alpha)})`
          ctx.fill()
        }
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (enableProximity) {
        window.removeEventListener('mousemove', handleMouseMove)
      }
    }
  }, [size, particleCount, enableProximity, enableRandomPulse, proximityRadius, isThinking])

  return (
    <canvas
      ref={canvasRef}
      className={`block ${className}`}
      style={{ width: size, height: size }}
    />
  )
})

export default MiraSphere

export { generateSphereParticles, getThemeColors }