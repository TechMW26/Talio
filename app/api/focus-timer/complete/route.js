import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { duration } = await request.json()
    const userId = (auth.user._id || auth.user.id || auth.user.userId).toString()
    const { User, Notification } = auth.models

    await sendPushToUser(userId, {
      title: '⏰ Focus Timer Complete!',
      body: `Your ${duration || ''} minute focus session is done. Great work!`,
    }, {
      url: '/dashboard',
      type: 'system',
      models: { User, Notification },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[FocusTimer] Complete notification error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
