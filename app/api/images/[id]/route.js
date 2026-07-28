import { NextResponse } from 'next/server'
import { getImageStream, getImageInfo } from '@/lib/gridfs'
import sharp from 'sharp'
import { verifyTokenFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/images/[id]
 * Serve an image from GridFS with optional on-the-fly resizing.
 * 
 * Query params:
 *   w - width (max 2048)
 *   h - height (max 2048)
 *   q - quality 1-100 (default 80)
 */
export async function GET(request, { params }) {
    try {
        const { id } = await params

        if (!id || id.length !== 24) {
            return new NextResponse('Not found', { status: 404 })
        }

        // Get file info first for content-type
        const fileInfo = await getImageInfo(id)
        if (!fileInfo) {
            return new NextResponse('Not found', { status: 404 })
        }
        const isAadhaar = fileInfo.metadata?.category === 'aadhaar'
        if (isAadhaar) {
            const auth = await verifyTokenFromRequest(request)
            const requesterId = String(auth?.user?._id || auth?.user?.userId || '')
            const ownerId = String(fileInfo.metadata?.userId || '')
            const privileged = ['admin', 'hr'].includes(auth?.user?.role)
            if (!auth?.success || (!privileged && requesterId !== ownerId)) {
                return new NextResponse('Forbidden', { status: 403 })
            }
        }

        const { searchParams } = new URL(request.url)
        const width = Math.min(parseInt(searchParams.get('w')) || 0, 2048) || null
        const height = Math.min(parseInt(searchParams.get('h')) || 0, 2048) || null
        const quality = Math.min(Math.max(parseInt(searchParams.get('q')) || 80, 1), 100)
        const needsResize = width || height

        const contentType = fileInfo.contentType || 'image/webp'

        if (!needsResize) {
            // Stream directly without processing
            const stream = await getImageStream(id)

            const readableStream = new ReadableStream({
                start(controller) {
                    stream.on('data', (chunk) => controller.enqueue(chunk))
                    stream.on('end', () => controller.close())
                    stream.on('error', (err) => controller.error(err))
                }
            })

            return new NextResponse(readableStream, {
                headers: {
                    'Content-Type': contentType,
                    'Cache-Control': isAadhaar ? 'private, no-store' : 'public, max-age=31536000, immutable',
                    'Content-Length': String(fileInfo.length),
                }
            })
        }

        // On-the-fly resize using sharp
        const stream = await getImageStream(id)
        const chunks = []
        for await (const chunk of stream) {
            chunks.push(chunk)
        }
        const buffer = Buffer.concat(chunks)

        let pipeline = sharp(buffer, { failOnError: false })
        pipeline = pipeline.resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true,
        })

        // Re-encode based on original content type
        if (contentType.includes('png')) {
            pipeline = pipeline.png({ quality })
        } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
            pipeline = pipeline.jpeg({ quality, mozjpeg: true })
        } else {
            pipeline = pipeline.webp({ quality })
        }

        const resizedBuffer = await pipeline.toBuffer()

        return new NextResponse(resizedBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': isAadhaar ? 'private, no-store' : 'public, max-age=31536000, immutable',
                'Content-Length': String(resizedBuffer.length),
            }
        })

    } catch (error) {
        console.error('[Image Serve] Error:', error)
        return new NextResponse('Not found', { status: 404 })
    }
}
