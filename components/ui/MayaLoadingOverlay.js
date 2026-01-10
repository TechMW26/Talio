'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * MIRA AI Loading Overlay
 * A beautiful animated blob loading indicator for AI operations
 * Based on /public/mira/blob.html design
 */
export default function MiraLoadingOverlay({
  isLoading,
  message = 'MIRA is thinking...',
  className = '',
  fullScreen = false,
  size = 'medium' // 'small' | 'medium' | 'large'
}) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const blobsRef = useRef([])
  const [mounted, setMounted] = useState(false)

  // Size configurations
  const sizes = {
    small: { canvas: 48, blob: 24 },
    medium: { canvas: 72, blob: 36 },
    large: { canvas: 96, blob: 48 }
  }

  const sizeConfig = sizes[size] || sizes.medium

  // Color palette for blobs
  const COLORS = [
    { start: 'rgba(77, 255, 163, 0.9)', end: 'rgba(0, 200, 150, 0.3)' },
    { start: 'rgba(100, 220, 255, 0.85)', end: 'rgba(50, 150, 255, 0.25)' },
    { start: 'rgba(139, 93, 255, 0.8)', end: 'rgba(100, 50, 200, 0.2)' },
    { start: 'rgba(255, 180, 100, 0.75)', end: 'rgba(255, 120, 50, 0.2)' }
  ]

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isLoading || !canvasRef.current || !mounted) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { canvas: canvasSize, blob: blobCenter } = sizeConfig

    canvas.width = canvasSize
    canvas.height = canvasSize

    const rand = (min, max) => Math.random() * (max - min) + min
    const noise = (x, y, t) => Math.sin(x * 0.5 + t) * Math.cos(y * 0.5 + t) * 0.5 + 0.5

    // Initialize blobs
    const cx = blobCenter
    const cy = blobCenter
    const baseRadius = blobCenter * 0.6

    blobsRef.current = COLORS.map((palette, i) => {
      const angle = rand(0, Math.PI * 2)
      const dist = rand(0, blobCenter * 0.2)
      const r = rand(baseRadius * 0.7, baseRadius * 1.1)
      const homeX = cx + Math.cos(angle) * dist
      const homeY = cy + Math.sin(angle) * dist
      return {
        x: homeX, y: homeY, r,
        vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3),
        hx: homeX, hy: homeY,
        palette,
        noiseOffset: rand(0, 1000)
      }
    })

    const drawBlob = (b, now) => {
      const points = 8
      const angleStep = (Math.PI * 2) / points
      const grd = ctx.createRadialGradient(b.x, b.y, b.r * 0.1, b.x, b.y, b.r * 1.3)
      grd.addColorStop(0, b.palette.start)
      grd.addColorStop(1, b.palette.end)

      const pts = []
      for (let i = 0; i < points; i++) {
        const angle = i * angleStep
        const n = noise(Math.cos(angle) + b.noiseOffset, Math.sin(angle) + b.noiseOffset, now * 0.0008)
        const offset = b.r * 0.15 * (n - 0.5) * 2
        pts.push({
          x: b.x + Math.cos(angle) * (b.r + offset),
          y: b.y + Math.sin(angle) * (b.r + offset)
        })
      }

      ctx.beginPath()
      ctx.moveTo((pts[0].x + pts[points - 1].x) / 2, (pts[0].y + pts[points - 1].y) / 2)
      for (let i = 0; i < points; i++) {
        const p1 = pts[i]
        const p2 = pts[(i + 1) % points]
        const mx = (p1.x + p2.x) / 2
        const my = (p1.y + p2.y) / 2
        ctx.quadraticCurveTo(p1.x, p1.y, mx, my)
      }
      ctx.closePath()
      ctx.fillStyle = grd
      ctx.fill()
    }

    const animate = (now) => {
      ctx.clearRect(0, 0, canvasSize, canvasSize)

      for (const b of blobsRef.current) {
        // Enhanced movement for "speaking" effect
        b.vx += (b.hx - b.x) * 0.015
        b.vy += (b.hy - b.y) * 0.015
        b.vx *= 0.95
        b.vy *= 0.95
        // Add some pulsing movement
        b.x += b.vx + Math.sin(now * 0.003 + b.noiseOffset) * 0.8
        b.y += b.vy + Math.cos(now * 0.003 + b.noiseOffset) * 0.8
        drawBlob(b, now)
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isLoading, mounted, sizeConfig])

  if (!isLoading || !mounted) return null

  const overlayClasses = fullScreen
    ? 'fixed inset-0 z-50 flex flex-col items-center justify-center modal-overlay-dark'
    : `absolute inset-0 z-10 flex flex-col items-center justify-center modal-overlay-bg ${className}`

  return (
    <div className={overlayClasses}>
      {/* Animated MIRA Blob */}
      <div
        className="relative mira-blob-speaking"
        style={{
          width: sizeConfig.canvas,
          height: sizeConfig.canvas,
          filter: 'drop-shadow(0 0 20px rgba(77, 255, 163, 0.6))'
        }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ background: 'transparent' }}
        />

        {/* Pulse rings */}
        <div className="absolute inset-0 rounded-full border-2 border-green-400/40 animate-ping" style={{ animationDuration: '1.5s' }} />
        <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 animate-ping" style={{ animationDuration: '1.5s', animationDelay: '0.75s' }} />
      </div>

      {/* Loading Message */}
      {message && (
        <p className="mt-4 text-sm font-medium text-gray-700 dark:text-gray-300 animate-pulse">
          {message}
        </p>
      )}

      <style jsx>{`
        .mira-blob-speaking {
          animation: miraPulse 0.6s ease-in-out infinite;
        }

        @keyframes miraPulse {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.08); }
          50% { transform: scale(1.04); }
          75% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}
