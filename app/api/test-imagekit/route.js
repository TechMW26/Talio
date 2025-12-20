import { NextResponse } from 'next/server'
import { uploadImageToImageKit } from '@/lib/imagekit'

// Mark as dynamic to bypass caching
export const dynamic = 'force-dynamic'

export async function GET(request) {
    try {
        // Check if env vars are set
        const config = {
            publicKey: process.env.IMAGEKIT_PUBLIC_KEY ? `SET (${process.env.IMAGEKIT_PUBLIC_KEY.substring(0, 15)}...)` : 'NOT SET',
            privateKey: process.env.IMAGEKIT_PRIVATE_KEY ? 'SET' : 'NOT SET',
            urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'NOT SET',
        }

        console.log('[Test ImageKit] Config:', config)

        // Test with a simple 1x1 red pixel
        const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

        console.log('[Test ImageKit] Attempting upload...')

        const result = await uploadImageToImageKit(testBase64, {
            fileName: `test_${Date.now()}.png`,
            folder: '/test',
            tags: ['test', 'debug'],
        })

        console.log('[Test ImageKit] Upload result:', result)

        return NextResponse.json({
            success: true,
            config,
            result,
        })
    } catch (error) {
        console.error('[Test ImageKit] Error:', error)
        return NextResponse.json({
            success: false,
            error: error.message,
            stack: error.stack,
            config: {
                publicKey: process.env.IMAGEKIT_PUBLIC_KEY ? `SET (${process.env.IMAGEKIT_PUBLIC_KEY.substring(0, 15)}...)` : 'NOT SET',
                privateKey: process.env.IMAGEKIT_PRIVATE_KEY ? 'SET' : 'NOT SET',
                urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'NOT SET',
            }
        }, { status: 500 })
    }
}
