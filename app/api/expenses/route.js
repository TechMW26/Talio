import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitExpenseUpdate } from '@/lib/realtimeEvents'

// GET - List expenses
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Expense', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Expense, User } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')

    const query = {}

    if (employeeId) {
      query.employee = employeeId
    }

    if (status) {
      query.status = status
    }

    const expenses = await Expense.find(query)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: expenses,
    })
  } catch (error) {
    console.error('Get expenses error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch expenses' },
      { status: 500 }
    )
  }
}

// POST - Create expense
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Expense', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Expense, User } = models

    const data = await request.json()

    // Set status to 'submitted' for approval instead of 'draft'
    const expense = await Expense.create({
      ...data,
      status: 'submitted',
      submittedDate: new Date()
    })

    const populatedExpense = await Expense.findById(expense._id)
      .populate('employee', 'firstName lastName employeeCode')

    // Emit real-time expense update to admins/HR
    try {
      const adminUsers = await User.find({ role: { $in: ['admin', 'hr', 'manager'] }, isActive: true }).select('_id').lean()
      const targetUserIds = adminUsers.map(u => u._id.toString())
      
      emitExpenseUpdate(
        {
          _id: expense._id,
          employee: populatedExpense.employee,
          category: expense.category,
          amount: expense.amount,
          status: expense.status,
          description: expense.description,
          submittedDate: expense.submittedDate
        },
        targetUserIds,
        { isNew: true, action: 'submit' }
      )
    } catch (emitError) {
      console.error('Failed to emit expense update:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: 'Expense submitted for approval',
      data: populatedExpense,
    }, { status: 201 })
  } catch (error) {
    console.error('Create expense error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create expense' },
      { status: 500 }
    )
  }
}

