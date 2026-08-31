/**
 * Attendance Notification Scheduler
 * 
 * Sends timely notifications to employees:
 * - 15 minutes before office start time (with fun AI messages)
 * - Break time reminders
 * - Work-off time notifications
 * - Overtime check (30 min after shift end)
 * - Auto-checkout (if no response to overtime prompt)
 */

import connectDB from '@/lib/mongodb'
import CompanySettings from '@/models/CompanySettings'
import Company from '@/models/Company'
import Employee from '@/models/Employee'
import Attendance from '@/models/Attendance'
import Leave from '@/models/Leave'
import Holiday from '@/models/Holiday'
import OvertimeRequest from '@/models/OvertimeRequest'
import { sendPushToUser } from '@/lib/pushNotification'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'

// Fun notification messages for different occasions
const FUN_MESSAGES = {
  officeStart: [
    "☕ Time to grab your coffee! Office starts in 15 minutes. Let's make today amazing!",
    "🚀 T-minus 15 minutes to launch! Ready to conquer the day?",
    "🌟 Rise and shine, superstar! 15 minutes until showtime.",
    "⏰ Heads up! The office door opens in 15 minutes. Don't forget your smile!",
    "🎯 15 minutes to go! Time to put on your superhero cape.",
    "🌅 Good morning, legend! Office starts in 15 minutes. You've got this!",
    "💪 Power up! Just 15 minutes until we start crushing goals.",
    "🎵 *Office theme song plays* 15 minutes to curtain call!",
    "🏃 On your marks... 15 minutes to office time!",
    "✨ Magic happens in 15 minutes! Ready to make some?",
  ],
  breakStart: [
    "🍔 Break time! Your snack is calling. Enjoy your well-deserved rest!",
    "☕ Time to recharge! Take a breather, you've earned it.",
    "🧘 Pause button activated! Stretch, breathe, and refresh.",
    "🎮 Break time unlocked! Level up your energy.",
    "🌿 Nature break! Step away and reset your mind.",
  ],
  breakEnd: [
    "⚡ Break's over! Time to bring the energy back.",
    "🎯 Back to action! Let's finish strong.",
    "💼 Recharging complete! Ready for round two?",
    "🚀 Engines back online! Let's continue the mission.",
    "🌟 Welcome back! Time to shine again.",
  ],
  workOff: [
    "🎉 You did it! Time to clock out and celebrate.",
    "🌅 The day is done! Go enjoy your evening, champion.",
    "🏠 Home time! You've earned your rest.",
    "🎊 Work mode: OFF. Relaxation mode: ON!",
    "🌙 That's a wrap! See you tomorrow, superstar!",
    "🎯 Goals crushed! Time to recharge for tomorrow.",
    "🍕 Pizza time? Work's done, treat yourself!",
    "🎬 And... cut! That's a wrap on today.",
  ],
  overtimeCheck: [
    "🕐 Hey! Your shift ended 30 mins ago. Are you working overtime or just forgot to clock out?",
    "⏰ Still here? Just checking - are you doing overtime or need to clock out?",
    "🤔 Your shift ended a while ago. Working late or forgot to leave?",
    "⌛ 30 minutes past your shift! Confirm if you're doing overtime.",
    "🔔 Overtime check! Are you still working or should we clock you out?",
  ],
  autoCheckout: [
    "🚪 Auto clocked out! No response received about overtime.",
    "⏰ You've been automatically clocked out as no response was received.",
    "🔒 Shift closed automatically. Your work hours have been recorded.",
  ],
}

/**
 * Get a random fun message for the given occasion
 */
