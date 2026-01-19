import { NextResponse } from 'next/server'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'
import { getTenantModels } from '@/lib/tenantModels'
import { sendPushToUser } from '@/lib/pushNotification'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Allow up to 120 seconds for processing (auto-checkout + rectification)

/**
 * Auto-Checkout & Attendance Rectification Cron Job
 * 
 * This runs at midnight (12:00 AM) in each company's timezone to:
 * 
 * PHASE 1: Auto-Checkout
 * 1. Find all employees with 'in-progress' status (checked in but not checked out)
 * 2. Set their checkout time to the company's configured checkout time
 * 3. Calculate work hours and determine final status (present/half-day/absent)
 * 4. Mark as autoCheckedOut: true for auditing
 * 5. Send notification to the employee
 * 
 * PHASE 2: Attendance Rectification
 * 1. Find all attendance records with check-in and check-out for the day
 * 2. Recalculate work hours based on actual times
 * 3. Correct any mismatched status based on calculated work hours
 * 4. Ensures data consistency and accurate calculations
 * 
 * Cron schedule: Run every hour and check which companies are at midnight
 * Or: Run at midnight UTC and calculate for all timezones
 */

/**
 * Get current time in a specific timezone
 */
function getTimeInTimezone(timezone) {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
    
    const parts = formatter.formatToParts(now)
    const values = {}
    parts.forEach(({ type, value }) => {
      values[type] = value
    })
    
    return {
      hour: parseInt(values.hour),
      minute: parseInt(values.minute),
      date: `${values.year}-${values.month}-${values.day}`,
      fullDate: new Date(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`)
    }
  } catch (error) {
    console.error(`Invalid timezone: ${timezone}`, error)
    return null
  }
}

/**
 * Create a date object for a specific time in a timezone
 */
function createDateInTimezone(dateStr, timeStr, timezone) {
  try {
    // Parse the date and time
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hour, minute] = timeStr.split(':').map(Number)
    
    // Create a date string that we can parse
    const dateTimeStr = `${dateStr}T${timeStr}:00`
    
    // Get the timezone offset for this specific date/time
    const tempDate = new Date(dateTimeStr)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    })
    
    // Create date in the target timezone
    // We use a workaround: create date in UTC and adjust
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
    
    // Get offset for this timezone
    const tzDate = new Date(tempDate.toLocaleString('en-US', { timeZone: timezone }))
    const utcRefDate = new Date(tempDate.toLocaleString('en-US', { timeZone: 'UTC' }))
    const offsetMs = utcRefDate - tzDate
    
    return new Date(utcDate.getTime() + offsetMs)
  } catch (error) {
    console.error(`Error creating date in timezone: ${timezone}`, error)
    return null
  }
}

/**
 * Calculate work hours between two dates, excluding breaks
 */
function calculateWorkHours(checkIn, checkOut, breakTimings = []) {
  if (!checkIn || !checkOut) return { workHours: 0, breakMinutes: 0 }
  
  const checkInTime = new Date(checkIn)
  const checkOutTime = new Date(checkOut)
  
  let totalMinutes = (checkOutTime - checkInTime) / (1000 * 60)
  let breakMinutes = 0
  
  // Subtract break times if configured
  if (breakTimings && breakTimings.length > 0) {
    const checkInDay = checkInTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
    
    for (const breakTiming of breakTimings) {
      if (!breakTiming.isActive) continue
      if (breakTiming.days && !breakTiming.days.includes(checkInDay)) continue
      
      // Parse break times
      const [breakStartHour, breakStartMin] = breakTiming.startTime.split(':').map(Number)
      const [breakEndHour, breakEndMin] = breakTiming.endTime.split(':').map(Number)
      
      // Create break start and end times for the check-in day
      const breakStart = new Date(checkInTime)
      breakStart.setHours(breakStartHour, breakStartMin, 0, 0)
      
      const breakEnd = new Date(checkInTime)
      breakEnd.setHours(breakEndHour, breakEndMin, 0, 0)
      
      // Calculate overlap between work period and break period
      const overlapStart = Math.max(checkInTime.getTime(), breakStart.getTime())
      const overlapEnd = Math.min(checkOutTime.getTime(), breakEnd.getTime())
      
      if (overlapEnd > overlapStart) {
        const overlapMinutes = (overlapEnd - overlapStart) / (1000 * 60)
        breakMinutes += overlapMinutes
      }
    }
  }
  
  const effectiveMinutes = Math.max(0, totalMinutes - breakMinutes)
  const workHours = effectiveMinutes / 60
  
  return {
    workHours: parseFloat(workHours.toFixed(2)),
    totalLoggedHours: parseFloat((totalMinutes / 60).toFixed(2)),
    breakMinutes: Math.round(breakMinutes)
  }
}

/**
 * Determine attendance status based on work hours
 * 
 * Thresholds (for 8-hour workday):
 * - Present (full day): ≥6.5 hours (81.25%) - may have shrinkage deducted
 * - Early checkout: ≥5 hours but <6.5 hours (62.5%-81.25%) - counts as present but flagged
 * - Half-day: <5 hours (below 62.5%)
 */
function determineStatus(workHours, fullDayHours = 8, halfDayHours = 4) {
  // New thresholds:
  // - Full day threshold: 81.25% (6.5h for 8h day) - present with possible shrinkage
  // - Early checkout threshold: 62.5% (5h for 8h day) - present but flagged as early
  // - Below early checkout = half-day
  const fullDayThreshold = fullDayHours * 0.8125 // 6.5 hours for 8-hour day
  const earlyCheckoutThreshold = fullDayHours * 0.625 // 5 hours for 8-hour day
  
  if (workHours >= fullDayThreshold) {
    return { status: 'present', reason: `Worked ${workHours.toFixed(2)} hours (≥${fullDayThreshold.toFixed(1)}h threshold)`, isEarlyCheckout: false }
  } else if (workHours >= earlyCheckoutThreshold) {
    return { status: 'present', reason: `Worked ${workHours.toFixed(2)} hours (early checkout - ≥${earlyCheckoutThreshold.toFixed(1)}h but <${fullDayThreshold.toFixed(1)}h)`, isEarlyCheckout: true }
  } else {
    return { status: 'half-day', reason: `Worked only ${workHours.toFixed(2)} hours (<${earlyCheckoutThreshold.toFixed(1)}h threshold)`, isEarlyCheckout: false }
  }
}

/**
 * Process auto-checkout for a single tenant
 */
async function processAutoCheckoutForTenant(tenant, targetDate) {
  const results = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    success: true,
    processed: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    errors: [],
    details: []
  }

  try {
    // Get tenant-specific models
    const models = await getTenantModels(tenant.databaseName, [
      'Attendance', 'Employee', 'Company', 'User'
    ])
    const { Attendance, Employee, Company, User } = models

    // Get company settings
    const company = await Company.findOne().lean()
    if (!company) {
      results.success = false
      results.errors.push('Company settings not found')
      return results
    }

    const timezone = company.timezone || 'Asia/Kolkata'
    const checkOutTime = company.workingHours?.checkOutTime || '18:00'
    const fullDayHours = company.workingHours?.fullDayHours || 8
    const halfDayHours = company.workingHours?.halfDayHours || 4
    const breakTimings = Array.isArray(company.breakTimings) ? company.breakTimings : []

    // Calculate the date range for the target date in the company's timezone
    const targetDateStart = new Date(targetDate)
    targetDateStart.setHours(0, 0, 0, 0)
    const targetDateEnd = new Date(targetDate)
    targetDateEnd.setHours(23, 59, 59, 999)

    // Find all in-progress attendance records for the target date
    const inProgressRecords = await Attendance.find({
      date: { $gte: targetDateStart, $lte: targetDateEnd },
      checkIn: { $exists: true, $ne: null },
      checkOut: { $exists: false },
      status: 'in-progress'
    }).populate({
      path: 'employee',
      select: 'firstName lastName employeeCode userId',
      populate: { path: 'userId', select: '_id email' }
    })

    if (inProgressRecords.length === 0) {
      results.details.push('No in-progress records found')
      return results
    }

    console.log(`[Auto-Checkout] Found ${inProgressRecords.length} in-progress records for ${tenant.name}`)

    for (const attendance of inProgressRecords) {
      try {
        if (!attendance.employee) {
          results.errors.push(`Attendance ${attendance._id}: Employee not found`)
          continue
        }

        // Get the date string from the attendance date
        const attDate = new Date(attendance.date)
        const dateStr = attDate.toISOString().split('T')[0]
        
        // Create checkout time using company's configured checkout time
        const checkoutDateTime = createDateInTimezone(dateStr, checkOutTime, timezone)
        
        if (!checkoutDateTime) {
          results.errors.push(`Attendance ${attendance._id}: Could not create checkout datetime`)
          continue
        }

        // If check-in was after checkout time, use check-in time + 1 minute as checkout
        // This handles edge cases where someone checked in very late
        let finalCheckoutTime = checkoutDateTime
        if (attendance.checkIn > checkoutDateTime) {
          finalCheckoutTime = new Date(attendance.checkIn.getTime() + 60000) // 1 minute after check-in
        }

        // Calculate work hours
        const workCalc = calculateWorkHours(attendance.checkIn, finalCheckoutTime, breakTimings)
        
        // Determine final status
        const statusResult = determineStatus(workCalc.workHours, fullDayHours, halfDayHours)

        // Update the attendance record
        attendance.checkOut = finalCheckoutTime
        attendance.checkOutStatus = 'auto-checkout'
        attendance.workHours = workCalc.workHours
        attendance.totalLoggedHours = workCalc.totalLoggedHours
        attendance.breakMinutes = workCalc.breakMinutes
        attendance.status = statusResult.status
        attendance.statusReason = statusResult.reason + ' (Midnight auto-checkout)'
        attendance.autoCheckedOut = true
        attendance.autoCheckoutReason = 'midnight_cutoff'
        attendance.autoCheckoutAt = new Date()
        attendance.remarks = (attendance.remarks || '') + ` | Auto-checked out at midnight. Checkout time set to company logout time (${checkOutTime}).`
        
        await attendance.save()
        results.processed++

        results.details.push({
          employeeId: attendance.employee._id,
          employeeName: `${attendance.employee.firstName} ${attendance.employee.lastName}`,
          checkIn: attendance.checkIn,
          checkOut: finalCheckoutTime,
          workHours: workCalc.workHours,
          status: statusResult.status
        })

        // Send notification to user
        const userId = attendance.employee.userId?._id || attendance.employee.userId
        if (userId) {
          try {
            await sendPushToUser(
              userId,
              {
                title: '🔒 Auto Clock-Out',
                body: `You were automatically checked out at ${checkOutTime} (company logout time) as you didn't clock out yesterday. Work hours: ${workCalc.workHours.toFixed(2)}h. Status: ${statusResult.status}.`,
              },
              {
                eventType: 'autoCheckout',
                clickAction: '/dashboard/attendance',
                icon: '/icons/icon-192x192.png',
                data: {
                  type: 'midnight-auto-checkout',
                  checkoutTime: finalCheckoutTime.toISOString(),
                  workHours: workCalc.workHours,
                  status: statusResult.status,
                  note: 'Raise a correction request if the checkout time is incorrect.'
                }
              }
            )
            results.notificationsSent++
          } catch (pushError) {
            console.error(`[Auto-Checkout] Failed to send notification to ${userId}:`, pushError.message)
            results.notificationsFailed++
          }
        }

      } catch (recordError) {
        console.error(`[Auto-Checkout] Error processing attendance ${attendance._id}:`, recordError)
        results.errors.push(`Attendance ${attendance._id}: ${recordError.message}`)
      }
    }

    return results

  } catch (error) {
    console.error(`[Auto-Checkout] Error processing tenant ${tenant.name}:`, error)
    results.success = false
    results.errors.push(error.message)
    return results
  }
}

