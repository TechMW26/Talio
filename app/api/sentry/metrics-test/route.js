import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { countMetric } from '@/lib/sentryMetrics'

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, [])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user } = auth

    countMetric('test_metric', 1, {
      source: 'api',
      userId: user?._id?.toString() || 'unknown'
    })

    return NextResponse.json({ success: true, sent: true })
  } catch (error) {
    console.error('Sentry metrics test error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to send test metric' },
      { status: 500 }
    )
  }
}
