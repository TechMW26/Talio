import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { duration } = await request.json()
    const userId = (auth.user._id || auth.user.id || auth.user.userId).toString()
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0 || duration > 1440)) return NextResponse.json({ success: false, message: 'Invalid focus duration' }, { status: 400 })

    await sendPushToUser(userId, {
      title: '⏰ Focus Timer Complete!',
      body: `Your ${duration || ''} minute focus session is done. Great work!`,
    }, {
      url: '/dashboard',
      type: 'system',
      database: auth.database,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[FocusTimer] Complete notification error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
