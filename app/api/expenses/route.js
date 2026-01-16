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
      .lean()

    // Map fields for frontend compatibility (map database fields to frontend field names)
    const mappedExpenses = expenses.map(expense => ({
      ...expense,
      category: expense.expenseType, // Add category as alias for expenseType
      expenseDate: expense.date, // Add expenseDate as alias for date
    }))

    return NextResponse.json({
      success: true,
      data: mappedExpenses,
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

    // Map field names for compatibility (support both frontend naming conventions)
    const expenseData = {
      employee: data.employee,
      expenseType: data.category || data.expenseType, // Map category -> expenseType
      amount: data.amount,
      date: data.expenseDate || data.date, // Map expenseDate -> date
      description: data.description,
      project: data.project,
      receipts: data.receipts || []
    }

    // Validate required fields
    if (!expenseData.expenseType) {
      return NextResponse.json(
        { success: false, message: 'Category/Expense Type is required' },
        { status: 400 }
      )
    }
    if (!expenseData.amount) {
      return NextResponse.json(
        { success: false, message: 'Amount is required' },
        { status: 400 }
      )
    }
    if (!expenseData.date) {
      return NextResponse.json(
        { success: false, message: 'Date is required' },
        { status: 400 }
      )
    }

    // Set status to 'pending' for approval (note: schema uses 'pending', not 'submitted')
    const expense = await Expense.create({
      ...expenseData,
      status: 'pending',
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
          expenseType: expense.expenseType,
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

