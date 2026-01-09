'use client'

import { useEffect, useRef } from 'react'

/**
 * MiraSphere - A miniature animated particle sphere for the MIRA button
 * Features particle disintegration on hover with spring physics to reform
 */
export default function MiraSphere({ size = 60, isHovered = false, className = '' }) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const particlesRef = useRef([])
  const isHoveredRef = useRef(false)
  
  // Update hover ref
  useEffect(() => {
    isHoveredRef.current = isHovered
  }, [isHovered])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    
    // Set canvas size
    canvas.width = size * dpr
    canvas.height = size * dpr
    
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const baseRadius = size * 0.28 * dpr  // Smaller base to leave room for expansion
    const Z_PERSPECTIVE = size * 3
    const particleCount = 200  // More particles for denser sphere

    // Physics constants
    const SPRING_TENSION = 0.06
    const SPRING_DAMPING = 0.85
    const VIBRATE_STRENGTH = 1.2
    const DISINTEGRATE_FORCE = 0.25
    const MAX_DISTANCE = size * 0.42 * dpr // Keep particles well within canvas bounds

    // Initialize particles in spherical distribution
    particlesRef.current = []
    for (let i = 0; i < particleCount; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / particleCount)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      
      // Base positions on sphere surface
      const bx = baseRadius * Math.sin(phi) * Math.cos(theta)
      const by = baseRadius * Math.sin(phi) * Math.sin(theta)
      const bz = baseRadius * Math.cos(phi)
      
      particlesRef.current.push({
        // Base position (target when not hovered)
        baseX: bx, baseY: by, baseZ: bz,
        // Current position
        x: bx, y: by, z: bz,
        // Velocity
        vx: 0, vy: 0, vz: 0,
        // Random direction for disintegration
        randX: (Math.random() - 0.5) * 2,
        randY: (Math.random() - 0.5) * 2,
        randZ: (Math.random() - 0.5) * 2,
        // Visual properties
        size: Math.random() * 0.4 + 0.6,  // Slightly larger particles
        alpha: Math.random() * 0.3 + 0.7,
        // Phase offset for vibration
        phase: Math.random() * Math.PI * 2
      })
    }

    // Slow rotation angle
    let rotationAngle = 0

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'source-over'
      
      const time = Date.now() * 0.001
      const isHovered = isHoveredRef.current
      
      // Slow continuous rotation
      rotationAngle += 0.003
      const cosR = Math.cos(rotationAngle)
      const sinR = Math.sin(rotationAngle)
      
      particlesRef.current.forEach(p => {
        if (isHovered) {
          // Disintegrate outward + vibrate
          const vibX = Math.sin(time * 12 + p.phase) * VIBRATE_STRENGTH
          const vibY = Math.cos(time * 12 + p.phase * 1.3) * VIBRATE_STRENGTH
          const vibZ = Math.sin(time * 12 + p.phase * 0.7) * VIBRATE_STRENGTH
          
          // Push particles outward
          p.vx += p.randX * DISINTEGRATE_FORCE + vibX * 0.05
          p.vy += p.randY * DISINTEGRATE_FORCE + vibY * 0.05
          p.vz += p.randZ * DISINTEGRATE_FORCE + vibZ * 0.05
          
          // Damping
          p.vx *= 0.92
          p.vy *= 0.92
          p.vz *= 0.92
          
          // Apply velocity
          p.x += p.vx
          p.y += p.vy
          p.z += p.vz
          
          // Constrain particles to stay within bounds
          const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
          if (dist > MAX_DISTANCE) {
            const scale = MAX_DISTANCE / dist
            p.x *= scale
            p.y *= scale
            p.z *= scale
            // Bounce velocity inward
            p.vx *= -0.3
            p.vy *= -0.3
            p.vz *= -0.3
          }
        } else {
          // Spring back to base position with rotation
          // Calculate rotated base position
          const rotatedBaseX = p.baseX * cosR - p.baseZ * sinR
          const rotatedBaseZ = p.baseX * sinR + p.baseZ * cosR
          const rotatedBaseY = p.baseY
          
          // Spring force toward rotated base
          const dx = rotatedBaseX - p.x
          const dy = rotatedBaseY - p.y
          const dz = rotatedBaseZ - p.z
          
          p.vx += dx * SPRING_TENSION
          p.vy += dy * SPRING_TENSION
          p.vz += dz * SPRING_TENSION
          
          // Damping
          p.vx *= SPRING_DAMPING
          p.vy *= SPRING_DAMPING
          p.vz *= SPRING_DAMPING
          
          // Apply velocity
          p.x += p.vx
          p.y += p.vy
          p.z += p.vz
        }
      })
      
      // Calculate projected positions and sort by depth
      const projected = particlesRef.current.map(p => {
        const scale = Z_PERSPECTIVE / (Z_PERSPECTIVE + p.z)
        return {
          x: cx + p.x * scale,
          y: cy + p.y * scale,
          z: p.z,
          scale,
          size: p.size,
          alpha: p.alpha
        }
      })
      
      projected.sort((a, b) => b.z - a.z)
      
      // Draw particles
      projected.forEach(p => {
        if (p.scale > 0) {
          const alpha = Math.min(1, Math.max(0.2, p.scale * p.alpha))
          const dotSize = Math.max(0.5, p.size * p.scale * dpr * 0.8)
          
          ctx.beginPath()
          ctx.arc(p.x, p.y, dotSize, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(70, 170, 255, ${alpha})`
          ctx.fill()
        }
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [size])

  return (
    <canvas 
      ref={canvasRef}
      className={className}
      style={{ 
        display: 'block',
        width: size, 
        height: size,
      }}
    />
  )
}
