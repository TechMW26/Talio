import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { getAuthenticationParameters } from '@/lib/imagekit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/imagekit/auth
 * Get ImageKit authentication parameters for client-side uploads
 * 
 * This endpoint generates a signature that allows the client to
 * upload files directly to ImageKit without exposing the private key.
 */
export async function GET(request) {
    try {
        // Verify authentication
        const auth = await getAuthAndModels(request, [])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        // Check if ImageKit is configured
        if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY || !process.env.IMAGEKIT_URL_ENDPOINT) {
            return NextResponse.json({
                success: false,
                message: 'ImageKit is not configured'
            }, { status: 503 })
        }

        // Generate authentication parameters
        const authParams = getAuthenticationParameters()

        return NextResponse.json({
            success: true,
            data: {
                ...authParams,
                publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
                urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
            }
        })

    } catch (error) {
        console.error('[ImageKit Auth] Error:', error)
        return NextResponse.json({
            success: false,
            message: 'Failed to generate authentication'
        }, { status: 500 })
    }
}
