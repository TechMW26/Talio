import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getRecruitmentDatabase } from '@/lib/recruitment/store.server'
import { recruitmentAnalytics } from '@/lib/recruitment/analytics.server'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    return NextResponse.json({ success: true, data: await recruitmentAnalytics(await getRecruitmentDatabase(auth), new URL(request.url).searchParams.get('department')) })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 })
  }
}
