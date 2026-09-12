import { NextResponse } from 'next/server'
import { isPusherRealtimeConfigured } from '@/lib/platform/realtimeChannels'

export const dynamic = 'force-dynamic'

export async function GET() {
  const configured = isPusherRealtimeConfigured()
  return NextResponse.json({
    provider: 'pusher',
    configured,
    authorizationEndpoint: '/api/realtime/auth',
  }, { status: configured ? 200 : 503 })
}

