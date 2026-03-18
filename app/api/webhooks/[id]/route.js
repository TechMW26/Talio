import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// GET - Get a single webhook (without secret)
export async function GET(request, { params }) {
    try {
        const auth = await getAuthAndModels(request, ['Webhook', 'WebhookDeliveryLog'])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        const { user, models } = auth
        const { Webhook, WebhookDeliveryLog } = models
        const { id } = await params

        if (!['admin', 'hr'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admins can view webhooks' },
                { status: 403 }
            )
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, message: 'Invalid webhook ID' },
                { status: 400 }
            )
        }

        const webhook = await Webhook.findById(id).select('-secret').lean()
        if (!webhook) {
            return NextResponse.json(
                { success: false, message: 'Webhook not found' },
                { status: 404 }
            )
        }

        // Include recent delivery logs
        const recentDeliveries = await WebhookDeliveryLog.find({ webhook: id })
            .sort({ createdAt: -1 })
            .limit(25)
            .lean()

        return NextResponse.json({
            success: true,
            data: {
                ...webhook,
                recentDeliveries,
            },
        })
    } catch (error) {
        console.error('Get webhook error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to get webhook' },
            { status: 500 }
        )
    }
}

// PUT - Update a webhook
export async function PUT(request, { params }) {
    try {
        const auth = await getAuthAndModels(request, ['Webhook'])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        const { user, models } = auth
        const { Webhook } = models
        const { id } = await params

        if (!['admin'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admins can update webhooks' },
                { status: 403 }
            )
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, message: 'Invalid webhook ID' },
                { status: 400 }
            )
        }

        const body = await request.json()
        const allowedFields = ['url', 'events', 'active', 'description', 'headers', 'maxFailures']
        const updateData = {}

        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updateData[field] = body[field]
            }
        }

        // Validate URL if provided
        if (updateData.url) {
            try {
                new URL(updateData.url)
            } catch {
                return NextResponse.json(
                    { success: false, message: 'Invalid webhook URL' },
                    { status: 400 }
                )
            }
        }

        // If re-activating, reset failure count
        if (updateData.active === true) {
            updateData.failureCount = 0
        }

        const webhook = await Webhook.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).select('-secret')

        if (!webhook) {
            return NextResponse.json(
                { success: false, message: 'Webhook not found' },
                { status: 404 }
            )
        }

        return NextResponse.json({
            success: true,
            message: 'Webhook updated successfully',
            data: webhook,
        })
    } catch (error) {
        console.error('Update webhook error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to update webhook' },
            { status: 500 }
        )
    }
}

// DELETE - Delete a webhook
export async function DELETE(request, { params }) {
    try {
        const auth = await getAuthAndModels(request, ['Webhook', 'WebhookDeliveryLog'])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        const { user, models } = auth
        const { Webhook, WebhookDeliveryLog } = models
        const { id } = await params

        if (!['admin'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admins can delete webhooks' },
                { status: 403 }
            )
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, message: 'Invalid webhook ID' },
                { status: 400 }
            )
        }

        const webhook = await Webhook.findByIdAndDelete(id)
        if (!webhook) {
            return NextResponse.json(
                { success: false, message: 'Webhook not found' },
                { status: 404 }
            )
        }

        // Clean up delivery logs
        await WebhookDeliveryLog.deleteMany({ webhook: id })

        return NextResponse.json({
            success: true,
            message: 'Webhook deleted successfully',
        })
    } catch (error) {
        console.error('Delete webhook error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to delete webhook' },
            { status: 500 }
        )
    }
}

// POST - Rotate webhook secret
export async function POST(request, { params }) {
    try {
        const auth = await getAuthAndModels(request, ['Webhook'])
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
        }

        const { user, models } = auth
        const { Webhook } = models
        const { id } = await params

        if (!['admin'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admins can rotate webhook secrets' },
                { status: 403 }
            )
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, message: 'Invalid webhook ID' },
                { status: 400 }
            )
        }

        const newSecret = crypto.randomBytes(32).toString('hex')

        const webhook = await Webhook.findByIdAndUpdate(
            id,
            { secret: newSecret },
            { new: true }
        )

        if (!webhook) {
            return NextResponse.json(
                { success: false, message: 'Webhook not found' },
                { status: 404 }
            )
        }

        return NextResponse.json({
            success: true,
            message: 'Webhook secret rotated. Save the new secret - it will not be shown again.',
            data: {
                _id: webhook._id,
                secret: newSecret,
            },
        })
    } catch (error) {
        console.error('Rotate webhook secret error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to rotate webhook secret' },
            { status: 500 }
        )
    }
}
