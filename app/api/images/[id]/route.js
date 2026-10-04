import { NextResponse } from 'next/server'
import { getImageStream, getImageInfo } from '@/lib/mediaStorage'
import sharp from 'sharp'
import { verifyTokenFromRequest } from '@/lib/auth'
import { canReadDocumentUpload } from '@/lib/documentAccess.server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/images/[id]
 * Serve private tenant media from Vercel Blob with optional resizing.
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

        const auth = await verifyTokenFromRequest(request)
        if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
        const mediaOptions = { databaseName: auth.tenant.databaseName }
        const fileInfo = await getImageInfo(id, mediaOptions)
        if (!fileInfo) {
            return new NextResponse('Not found', { status: 404 })
        }
        const isAadhaar = fileInfo.metadata?.category === 'aadhaar'
        const isDocument = fileInfo.metadata?.category === 'documents'
        if (isDocument) {
            if (!await canReadDocumentUpload(auth, { fileId: id, ownerId: fileInfo.metadata?.userId })) {
                return new NextResponse('Forbidden', { status: 403 })
            }
        }
        if (isAadhaar) {
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
            const stream = await getImageStream(id, mediaOptions)

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
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Length': String(fileInfo.length),
                }
            })
        }

        // On-the-fly resize using sharp
        const stream = await getImageStream(id, mediaOptions)
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
                'Cache-Control': 'private, no-store',
                'Content-Length': String(resizedBuffer.length),
            }
        })

    } catch (error) {
        console.error('[Image Serve] Error:', error)
        return new NextResponse('Not found', { status: 404 })
    }
}
