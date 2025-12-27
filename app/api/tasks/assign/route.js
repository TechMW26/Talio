import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks/assign
 * 
 * Legacy task assignment endpoint - redirects to projects
 * This endpoint is deprecated - use /api/projects/[id]/tasks instead
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, [])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    // This endpoint is deprecated
    return NextResponse.json({
      success: false,
      message: 'This endpoint is deprecated. Please use /api/projects/[projectId]/tasks to assign tasks.'
    }, { status: 410 }) // 410 Gone

  } catch (error) {
    console.error('Error in /api/tasks/assign:', error)
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Failed to assign task'
    }, { status: 500 })
  }
}

export async function GET(request) {
  return NextResponse.json({
    success: false,
    message: 'This endpoint is deprecated. Please use /api/projects/[projectId]/tasks instead.'
  }, { status: 410 })
}
