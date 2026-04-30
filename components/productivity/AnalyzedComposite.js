'use client'

/**
 * AnalyzedComposite
 * --------------------------------
 * Renders the per-(user,day) stitched screenshot mosaic returned by
 * `GET /api/productivity/composite`. The composite replaces the old
 * "Analyzed Captures" grid: every analyzed screenshot lives inside a single
 * image. Click any tile region to zoom into it inside a modal viewer; the X
 * button resets the zoom and closes the modal.
 *
 * Hotspots are computed from the `tiles[]` rectangles returned by the API,
 * scaled by the rendered image size so click hit-testing stays accurate at
 * any browser width.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, ModalContent, ModalBody } from '@heroui/react'
import { HiOutlineXMark, HiOutlineSparkles, HiOutlinePhoto } from 'react-icons/hi2'
import useAuthedSWR from '@/hooks/useAuthedSWR'

function productivityBadge(tile) {
  const p = (tile?.productivity || '').toLowerCase()
  if (p === 'high') return 'bg-green-500/80'
  if (p === 'medium') return 'bg-blue-500/80'
  if (p === 'low') return 'bg-amber-500/80'
  if (p === 'idle') return 'bg-red-500/80'
  return 'bg-slate-500/70'
}

function TileZoomModal({ open, composite, tile, imageBlobUrl, zoomTileUrl, onClose }) {
  if (!open || !tile || !composite) return null

  // Center the tile inside the viewport: use background-image trick at full
  // composite resolution and translate the background so the tile sits under
  // the visible window.
  const targetWidth = Math.min(typeof window !== 'undefined' ? window.innerWidth * 0.9 : 1200, 1400)
  const targetHeight = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.85 : 800, 900)
  const scale = Math.min(
    targetWidth / tile.width,
    targetHeight / tile.height,
  )
  const renderedTileW = tile.width * scale
  const renderedTileH = tile.height * scale
  const bgWidth = composite.width * scale
  const bgHeight = composite.height * scale
  const bgPosX = -tile.x * scale
  const bgPosY = -tile.y * scale

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="full"
      hideCloseButton
      backdrop="opaque"
      classNames={{
        base: 'bg-black/95 m-0 max-w-none rounded-none',
        body: 'p-0 overflow-hidden',
      }}
    >
      <ModalContent>
        <ModalBody>
          <div className="fixed inset-0 z-50 flex flex-col">
            {/* Top bar */}
            <div className="flex items-center justify-between px-4 py-3 text-white/90 text-sm">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-wide">
                  Tile #{(tile.index ?? 0) + 1} of {composite.tileCount}
                </span>
                {tile.capturedAt ? (
                  <span className="text-white/70">
                    {new Date(tile.capturedAt).toLocaleString()}
                  </span>
                ) : null}
                {tile.applicationVisible && tile.applicationVisible !== 'unknown' ? (
                  <span className="rounded-full bg-indigo-500/80 px-2.5 py-0.5 text-[11px]">
                    {tile.applicationVisible}
                  </span>
                ) : null}
                {tile.productivity ? (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] text-white ${productivityBadge(tile)}`}>
                    {tile.productivity}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-full p-2 bg-white/15 hover:bg-white/30 transition"
              >
                <HiOutlineXMark className="w-6 h-6" />
              </button>
            </div>

            {/* Zoomed tile, rendered as a background-positioned slice of the
                full composite so we don't have to re-crop server-side. */}
            <div className="flex-1 flex items-center justify-center p-4">
              {zoomTileUrl ? (
                <img
                  src={zoomTileUrl}
                  alt={`Tile ${(tile.index ?? 0) + 1}`}
                  className="rounded-lg shadow-2xl ring-1 ring-white/20 object-contain"
                  style={{ width: renderedTileW, height: renderedTileH }}
                />
              ) : (
                <div
                  style={{
                    width: renderedTileW,
                    height: renderedTileH,
                    backgroundImage: imageBlobUrl ? `url(${imageBlobUrl})` : undefined,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${bgWidth}px ${bgHeight}px`,
                    backgroundPosition: `${bgPosX}px ${bgPosY}px`,
                  }}
                  className="rounded-lg shadow-2xl ring-1 ring-white/20"
                />
              )}
            </div>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default function AnalyzedComposite({ userId, date, refreshSignal = 0 }) {
  const containerRef = useRef(null)
  const imageRef = useRef(null)
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 })
  const [zoomTile, setZoomTile] = useState(null)
  const [zoomTileUrl, setZoomTileUrl] = useState(null)
  const [imageBlobUrl, setImageBlobUrl] = useState(null)

  const swrKey = useMemo(() => {
    if (!date) return null
    const params = new URLSearchParams({ date })
    if (userId) params.set('userId', userId)
    return `/api/productivity/composite?${params.toString()}`
  }, [userId, date])

  const { data, isLoading, mutate } = useAuthedSWR(swrKey)

  // Force-refresh whenever the parent signals a new analysis just completed.
  useEffect(() => {
    if (refreshSignal && swrKey) mutate()
  }, [refreshSignal, swrKey, mutate])

  const composite = data?.composite || null

  // Pull the image as a blob so the zoom modal can use it via a stable URL
  // (also doubles as a "preload" for the main render).
  useEffect(() => {
    let cancelled = false
    let createdUrl = null
    setImageBlobUrl(null)
    if (!composite?.imageUrl) return undefined

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    fetch(composite.imageUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Composite image fetch failed: ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setImageBlobUrl(createdUrl)
      })
      .catch((err) => {
        if (!cancelled) console.error('[AnalyzedComposite] image load failed:', err)
      })

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [composite?.imageUrl])

  // Track rendered image size so hotspot positions scale correctly.
  useEffect(() => {
    if (!imageRef.current) return undefined
    const el = imageRef.current
    const update = () => {
      const rect = el.getBoundingClientRect()
      setRenderedSize({ width: rect.width, height: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [imageBlobUrl, composite?.width, composite?.height])

  useEffect(() => {
    return () => {
      if (zoomTileUrl) URL.revokeObjectURL(zoomTileUrl)
    }
  }, [zoomTileUrl])

  const closeZoom = () => {
    setZoomTile(null)
    if (zoomTileUrl) {
      URL.revokeObjectURL(zoomTileUrl)
      setZoomTileUrl(null)
    }
  }

  const openZoom = async (tile) => {
    setZoomTile(tile)
    if (zoomTileUrl) {
      URL.revokeObjectURL(zoomTileUrl)
      setZoomTileUrl(null)
    }

    try {
      const img = imageRef.current
      if (!img || !img.complete || !Number.isFinite(tile?.x) || !Number.isFinite(tile?.y)) return

      const naturalW = Math.max(1, img.naturalWidth || 1)
      const naturalH = Math.max(1, img.naturalHeight || 1)
      const compW = Math.max(1, Number(composite?.width) || naturalW)
      const compH = Math.max(1, Number(composite?.height) || naturalH)
      const scaleX = naturalW / compW
      const scaleY = naturalH / compH

      const srcX = Math.max(0, Math.floor((tile.x || 0) * scaleX))
      const srcY = Math.max(0, Math.floor((tile.y || 0) * scaleY))
      const srcW = Math.max(1, Math.floor((tile.width || 1) * scaleX))
      const srcH = Math.max(1, Math.floor((tile.height || 1) * scaleY))

      // Clamp to image bounds to avoid partial out-of-range crops.
      const sx = Math.min(srcX, Math.max(0, naturalW - 1))
      const sy = Math.min(srcY, Math.max(0, naturalH - 1))
      const w = Math.min(srcW, Math.max(1, naturalW - sx))
      const h = Math.min(srcH, Math.max(1, naturalH - sy))

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'

      // Crop directly from the already-loaded composite image element.
      ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h)

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png')
      })
      if (!blob) return
      setZoomTileUrl(URL.createObjectURL(blob))
    } catch (err) {
      console.error('[AnalyzedComposite] zoom crop failed:', err)
    }
  }

  const scaleX = useMemo(() => {
    if (!composite?.width || !renderedSize.width) return 0
    return renderedSize.width / composite.width
  }, [composite?.width, renderedSize.width])
  const scaleY = useMemo(() => {
    if (!composite?.height || !renderedSize.height) return 0
    return renderedSize.height / composite.height
  }, [composite?.height, renderedSize.height])

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-sm text-gray-500">
        Loading analyzed mosaic…
      </div>
    )
  }

  if (!composite) {
    return null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <HiOutlineSparkles className="w-5 h-5 text-green-500" />
          Analyzed Mosaic ({composite.tileCount})
        </h2>
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <HiOutlinePhoto className="w-4 h-4" />
          {composite.columns}×{composite.rows} grid · {(composite.byteSize / 1024).toFixed(0)} KB
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-gray-100 bg-slate-900 shadow-sm"
      >
        {imageBlobUrl ? (
          <img
            ref={imageRef}
            src={imageBlobUrl}
            alt={`Analyzed screenshots mosaic for ${composite.dateString}`}
            className="w-full h-auto select-none"
            draggable={false}
          />
        ) : (
          <div className="aspect-video flex items-center justify-center text-white/70 text-sm">
            Loading mosaic image…
          </div>
        )}

        {/* Click hotspots — one per tile rectangle */}
        {scaleX > 0 && scaleY > 0 && composite.tiles.map((tile) => {
          const left = tile.x * scaleX
          const top = tile.y * scaleY
          const width = tile.width * scaleX
          const height = tile.height * scaleY
          return (
            <button
              key={tile.index}
              type="button"
              onClick={() => openZoom(tile)}
              className="absolute group"
              style={{ left, top, width, height }}
              title={tile.capturedAt ? new Date(tile.capturedAt).toLocaleString() : `Tile ${tile.index + 1}`}
            >
              <span className="absolute inset-0 rounded-md ring-1 ring-white/0 group-hover:ring-white/70 group-hover:bg-white/10 transition" />
              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition">
                #{tile.index + 1}
              </span>
              {tile.productivity ? (
                <span
                  className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full ${productivityBadge(tile)} opacity-80`}
                />
              ) : null}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Click any region to zoom in. The original screenshots are deleted after stitching to save storage.
      </p>

      <TileZoomModal
        open={!!zoomTile}
        composite={composite}
        tile={zoomTile}
        imageBlobUrl={imageBlobUrl}
        zoomTileUrl={zoomTileUrl}
        onClose={closeZoom}
      />
    </div>
  )
}
