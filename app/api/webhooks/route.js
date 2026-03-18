import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// GET - List all webhooks for the tenant
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Webhook'])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        const { user, models } = auth
        const { Webhook } = models

        // Only admins can manage webhooks
        if (!['admin', 'hr'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admins can manage webhooks' },
                { status: 403 }
            )
        }

        const webhooks = await Webhook.find()
            .select('-secret') // Never expose secrets
            .sort({ createdAt: -1 })
            .lean()

        return NextResponse.json({
            success: true,
            data: webhooks,
        })
    } catch (error) {
        console.error('List webhooks error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to list webhooks' },
            { status: 500 }
        )
    }
}

// POST - Create a new webhook
export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Webhook'])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        const { user, models } = auth
        const { Webhook } = models

        if (!['admin'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admins can create webhooks' },
                { status: 403 }
            )
        }

        const body = await request.json()
        const { url, events, description, headers } = body

        if (!url || !events || !Array.isArray(events) || events.length === 0) {
            return NextResponse.json(
                { success: false, message: 'url and events[] are required' },
                { status: 400 }
            )
        }

        // Validate URL
        try {
            new URL(url)
        } catch {
            return NextResponse.json(
                { success: false, message: 'Invalid webhook URL' },
                { status: 400 }
            )
        }

        // Generate a random secret for HMAC signing
        const secret = crypto.randomBytes(32).toString('hex')

        const webhook = await Webhook.create({
            url,
            events,
            secret,
            description: description || '',
            headers: headers || {},
            active: true,
            createdBy: user._id || user.userId,
        })

        // Return the secret ONLY on creation (it won't be shown again)
        return NextResponse.json({
            success: true,
            message: 'Webhook created successfully. Save the secret - it will not be shown again.',
            data: {
                _id: webhook._id,
                url: webhook.url,
                events: webhook.events,
                description: webhook.description,
                active: webhook.active,
                secret, // Only exposed on creation
                createdAt: webhook.createdAt,
            },
        }, { status: 201 })
    } catch (error) {
        console.error('Create webhook error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to create webhook' },
            { status: 500 }
        )
    }
}
