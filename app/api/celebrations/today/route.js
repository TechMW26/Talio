import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { Employee } = auth.models
    const today = new Date()
    const month = today.getMonth() + 1
    const day = today.getDate()

    // Find employees whose birthday or work anniversary falls today
    const employees = await Employee.find({ status: 'active' })
      .select('firstName lastName dateOfBirth dateOfJoining profilePicture department')
      .populate('department', 'name')
      .lean()

    const birthdays = []
    const anniversaries = []

    for (const emp of employees) {
      if (emp.dateOfBirth) {
        const dob = new Date(emp.dateOfBirth)
        if (dob.getMonth() + 1 === month && dob.getDate() === day) {
          birthdays.push({
            _id: emp._id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            profilePicture: emp.profilePicture,
            department: emp.department?.name || '',
          })
        }
      }
      if (emp.dateOfJoining) {
        const doj = new Date(emp.dateOfJoining)
        if (doj.getMonth() + 1 === month && doj.getDate() === day) {
          const years = today.getFullYear() - doj.getFullYear()
          // Only show anniversaries for 1+ years (not the joining day itself)
          if (years >= 1) {
            anniversaries.push({
              _id: emp._id,
              firstName: emp.firstName,
              lastName: emp.lastName,
              profilePicture: emp.profilePicture,
              department: emp.department?.name || '',
              years,
            })
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      birthdays,
      anniversaries,
    })
  } catch (error) {
    console.error('[Celebrations API]', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
