import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Policy', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Policy, Employee } = models

    const { id } = params
    const { employeeId } = await request.json()

    if (!employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee ID is required' },
        { status: 400 }
      )
    }

    const policy = await Policy.findById(id)
    if (!policy) {
      return NextResponse.json(
        { success: false, message: 'Policy not found' },
        { status: 404 }
      )
    }

    // Check if already acknowledged
    const alreadyAcknowledged = policy.acknowledgments.some(
      (ack) => ack.employee.toString() === employeeId
    )

    if (alreadyAcknowledged) {
      return NextResponse.json(
        { success: false, message: 'Policy already acknowledged' },
        { status: 400 }
      )
    }

    // Add acknowledgment
    policy.acknowledgments.push({
      employee: employeeId,
      acknowledgedDate: new Date(),
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown'
    })

    await policy.save()

    return NextResponse.json({
      success: true,
      message: 'Policy acknowledged successfully'
    })

  } catch (error) {
    console.error('Acknowledge policy error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to acknowledge policy' },
      { status: 500 }
    )
  }
}