function getRandomMessage(occasion) {
  const messages = FUN_MESSAGES[occasion] || FUN_MESSAGES.officeStart
  return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Generate AI-powered notification message using the shared custom AI service
 */
async function generateAIMessage(occasion, employeeName, context = {}) {
  try {
    const { generateContent, getAIAvailability } = await import('./gemini.js')
    if (!getAIAvailability().anyAvailable) {
      // Fall back to random pre-defined message
      return getRandomMessage(occasion)
    }

    const prompts = {
      officeStart: `Generate a short, fun, and motivating notification message (max 100 chars) for an employee named ${employeeName} that office starts in 15 minutes. Be creative, use emojis, and make it feel personal and encouraging.`,
      breakStart: `Generate a short, relaxing notification message (max 80 chars) for ${employeeName} that it's break time. Use emojis and encourage them to take a proper break.`,
      breakEnd: `Generate a short, energizing notification message (max 80 chars) for ${employeeName} that break is ending. Use emojis and motivate them to get back to work.`,
      workOff: `Generate a short, celebratory notification message (max 80 chars) for ${employeeName} that work day is ending. Use emojis and congratulate them.`,
    }
    const systemInstruction = 'You are a friendly workplace assistant. Generate short, fun notification messages with emojis. Keep messages under 100 characters.'
    const aiMessage = await generateContent(prompts[occasion] || prompts.officeStart, systemInstruction, { useCase: 'chat' })

    return aiMessage?.trim() || getRandomMessage(occasion)
  } catch (error) {
    console.error('AI message generation failed:', error)
    return getRandomMessage(occasion)
  }
}

/**
 * Parse time string "HH:MM" to Date object for today
 */
function parseTimeToDate(timeString, baseDate = new Date()) {
  const [hours, minutes] = timeString.split(':').map(Number)
  const date = new Date(baseDate)
  date.setHours(hours, minutes, 0, 0)
  return date
}

/**
 * Get employees who should receive notifications (not on leave, active)
 */
async function getActiveEmployees(filter = {}, referenceDate = new Date()) {
  const today = new Date(referenceDate)
  today.setHours(0, 0, 0, 0)

  // Get employees on leave today
  const leavesToday = await Leave.find({
    status: 'approved',
    startDate: { $lte: today },
    endDate: { $gte: today },
    workFromHome: { $ne: true } // WFH employees should still get notifications
  }).select('employee').lean()

  const onLeaveIds = leavesToday.map(l => l.employee.toString())

  // Get active employees not on leave
  const query = {
    status: 'active',
    _id: { $nin: onLeaveIds.map(id => id) },
    ...filter
  }

  const employees = await Employee.find(query).populate('user', '_id').lean()

  return employees.filter(emp => emp.user) // Only employees with user accounts
}

/**
 * Send pre-office notification (15 minutes before office time)
 */
export async function sendPreOfficeNotifications(settings, filter = {}, referenceDate = new Date()) {
  try {
    await connectDB()

    // If settings not provided, fetch global (legacy behavior)
    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const employees = await getActiveEmployees(filter, referenceDate)
    let sentCount = 0

    for (const employee of employees) {
      try {
        const employeeName = employee.firstName || 'there'
        const message = await generateAIMessage('officeStart', employeeName)

        await sendPushToUser(
          employee.user._id,
          {
            title: '⏰ Office Time Reminder',
            body: message,
          },
          {
            eventType: 'officeReminder',
            clickAction: '/dashboard/attendance',
            icon: '/icons/icon-192x192.png',
            data: {
              type: 'pre-office',
              officeTime: settings.checkInTime,
            },
          }
        )

        sentCount++
      } catch (err) {
        console.error(`Failed to send pre-office notification to ${employee._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Sent ${sentCount} pre-office notifications`)
    return { sent: sentCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Pre-office notification error:', error)
    return { sent: 0, error: error.message }
  }
}

/**
 * Send break start notification
 */
export async function sendBreakStartNotifications(breakName, settings, filter = {}, referenceDate = new Date()) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const employees = await getActiveEmployees(filter, referenceDate)
    let sentCount = 0

    for (const employee of employees) {
      if (!employee.user) continue

      try {
        const employeeName = employee.firstName || 'there'
        const message = await generateAIMessage('breakStart', employeeName)

        await sendPushToUser(
          employee.user._id,
          {
            title: `☕ ${breakName || 'Break'} Time!`,
            body: message,
          },
          {
            eventType: 'breakReminder',
            icon: '/icons/icon-192x192.png',
            data: {
              type: 'break-start',
              breakName,
            },
          }
        )

        sentCount++
      } catch (err) {
        console.error(`Failed to send break notification to ${employee._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Sent ${sentCount} break start notifications`)
    return { sent: sentCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Break notification error:', error)
    return { sent: 0, error: error.message }
  }
}

/**
 * Send break end notification
 */
export async function sendBreakEndNotifications(breakName, settings, filter = {}, referenceDate = new Date()) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const employees = await getActiveEmployees(filter, referenceDate)
    let sentCount = 0

    for (const employee of employees) {
      if (!employee.user) continue

      try {
        const employeeName = employee.firstName || 'there'
        const message = await generateAIMessage('breakEnd', employeeName)

        await sendPushToUser(
          employee.user._id,
          {
            title: `⚡ ${breakName || 'Break'} Ending!`,
            body: message,
          },
          {
            eventType: 'breakReminder',
            icon: '/icons/icon-192x192.png',
            data: {
              type: 'break-end',
              breakName,
            },
          }
        )

        sentCount++
      } catch (err) {
        console.error(`Failed to send break end notification to ${employee._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Sent ${sentCount} break end notifications`)
    return { sent: sentCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Break end notification error:', error)
    return { sent: 0, error: error.message }
  }
}

/**
 * Send work-off notification
 */
export async function sendWorkOffNotifications(settings, filter = {}, referenceDate = new Date()) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const employees = await getActiveEmployees(filter, referenceDate)
    let sentCount = 0

    for (const employee of employees) {
      if (!employee.user) continue

      try {
        const employeeName = employee.firstName || 'there'
        const message = await generateAIMessage('workOff', employeeName)

        await sendPushToUser(
          employee.user._id,
          {
            title: '🏠 Time to Head Home!',
            body: message,
          },
          {
            eventType: 'workOffReminder',
            clickAction: '/dashboard/attendance',
            icon: '/icons/icon-192x192.png',
            data: {
              type: 'work-off',
              officeEndTime: settings.checkOutTime,
            },
          }
        )

        sentCount++
      } catch (err) {
        console.error(`Failed to send work-off notification to ${employee._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Sent ${sentCount} work-off notifications`)
    return { sent: sentCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Work-off notification error:', error)
    return { sent: 0, error: error.message }
  }
}

/**
 * Send overtime check notification (30 min after shift ends)
 * Asks employees if they're working overtime or forgot to clock out
 */
export async function sendOvertimeCheckNotifications(settings, filter = {}, referenceDate = new Date()) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    // Get checkout time from settings
    const [checkOutHour, checkOutMin] = (settings?.checkOutTime || '18:00').split(':').map(Number)

    const today = new Date(referenceDate)
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Find employees who are still checked in (no checkout)
    // AND check-in time was BEFORE scheduled checkout time
    const query = {
      date: { $gte: today, $lt: tomorrow },
      checkIn: { $exists: true, $ne: null },
      checkOut: { $exists: false },
      status: 'in-progress'
    }

    // If filtering by company, we need to filter employees first or populate and filter
    // Since Attendance doesn't have company, we rely on the fact that we are iterating contexts.
    // But we need to filter the attendance records by the employees in this context.

    let attendanceRecords = await Attendance.find(query).populate({
      path: 'employee',
      match: filter, // Filter employee by company
      populate: { path: 'user', select: '_id firstName lastName email' }
    })

    // Filter out records where employee didn't match the filter (populated as null)
    attendanceRecords = attendanceRecords.filter(a => a.employee)

    if (attendanceRecords.length === 0) {
      return { sent: 0, reason: 'No employees currently checked in' }
    }

    const now = new Date(referenceDate)

    let sentCount = 0

    for (const attendance of attendanceRecords) {
      const employee = attendance.employee
      if (!employee?.user) continue

      try {
        const employeeName = employee.firstName || 'there'
        const message = getRandomMessage('overtimeCheck')

        // Create overtime request record
        const overtimeRequest = await OvertimeRequest.create({
          employee: employee._id,
          attendance: attendance._id,
          date: today,
          scheduledCheckOut: new Date(today.setHours(checkOutHour, checkOutMin, 0, 0)),
          promptSentAt: now,
          status: 'pending'
        })

        // Send HIGH PRIORITY push notification
        await sendPushToUser(
          employee.user._id,
          {
            title: '⚠️ OVERTIME CHECK - Response Needed!',
            body: message,
          },
          {
            eventType: 'overtimeCheck',
            clickAction: '/dashboard/attendance',
            icon: '/icons/icon-192x192.png',
            data: {
              type: 'overtime-check',
              requestId: overtimeRequest._id.toString(),
              priority: 'high',
              requiresAction: true,
              scheduledCheckout: scheduledCheckout.toISOString(),
            },
          }
        )

        sentCount++
        console.log(`[AttendanceScheduler] Sent overtime check to ${employee.email || employee._id}`)
      } catch (err) {
        console.error(`Failed to send overtime notification to ${employee._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Sent ${sentCount} overtime check notifications`)
    return { sent: sentCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Overtime check notification error:', error)
    return { sent: 0, error: error.message }
  }
}

/**
 * Auto checkout employees who didn't respond to overtime prompt
 * Called 30 minutes after scheduled checkout time
 * IMPORTANT: The extra 30 mins are NOT counted as work hours
 * They will only be counted as overtime if user raises a correction request
 */
export async function processAutoCheckouts(settings, filter = {}) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const now = new Date()

    // Get checkout time from settings
    const [checkOutHour, checkOutMin] = (settings?.checkOutTime || '18:00').split(':').map(Number)

    // Find all employees who are still checked in (no checkout) for today/yesterday
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Find all employees who are still checked in (no checkout) for today
    let stillCheckedIn = await Attendance.find({
      date: { $gte: today, $lt: tomorrow },
      checkIn: { $exists: true, $ne: null },
      checkOut: { $exists: false },
      status: 'in-progress'
    }).populate({
      path: 'employee',
      match: filter,
      populate: { path: 'user', select: '_id firstName lastName email' }
    })

    // Filter out records where employee didn't match the filter
    stillCheckedIn = stillCheckedIn.filter(a => a.employee)

    if (stillCheckedIn.length === 0) {
      return { processed: 0, reason: 'No employees still checked in' }
    }

    let processedCount = 0

    for (const attendance of stillCheckedIn) {
      try {
        // Calculate scheduled checkout time for THIS attendance record
        // We assume the attendance date corresponds to the shift date.
        // We construct the scheduled checkout time in IST.

        // Get the date string from attendance date (YYYY-MM-DD)
        const attDate = new Date(attendance.date);
        const year = attDate.getFullYear();
        const month = String(attDate.getMonth() + 1).padStart(2, '0');
        const day = String(attDate.getDate()).padStart(2, '0');

        const hour = String(checkOutHour).padStart(2, '0');
        const min = String(checkOutMin).padStart(2, '0');

        // Construct ISO string for IST: "YYYY-MM-DDTHH:mm:00.000+05:30"
        // This ensures we are targeting 18:00 IST regardless of server timezone
        const isoString = `${year}-${month}-${day}T${hour}:${min}:00.000+05:30`;
        const scheduledCheckoutTime = new Date(isoString);

        // Auto-checkout trigger is exactly 2 hours after scheduled checkout
        const autoCheckoutTriggerTime = new Date(scheduledCheckoutTime.getTime() + 2 * 60 * 60 * 1000);

        // Check if current time is past the trigger time
        if (now < autoCheckoutTriggerTime) {
          continue; // Not yet time for this user
        }

        // Auto-checkout at SCHEDULED checkout time (company logout time)
        // This ensures overtime is NOT counted for auto-checkouts
        attendance.checkOut = scheduledCheckoutTime
        attendance.checkOutStatus = 'auto-checkout'

        // Calculate work hours using shrinkage method
        if (attendance.checkIn && settings?.breakTimings) {
          const { calculateEffectiveWorkHours, determineAttendanceStatus } = await import('@/lib/attendanceShrinkage')

          const workCalc = calculateEffectiveWorkHours(
            attendance.checkIn,
            scheduledCheckoutTime, // Use scheduled time, NOT current time
            settings.breakTimings
          )

          attendance.workHours = workCalc.effectiveWorkHours
          attendance.totalLoggedHours = workCalc.totalLoggedHours
          attendance.breakMinutes = workCalc.breakMinutes
          attendance.shrinkagePercentage = workCalc.shrinkagePercentage

          // Determine final status
          const statusResult = determineAttendanceStatus(workCalc.effectiveWorkHours, {
            fullDayHours: settings.fullDayHours || 8,
            halfDayHours: settings.halfDayHours || 4
          })

          attendance.status = statusResult.status
          attendance.statusReason = statusResult.reason + ' (Auto-checkout at scheduled time)'
        } else {
          // Fallback calculation
          const hoursWorked = (scheduledCheckoutTime - new Date(attendance.checkIn)) / (1000 * 60 * 1000)
          attendance.workHours = parseFloat(hoursWorked.toFixed(2))
          attendance.status = hoursWorked >= 4 ? (hoursWorked >= 7 ? 'present' : 'half-day') : 'absent'
          attendance.statusReason = 'Auto-checkout at scheduled time'
        }

        attendance.remarks = (attendance.remarks || '') + ' | Auto-checked out 2 hours after scheduled logout time. Overtime not counted. Raise correction request if needed.'

        await attendance.save()

        // Update any pending overtime request
        await OvertimeRequest.findOneAndUpdate(
          { attendance: attendance._id, status: 'pending' },
          { status: 'auto-checkout', autoCheckoutAt: now }
        )

        // Send notification to user
        if (attendance.employee?.user) {
          const message = getRandomMessage('autoCheckout')
          await sendPushToUser(
            attendance.employee.user._id,
            {
              title: '🔒 Auto Clock-Out',
              body: `${message} You were checked out at ${scheduledCheckoutTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} (company logout time). Overtime not counted for auto-checkouts.`,
            },
            {
              eventType: 'autoCheckout',
              clickAction: '/dashboard/attendance',
              icon: '/icons/icon-192x192.png',
              data: {
                type: 'auto-checkout',
                checkoutTime: scheduledCheckoutTime.toISOString(),
                workHours: attendance.workHours,
                note: 'Auto-checkout 2 hours after scheduled logout. Overtime not counted. Raise correction request if needed.',
              },
            }
          )
        }

        processedCount++
        console.log(`[AttendanceScheduler] Auto-checkout processed for ${attendance.employee?.email || attendance._id} at company logout time ${scheduledCheckoutTime.toLocaleTimeString()} (triggered 2 hours after)`)
      } catch (err) {
        console.error(`Failed to process auto-checkout for attendance ${attendance._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Processed ${processedCount} auto-checkouts`)
    return { processed: processedCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Auto checkout error:', error)
    return { processed: 0, error: error.message }
  }
}

/**
 * Mark employees as ABSENT if they did not check in for the day
 */
export async function markAbsentEmployees(settings, filter = {}) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const now = new Date()

    // Get check-in time and absent threshold from settings
    const [checkInHour, checkInMin] = (settings?.checkInTime || '09:00').split(':').map(Number)
    const absentThresholdMinutes = settings?.absentThresholdMinutes || 60

    // Calculate the time when we should start marking absent
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const absentMarkingTime = new Date(today)
    absentMarkingTime.setHours(checkInHour, checkInMin + absentThresholdMinutes, 0, 0)

    // Only proceed if we're past the absent marking threshold time
    if (now < absentMarkingTime) {
      return { marked: 0, reason: `Not yet time to mark absent (threshold: ${absentThresholdMinutes} mins after check-in time)` }
    }

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Check if today is a working day
    const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
    if (settings?.workingDays && !settings.workingDays.includes(dayOfWeek)) {
      return { marked: 0, reason: `Today (${dayOfWeek}) is not a working day` }
    }

    // Check if today is a holiday
    const holiday = await Holiday.findOne({
      isActive: true,
      $or: [
        { date: { $gte: today, $lt: tomorrow } },
        { date: { $lte: today }, endDate: { $gte: today } }
      ]
    })

    if (holiday) {
      return { marked: 0, reason: `Today is a holiday: ${holiday.name}` }
    }

    // Get employees on approved leave today
    const leavesToday = await Leave.find({
      status: 'approved',
      startDate: { $lte: today },
      endDate: { $gte: today }
    }).select('employee').lean()

    const onLeaveIds = new Set(leavesToday.map(l => l.employee.toString()))

    // Get all active employees matching filter
    const query = {
      status: 'active',
      ...filter
    }
    const allEmployees = await Employee.find(query).populate('user', '_id email firstName lastName').lean()

    // Get all attendance records for today
    const todayAttendance = await Attendance.find({
      date: { $gte: today, $lt: tomorrow }
    }).lean()

    const employeesWithAttendance = new Set(todayAttendance.map(a => a.employee.toString()))

    // Find employees who don't have any attendance record for today
    const employeesWithoutAttendance = allEmployees.filter(emp =>
      !employeesWithAttendance.has(emp._id.toString()) &&
      !onLeaveIds.has(emp._id.toString()) &&
      emp.user // Only employees with user accounts
    )

    if (employeesWithoutAttendance.length === 0) {
      return { marked: 0, reason: 'All employees have attendance records or are on leave' }
    }

    console.log(`[AttendanceScheduler] Found ${employeesWithoutAttendance.length} employees without attendance for today`)

    let markedCount = 0

    for (const employee of employeesWithoutAttendance) {
      try {
        // Create an absent attendance record
        const absentRecord = new Attendance({
          employee: employee._id,
          date: today,
          status: 'absent',
          workHours: 0,
          totalLoggedHours: 0,
          statusReason: 'No check-in recorded for the day',
          remarks: 'Auto-marked absent - Employee did not check in'
        })

        await absentRecord.save()

        // Send notification to the employee
        if (employee.user) {
          await sendPushToUser(
            employee.user._id,
            {
              title: '❌ Marked Absent',
              body: `You have been marked absent for ${today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} as no attendance was recorded. If this is incorrect, please raise a correction request.`,
            },
            {
              eventType: 'markedAbsent',
              clickAction: '/dashboard/attendance',
              icon: '/icons/icon-192x192.png',
              data: {
                type: 'marked-absent',
                date: today.toISOString(),
                note: 'Raise correction request if this is incorrect',
              },
            }
          )
        }

        markedCount++
        console.log(`[AttendanceScheduler] Marked ${employee.email || employee._id} as absent for ${today.toDateString()}`)
      } catch (err) {
        // If duplicate key error (attendance already exists), skip
        if (err.code === 11000) {
          console.log(`[AttendanceScheduler] Attendance already exists for ${employee._id}`)
          continue
        }
        console.error(`Failed to mark absent for employee ${employee._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Marked ${markedCount} employees as absent`)
    return { marked: markedCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Mark absent error:', error)
    return { marked: 0, error: error.message }
  }
}

/**
 * Process past day attendance records that are still "in-progress"
 */
export async function processPastDayIncompleteAttendance(settings, filter = {}) {
  try {
    await connectDB()

    if (!settings) {
      settings = await CompanySettings.findOne().lean()
    }

    const now = new Date()

    // Get start of today (midnight)
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    // Find all attendance records from past days that are still "in-progress"
    let incompleteAttendance = await Attendance.find({
      status: 'in-progress',
      checkIn: { $exists: true },
      checkOut: { $exists: false },
      date: { $lt: todayStart } // Only records from before today
    }).populate({
      path: 'employee',
      match: filter,
      populate: { path: 'user', select: '_id firstName lastName' }
    }).lean()

    // Filter out records where employee didn't match the filter
    incompleteAttendance = incompleteAttendance.filter(a => a.employee)

    if (incompleteAttendance.length === 0) {
      return { processed: 0, notified: 0, reason: 'No past-day incomplete attendance records' }
    }

    console.log(`[AttendanceScheduler] Found ${incompleteAttendance.length} past-day incomplete attendance records`)

    let processedCount = 0
    let notifiedCount = 0

    // Get office end time from settings (default 18:00)
    const [endHour, endMin] = (settings?.checkOutTime || '18:00').split(':').map(Number)

    for (const record of incompleteAttendance) {
      try {
        const attendance = await Attendance.findById(record._id)
        if (!attendance || attendance.checkOut) {
          continue // Already processed
        }

        // Calculate auto checkout time: at scheduled office end time (NOT including the 30 min buffer)
        // This ensures extra time is NOT counted as work hours
        const attendanceDate = new Date(attendance.date)

        // Construct scheduled checkout time in IST (or company timezone)
        const year = attendanceDate.getFullYear();
        const month = String(attendanceDate.getMonth() + 1).padStart(2, '0');
        const day = String(attendanceDate.getDate()).padStart(2, '0');
        const hour = String(endHour).padStart(2, '0');
        const min = String(endMin).padStart(2, '0');

        // Construct ISO string for IST: "YYYY-MM-DDTHH:mm:00.000+05:30"
        const isoString = `${year}-${month}-${day}T${hour}:${min}:00.000+05:30`;
        const scheduledCheckoutTime = new Date(isoString);

        // If check-in was after office end time, checkout at check-in time (no extra work counted)
        const checkInTime = new Date(attendance.checkIn)
        const autoCheckoutTime = checkInTime > scheduledCheckoutTime ? checkInTime : scheduledCheckoutTime

        // Send notification to user before auto-checkout
        if (record.employee?.user) {
          const employeeName = record.employee.firstName || 'Employee'
          const dateStr = attendanceDate.toLocaleDateString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
          })

          try {
            await sendPushToUser(
              record.employee.user._id,
              {
                title: '⚠️ Attendance Auto-Correction',
                body: `Your attendance for ${dateStr} was still "In Progress". You've been automatically clocked out at ${autoCheckoutTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. If you worked overtime, please raise a correction request.`,
              },
              {
                eventType: 'pastDayAutoCheckout',
                clickAction: '/dashboard/attendance',
                icon: '/icons/icon-192x192.png',
                data: {
                  type: 'past-day-auto-checkout',
                  attendanceDate: attendanceDate.toISOString(),
                  checkoutTime: autoCheckoutTime.toISOString(),
                  note: 'Extra time not counted. Raise correction request for overtime.',
                },
              }
            )
            notifiedCount++
            console.log(`[AttendanceScheduler] Notified user ${record.employee.user._id} about past-day auto-checkout`)
          } catch (notifyErr) {
            console.error(`Failed to send notification for attendance ${record._id}:`, notifyErr.message)
          }
        }

        // Set checkout time at scheduled time (extra time NOT counted)
        attendance.checkOut = autoCheckoutTime
        attendance.checkOutStatus = 'auto-corrected'
        attendance.remarks = (attendance.remarks || '') + ' | Auto-corrected: Past day incomplete. Extra time not counted. Raise correction request for overtime.'

        // Calculate work hours
        if (attendance.checkIn && settings?.breakTimings) {
          const workCalc = calculateEffectiveWorkHours(
            new Date(attendance.checkIn),
            autoCheckoutTime,
            settings.breakTimings
          )

          attendance.workHours = workCalc.effectiveWorkHours
          attendance.totalLoggedHours = workCalc.totalLoggedHours
          attendance.breakMinutes = workCalc.breakMinutes
          attendance.shrinkagePercentage = workCalc.shrinkagePercentage

          // Determine final status
          const statusResult = determineAttendanceStatus(workCalc.effectiveWorkHours, {
            fullDayHours: settings.fullDayHours || 8,
            halfDayHours: settings.halfDayHours || 4
          })

          attendance.status = statusResult.status
          attendance.statusReason = statusResult.reason + ' (Auto-corrected: Past day incomplete)'
        } else {
          // Fallback calculation
          const hoursWorked = (autoCheckoutTime - new Date(attendance.checkIn)) / (1000 * 60 * 60)
          attendance.workHours = parseFloat(hoursWorked.toFixed(2))
          attendance.status = hoursWorked >= 4 ? (hoursWorked >= 7 ? 'present' : 'half-day') : 'absent'
          attendance.statusReason = 'Auto-corrected: Past day incomplete attendance'
        }

        await attendance.save()
        processedCount++
        console.log(`[AttendanceScheduler] Auto-corrected past-day attendance ${attendance._id} for date ${attendanceDate.toDateString()}`)
      } catch (err) {
        console.error(`Failed to process past-day attendance ${record._id}:`, err.message)
      }
    }

    console.log(`[AttendanceScheduler] Processed ${processedCount} past-day incomplete records, notified ${notifiedCount} users`)
    return { processed: processedCount, notified: notifiedCount }
  } catch (error) {
    console.error('[AttendanceScheduler] Past day attendance processing error:', error)
    return { processed: 0, notified: 0, error: error.message }
  }
}

/**
 * Process notifications for a specific context (Company or Global)
 */
async function processNotificationsForContext(settings, filter) {
  if (!settings) return []

  const timezone = settings.timezone || 'Asia/Kolkata';
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`

  const triggered = []

  // Check for pre-office notification (15 minutes before check-in time)
  if (settings.checkInTime) {
    const [checkInHour, checkInMin] = settings.checkInTime.split(':').map(Number)
    const preOfficeTime = new Date(now)
    preOfficeTime.setHours(checkInHour, checkInMin - 15, 0, 0)

    if (currentHour === preOfficeTime.getHours() && currentMinute === preOfficeTime.getMinutes()) {
      const result = await sendPreOfficeNotifications(settings, filter)
      triggered.push({ type: 'pre-office', ...result })
    }
  }

  // Check for work-off notification (at check-out time)
  if (settings.checkOutTime) {
    const [checkOutHour, checkOutMin] = settings.checkOutTime.split(':').map(Number)
    if (currentHour === checkOutHour && currentMinute === checkOutMin) {
      const result = await sendWorkOffNotifications(settings, filter)
      triggered.push({ type: 'work-off', ...result })
    }

    // Check for overtime notification (30 minutes after check-out time)
    const overtimeCheckTime = new Date(now)
    overtimeCheckTime.setHours(checkOutHour, checkOutMin + 30, 0, 0)

    if (currentHour === overtimeCheckTime.getHours() && currentMinute === overtimeCheckTime.getMinutes()) {
      const result = await sendOvertimeCheckNotifications(settings, filter)
      triggered.push({ type: 'overtime-check', ...result })
    }
  }

  // Check for break notifications
  if (settings.breakTimings && settings.breakTimings.length > 0) {
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()

    for (const breakTiming of settings.breakTimings) {
      if (!breakTiming.isActive) continue
      if (breakTiming.days && breakTiming.days.length > 0 && !breakTiming.days.includes(dayOfWeek)) {
        continue
      }

      // Break start
      if (breakTiming.startTime === currentTimeString) {
        const result = await sendBreakStartNotifications(breakTiming.name, settings, filter)
        triggered.push({ type: 'break-start', breakName: breakTiming.name, ...result })
      }

      // Break end
      if (breakTiming.endTime === currentTimeString) {
        const result = await sendBreakEndNotifications(breakTiming.name, settings, filter)
        triggered.push({ type: 'break-end', breakName: breakTiming.name, ...result })
      }
    }
  }

  // Process auto-checkouts every minute
  const autoCheckoutResult = await processAutoCheckouts(settings, filter)
  if (autoCheckoutResult.processed > 0) {
    triggered.push({ type: 'auto-checkout', ...autoCheckoutResult })
  }

  // Mark absent employees
  const markAbsentResult = await markAbsentEmployees(settings, filter)
  if (markAbsentResult.marked > 0) {
    triggered.push({ type: 'mark-absent', ...markAbsentResult })
  }

  // Process past-day incomplete attendance records
  const pastDayResult = await processPastDayIncompleteAttendance(settings, filter)
  if (pastDayResult.processed > 0) {
    triggered.push({ type: 'past-day-auto-correction', ...pastDayResult })
  }

  return triggered
}

/**
 * Check and trigger scheduled notifications
 * This should be called every minute by the scheduler
 */
export async function checkAndTriggerNotifications() {
  try {
    await connectDB()
    const triggered = []

    // 1. Process Global Settings (for employees without company)
    const globalSettings = await CompanySettings.findOne().lean()
    if (globalSettings) {
      const result = await processNotificationsForContext(globalSettings, { company: null })
      triggered.push(...result)
    }

    // 2. Process Company Specific Settings
    const companies = await Company.find().lean()
    for (const company of companies) {
      // Map company to settings structure
      const settings = {
        checkInTime: company.workingHours?.checkInTime || '09:00',
        checkOutTime: company.workingHours?.checkOutTime || '18:00',
        breakTimings: company.breakTimings || [],
        workingDays: company.workingHours?.workingDays || [],
        absentThresholdMinutes: company.workingHours?.absentThresholdMinutes || 60,
        lateThreshold: company.workingHours?.lateThresholdMinutes || 15,
        fullDayHours: company.workingHours?.fullDayHours || 8,
        halfDayHours: company.workingHours?.halfDayHours || 4,
        notifications: { pushNotifications: true }, // Assume enabled
        timezone: company.timezone || 'Asia/Kolkata'
      }
      const result = await processNotificationsForContext(settings, { company: company._id })
      triggered.push(...result)
    }

    return { triggered }
  } catch (error) {
    console.error('[AttendanceScheduler] Check notifications error:', error)
    return { triggered: [], error: error.message }
  }
}

export default {
  sendPreOfficeNotifications,
  sendBreakStartNotifications,
  sendBreakEndNotifications,
  sendWorkOffNotifications,
  sendOvertimeCheckNotifications,
  processAutoCheckouts,
  markAbsentEmployees,
  processPastDayIncompleteAttendance,
  checkAndTriggerNotifications,
  generateAIMessage,
  getRandomMessage,
}