/**
 * PHASE 2: Attendance Rectification
 * 
 * This function ensures all attendance records with check-in and check-out
 * have correctly calculated work hours and status.
 * 
 * Runs after auto-checkout to ensure all records are accurate.
 */
async function rectifyAttendanceForTenant(tenant, targetDate) {
  const results = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    success: true,
    totalRecords: 0,
    alreadyCorrect: 0,
    rectified: 0,
    errors: [],
    details: []
  }

  try {
    // Get tenant-specific models
    const models = await getTenantModels(tenant.databaseName, [
      'Attendance', 'Employee', 'Company'
    ])
    const { Attendance, Employee, Company } = models

    // Get company settings
    const company = await Company.findOne().lean()
    if (!company) {
      results.success = false
      results.errors.push('Company settings not found')
      return results
    }

    const fullDayHours = company.workingHours?.fullDayHours || 8
    const breakTimings = Array.isArray(company.breakTimings) ? company.breakTimings : []

    // Calculate the date range for the target date
    const targetDateStart = new Date(targetDate)
    targetDateStart.setHours(0, 0, 0, 0)
    const targetDateEnd = new Date(targetDate)
    targetDateEnd.setHours(23, 59, 59, 999)

    // Find all attendance records with both check-in AND check-out for the target date
    const records = await Attendance.find({
      date: { $gte: targetDateStart, $lte: targetDateEnd },
      checkIn: { $exists: true, $ne: null },
      checkOut: { $exists: true, $ne: null }
    }).populate('employee', 'firstName lastName employeeCode')

    results.totalRecords = records.length

    if (records.length === 0) {
      results.details.push('No completed attendance records found for rectification')
      return results
    }

    console.log(`[Rectification] Found ${records.length} completed records for ${tenant.name} on ${targetDate.toISOString().split('T')[0]}`)

    for (const record of records) {
      try {
        // Calculate what the work hours and status SHOULD be
        const workCalc = calculateWorkHours(record.checkIn, record.checkOut, breakTimings)
        const statusResult = determineStatus(workCalc.workHours, fullDayHours)
        
        const currentStatus = record.status
        const calculatedStatus = statusResult.status
        const currentWorkHours = record.workHours || 0
        const calculatedWorkHours = workCalc.workHours

        // Check if status OR work hours are mismatched (with 0.1h tolerance for work hours)
        const statusMismatch = currentStatus !== calculatedStatus
        const workHoursMismatch = Math.abs(currentWorkHours - calculatedWorkHours) > 0.1

        if (statusMismatch || workHoursMismatch) {
          // Record needs rectification
          const employeeName = record.employee 
            ? `${record.employee.firstName} ${record.employee.lastName}`
            : 'Unknown'
          
          console.log(`[Rectification] Fixing ${employeeName}: status ${currentStatus} → ${calculatedStatus}, hours ${currentWorkHours.toFixed(2)} → ${calculatedWorkHours.toFixed(2)}`)

          // Update the record
          record.workHours = calculatedWorkHours
          record.totalLoggedHours = workCalc.totalLoggedHours
          record.breakMinutes = workCalc.breakMinutes
          record.status = calculatedStatus
          record.statusReason = `${statusResult.reason} (Auto-rectified)`
          
          await record.save()
          results.rectified++

          results.details.push({
            employeeId: record.employee?._id,
            employeeName,
            date: record.date.toISOString().split('T')[0],
            oldStatus: currentStatus,
            newStatus: calculatedStatus,
            oldWorkHours: currentWorkHours,
            newWorkHours: calculatedWorkHours,
            reason: statusResult.reason
          })
        } else {
          results.alreadyCorrect++
        }

      } catch (recordError) {
        console.error(`[Rectification] Error processing record ${record._id}:`, recordError)
        results.errors.push(`Record ${record._id}: ${recordError.message}`)
      }
    }

    return results

  } catch (error) {
    console.error(`[Rectification] Error processing tenant ${tenant.name}:`, error)
    results.success = false
    results.errors.push(error.message)
    return results
  }
}

