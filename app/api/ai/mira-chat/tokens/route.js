import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export async function GET(request) {
  try {
    const { success, user, models, message: authMsg } = await getAuthAndModels(request, ['MiraTokenUsage'])

    if (!success) {
      return NextResponse.json({ success: false, message: authMsg }, { status: 401 })
    }

    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    let usage = await models.MiraTokenUsage.findOne({ user: user._id, month })
    if (!usage) {
      usage = { tokensUsed: 0, tokenLimit: 100 }
    }

    return NextResponse.json({
      success: true,
      tokens: {
        tokensUsed: usage.tokensUsed,
        tokenLimit: usage.tokenLimit,
        tokensRemaining: usage.tokenLimit - usage.tokensUsed
      }
    })
  } catch (error) {
    console.error('[Mira Tokens] Error:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch token balance' }, { status: 500 })
  }
}
