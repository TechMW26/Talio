'use client'

import { useEffect, useRef, memo } from 'react'

/**
 * MiraSphere - Optimized animated particle sphere for the MIRA button
 * Uses the same visual style as GlobalAILoadingOverlay
 * 
 * PERFORMANCE: Uses delta time for consistent animation across frame rates
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
  particleCount = 150
}) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const particlesRef = useRef([])
  const isHoveredRef = useRef(false)
  const colorsRef = useRef(null)
  
  useEffect(() => {
    isHoveredRef.current = isHovered
  }, [isHovered])

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

    let rotationAngle = 0
    let lastTime = performance.now()

    const animate = (currentTime) => {
      const dt = Math.min((currentTime - lastTime) / 16.67, 2)
      lastTime = currentTime
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const time = currentTime * 0.001
      const hovered = isHoveredRef.current
      
      rotationAngle += 0.006 * dt
      const cosR = Math.cos(rotationAngle)
      const sinR = Math.sin(rotationAngle)
      
      const { light, dark } = colorsRef.current
      
      particlesRef.current.forEach(p => {
        if (hovered) {
          const vibX = Math.sin(time * 10 + p.phaseOffset) * VIBRATE_STRENGTH
          const vibY = Math.cos(time * 10 + p.phaseOffset * 1.3) * VIBRATE_STRENGTH
          const vibZ = Math.sin(time * 10 + p.phaseOffset * 0.7) * VIBRATE_STRENGTH
          
          p.vx += (p.randX * DISINTEGRATE_FORCE + vibX * 0.05) * dt
          p.vy += (p.randY * DISINTEGRATE_FORCE + vibY * 0.05) * dt
          p.vz += (p.randZ * DISINTEGRATE_FORCE + vibZ * 0.05) * dt
          
          p.vx *= Math.pow(0.91, dt)
          p.vy *= Math.pow(0.91, dt)
          p.vz *= Math.pow(0.91, dt)
          
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
          
          const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
          if (dist > MAX_DISTANCE) {
            const scale = MAX_DISTANCE / dist
            p.x *= scale
            p.y *= scale
            p.z *= scale
            p.vx *= -0.3
            p.vy *= -0.3
            p.vz *= -0.3
          }
        } else {
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
          const particleSize = Math.max(0.5, p.size * scale * dpr)
          
          const colorPhase = (Math.sin(time * 2 + p.phaseOffset) * 0.5 + 0.5)
          const r = Math.floor(dark.r + colorPhase * (light.r - dark.r) + p.hueOffset * 0.15)
          const g = Math.floor(dark.g + colorPhase * (light.g - dark.g) + p.hueOffset * 0.2)
          const b = Math.floor(dark.b + colorPhase * (light.b - dark.b) + p.hueOffset * 0.15)
          const alpha = 0.65 + (rz / (baseRadius * 2)) * 0.35
          
          ctx.beginPath()
          ctx.arc(sx, sy, particleSize, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${Math.min(255, Math.max(0, r))},${Math.min(255, Math.max(0, g))},${Math.min(255, Math.max(0, b))},${alpha})`
          ctx.fill()
        }
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [size, particleCount])

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