/**
 * GET handler - Triggered by cron job
 * 
 * This should be called at midnight or shortly after in each timezone.
 * For simplicity, we process all tenants and auto-checkout any in-progress records
 * from the previous day.
 */
export async function GET(request) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[Auto-Checkout Cron] Starting midnight auto-checkout process...')

    // Connect to superadmin DB to get all tenants
    await connectSuperadminDB()
    const TenantCompany = getTenantCompanyModel()
    
    // Get all active tenants
    const tenants = await TenantCompany.find({ isActive: true }).lean()
    
    if (!tenants || tenants.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active tenants found',
        processed: 0
      })
    }

    console.log(`[Auto-Checkout Cron] Processing ${tenants.length} tenants`)

    const results = {
      success: true,
      tenantsProcessed: 0,
      // Phase 1: Auto-checkout results
      totalAutoCheckouts: 0,
      totalNotificationsSent: 0,
      totalNotificationsFailed: 0,
      // Phase 2: Rectification results
      totalRectified: 0,
      totalAlreadyCorrect: 0,
      tenantResults: [],
      rectificationResults: []
    }

    // Process each tenant
    for (const tenant of tenants) {
      try {
        // Get company timezone and check if it's past midnight there
        const models = await getTenantModels(tenant.databaseName, ['Company'])
        const company = await models.Company.findOne().lean()
        const timezone = company?.timezone || 'Asia/Kolkata'
        
        // Get current time in company timezone
        const tzTime = getTimeInTimezone(timezone)
        
        if (!tzTime) {
          results.tenantResults.push({
            tenantName: tenant.name,
            success: false,
            error: 'Invalid timezone'
          })
          continue
        }

        // Process for yesterday's date (since we run at/after midnight)
        const yesterday = new Date(tzTime.fullDate)
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0)

        console.log(`[Auto-Checkout] Processing ${tenant.name} (${timezone}) for date: ${yesterday.toISOString().split('T')[0]}`)

        // PHASE 1: Auto-checkout in-progress records
        const tenantResult = await processAutoCheckoutForTenant(tenant, yesterday)
        results.tenantResults.push(tenantResult)
        
        if (tenantResult.success) {
          results.tenantsProcessed++
          results.totalAutoCheckouts += tenantResult.processed
          results.totalNotificationsSent += tenantResult.notificationsSent
          results.totalNotificationsFailed += tenantResult.notificationsFailed
        }

        // PHASE 2: Rectify all attendance records for accurate calculations
        console.log(`[Rectification] Running attendance rectification for ${tenant.name}`)
        const rectifyResult = await rectifyAttendanceForTenant(tenant, yesterday)
        results.rectificationResults.push(rectifyResult)
        
        if (rectifyResult.success) {
          results.totalRectified += rectifyResult.rectified
          results.totalAlreadyCorrect += rectifyResult.alreadyCorrect
        }

      } catch (tenantError) {
        console.error(`[Auto-Checkout Cron] Error with tenant ${tenant.name}:`, tenantError)
        results.tenantResults.push({
          tenantName: tenant.name,
          success: false,
          error: tenantError.message
        })
      }
    }

    console.log(`[Auto-Checkout Cron] Completed.`)
    console.log(`  Phase 1 (Auto-Checkout): ${results.totalAutoCheckouts} auto-checkouts across ${results.tenantsProcessed} tenants`)
    console.log(`  Phase 2 (Rectification): ${results.totalRectified} records rectified, ${results.totalAlreadyCorrect} already correct`)

    return NextResponse.json({
      success: true,
      message: `Midnight job completed for ${results.tenantsProcessed} tenants: ${results.totalAutoCheckouts} auto-checkouts, ${results.totalRectified} records rectified`,
      ...results
    })

  } catch (error) {
    console.error('[Auto-Checkout Cron] Fatal error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

/**
 * POST handler - Manual trigger for specific tenant or date
 * 
 * Body: {
 *   tenantSlug?: string,  // Process specific tenant only
 *   date?: string,        // YYYY-MM-DD format, defaults to yesterday
 *   dryRun?: boolean,     // If true, don't actually update records
 *   skipRectification?: boolean  // If true, skip the rectification phase
 * }
 */
export async function POST(request) {
  try {
    // Verify authorization
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // Allow both CRON_SECRET and regular auth token
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Try to verify as regular user (admin only)
      const { getAuthAndModels } = await import('@/lib/auth')
      const auth = await getAuthAndModels(request, [])
      if (!auth.success || !['admin', 'super_admin'].includes(auth.user?.role)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await request.json().catch(() => ({}))
    const { tenantSlug, date, dryRun = false, skipRectification = false } = body

    console.log(`[Auto-Checkout Manual] Starting with params:`, { tenantSlug, date, dryRun, skipRectification })

    // Connect to superadmin DB
    await connectSuperadminDB()
    const TenantCompany = getTenantCompanyModel()

    // Get tenants to process
    const query = { isActive: true }
    if (tenantSlug) {
      query.slug = tenantSlug
    }
    
    const tenants = await TenantCompany.find(query).lean()
    
    if (!tenants || tenants.length === 0) {
      return NextResponse.json({
        success: false,
        error: tenantSlug ? `Tenant '${tenantSlug}' not found` : 'No active tenants found'
      }, { status: 404 })
    }

    const results = {
      success: true,
      dryRun,
      tenantsProcessed: 0,
      // Phase 1
      totalAutoCheckouts: 0,
      // Phase 2
      totalRectified: 0,
      totalAlreadyCorrect: 0,
      tenantResults: [],
      rectificationResults: []
    }

    for (const tenant of tenants) {
      try {
        // Determine target date
        let targetDate
        if (date) {
          targetDate = new Date(date)
        } else {
          // Default to yesterday in company timezone
          const models = await getTenantModels(tenant.databaseName, ['Company'])
          const company = await models.Company.findOne().lean()
          const timezone = company?.timezone || 'Asia/Kolkata'
          const tzTime = getTimeInTimezone(timezone)
          
          targetDate = new Date(tzTime.fullDate)
          targetDate.setDate(targetDate.getDate() - 1)
        }
        targetDate.setHours(0, 0, 0, 0)

        if (dryRun) {
          // Just count how many would be processed
          const models = await getTenantModels(tenant.databaseName, ['Attendance'])
          const { Attendance } = models
          
          const targetDateEnd = new Date(targetDate)
          targetDateEnd.setHours(23, 59, 59, 999)
          
          // Count in-progress records for auto-checkout
          const autoCheckoutCount = await Attendance.countDocuments({
            date: { $gte: targetDate, $lte: targetDateEnd },
            checkIn: { $exists: true, $ne: null },
            checkOut: { $exists: false },
            status: 'in-progress'
          })

          // Count completed records for rectification preview
          const completedCount = await Attendance.countDocuments({
            date: { $gte: targetDate, $lte: targetDateEnd },
            checkIn: { $exists: true, $ne: null },
            checkOut: { $exists: true, $ne: null }
          })
          
          results.tenantResults.push({
            tenantName: tenant.name,
            targetDate: targetDate.toISOString().split('T')[0],
            wouldAutoCheckout: autoCheckoutCount,
            wouldRectify: completedCount,
            dryRun: true
          })
          results.totalAutoCheckouts += autoCheckoutCount
        } else {
          // PHASE 1: Auto-checkout
          const tenantResult = await processAutoCheckoutForTenant(tenant, targetDate)
          results.tenantResults.push(tenantResult)
          
          if (tenantResult.success) {
            results.tenantsProcessed++
            results.totalAutoCheckouts += tenantResult.processed
          }

          // PHASE 2: Rectification (unless skipped)
          if (!skipRectification) {
            const rectifyResult = await rectifyAttendanceForTenant(tenant, targetDate)
            results.rectificationResults.push(rectifyResult)
            
            if (rectifyResult.success) {
              results.totalRectified += rectifyResult.rectified
              results.totalAlreadyCorrect += rectifyResult.alreadyCorrect
            }
          }
        }

      } catch (tenantError) {
        console.error(`[Auto-Checkout Manual] Error with tenant ${tenant.name}:`, tenantError)
        results.tenantResults.push({
          tenantName: tenant.name,
          success: false,
          error: tenantError.message
        })
      }
    }

    return NextResponse.json(results)

  } catch (error) {
    console.error('[Auto-Checkout Manual] Fatal error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
